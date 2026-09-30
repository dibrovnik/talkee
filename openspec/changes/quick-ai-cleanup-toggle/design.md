# Design

## Context

Что есть сейчас:
- **Отправка диктовки.** `transcriptionPipeline.ts:~490-520`: вызов `invoke("transcribe_and_clean", { req: {..., llm_api_key: null, llm_endpoint: null, llm_model: "none", style } })`. Rust возвращает `{ raw, cleaned }`, где `cleaned == raw`.
- **Заглушка в Rust.** `ai.rs:1044-1047` пишет в лог «style cleanup is disabled by policy». `style` влияет только на подсказку Whisper (`prompt_config::build_whisper_hint`, `prompt_config.rs:310-326`).
- **Промпты очистки.** JSON-файлы в `src/config/transcription-prompts/{base,languages,styles,overrides}`. Предпросмотр — `build_cleanup_prompt_preview(language, style)` (`prompt_config.rs:110`, dev-команда `get_cleanup_prompt_preview`).
- **Пресеты.** `store.ts:137-155, 596-651`: `prompts: PromptPreset[]` с `kind: "cleanup" | "summary"`. Встроенные пресеты очистки: classic, business, tech. Выбранный пресет — `selectedCleanupPromptId` (по умолчанию `"classic"`), стиль — `style: "classic"|"business"|"tech"`.
- **Текстовый backend.** `summarize.ts`: `resolveSummaryBackend(settings)`, `generatePromptText`, `runTextMapReduce`. После `remove-talkis-cloud` backend бывает двух видов — `custom` и `local`.
- **Защита результата.** `transcriptionGuard.ts` откатывается к исходному тексту, если очищенный отклонён.
- **Локальная LLM.** `llm_runtime.rs` (`ensure_runtime` `:549`, команды `:692-806`). Каталог моделей — Qwen3 1.7B/4B/8B, Granite, SmolLM3, Phi-4-mini, Gemma 3 4B, Qwen2.5 3B/7B.
- **Горячие клавиши.** `hotkey_manager.rs`: `register_handy_hotkey`/`unregister_handy_hotkey`, событие `handy-hotkey-event`. `useWidgetHotkey.ts:460-480` регистрирует диктовку и перевод выделения.
- **Трей.** К этому моменту переделан в `native-macos-ui`: разделители, `CheckMenuItem` для Dock.

## Goals / Non-Goals

**Goals:** очистка в двух режимах, три быстрых способа переключения, надёжный откат к исходному тексту.

**Non-Goals:**
- Одноразовая очистка по модификатору (например, удерживать ⌥ во время диктовки). Можно добавить позже.
- Очистка при транскрибации файлов. Для файлов есть отдельный сценарий промптов, его не меняем.
- Новые пресеты. Используются существующие.

## Decisions

1. **Очистка на стороне TS, а не в Rust `transcribe_and_clean`.**
   - Текстовый backend (`resolveSummaryBackend(...).run(...)`) уже живёт в TS и умеет работать и с custom-, и с local-endpoint'ами. Дублировать его в Rust не нужно.
   - Rust продолжает возвращать `raw`. Из `ai.rs` удалить лог-заглушку «disabled by policy», а заодно и мёртвые поля `llm_*`/`style` запроса, если они больше нигде не используются. Проверить grep'ом: `style` нужен для подсказки Whisper, его оставить.
2. **Промпт.** Системный промпт очистки собирать той же логикой, что `build_cleanup_prompt_preview`: язык + стиль + overrides. Порядок:
   1. превратить dev-команду в обычную `get_cleanup_prompt(language, style)` без флага dev;
   2. если выбран пользовательский пресет (`selectedCleanupPromptId` не встроенный), брать его текст из `settings.prompts`.

   Сообщения модели:
   - `system` = промпт очистки + фиксированная инструкция «Верни только исправленный текст без пояснений»;
   - `user` = исходный текст.
3. **Новый модуль `src/lib/textCleanup.ts`** с чистым API:
   ```ts
   export interface CleanupOutcome { text: string; applied: boolean; reason?: "disabled" | "no-backend" | "timeout" | "error" | "rejected"; durationMs: number }
   export async function cleanupDictation(raw: string, settings: AppSettings, deps?: { run?: ResolvedSummaryBackend["run"]; now?: () => number }): Promise<CleanupOutcome>
   export function stripThinking(text: string): string
   export function isCleanupAvailable(settings: AppSettings): boolean
   ```
   - Таймаут: `AbortController` + `Promise.race`. Runner получает `text` = исходный текст, `prompt` = инструкция очистки, `signal` и `deadlineMs` = абсолютное время окончания. `generatePromptText` остаётся генератором промптов и не используется для очистки. Значения — константы `CLEANUP_TIMEOUT_API_MS = 8000`, `CLEANUP_TIMEOUT_LOCAL_MS = 12000`.
   - Настоящая отмена транспорта: `summarize.ts` передаёт `deadline_ms` в `process_text`, проверяет `signal` до и после прогрева и перед каждой повторной попыткой; после отмены не запускает новые запросы/перезапуски. `ai.rs` принимает необязательный дедлайн и применяет оставшийся бюджет ко всей HTTP-операции (отправка + чтение ответа) через `tokio::time::timeout`; по истечении срока future запроса уничтожается. Уже завершившийся после таймаута результат не применяется. Без дедлайна существующие summary/переводы сохраняют поведение. Прогрев общего runtime не останавливается, но после отмены запрос очистки не запускается.
   - Результат проверяется существующим `transcriptionGuard.ts`, при необходимости расширить его правилом «длина ответа > 2× исходника + 40 символов → reject».
   - Пустой `raw` → `applied: false` без запроса.
   - Тесты с подменой `run`: успех, таймаут, ошибка, `<think>`, reject, выключено, нет backend.
4. **Встраивание в пайплайн.**
   - `transcriptionPipeline.ts`: после получения `raw` и до вставки вызвать `cleanupDictation`, вставлять `outcome.text`.
   - Пока идёт очистка, оверлей показывает существующее состояние обработки. Если такого нет — добавить в `widgetMachine` подсостояние `cleaning` без изменения размера пилюли.
   - При `reason ∈ {timeout, error, rejected}` — уведомление из спеки.
   - В лог: `cleanup_ms`, `cleanup_applied`, `cleanup_reason`.
5. **Thinking-модели.**
   - В `sidecars/talkee-llm` при построении chat template передавать `enable_thinking=false`, если шаблон модели его поддерживает (Qwen3).
   - Независимо от этого `stripThinking` на клиенте вырезает `<think>[\s\S]*?</think>` и ведущие пробелы.
6. **Настройки** (`store.ts`, выполнить исходную задачу 3.1 до ядра 1.2):
   - `Control+Option` запрещён существующим `validateHotkey` из-за VoiceOver; безопасный дефолт — `Control+Shift+C`.
   - `cleanupEnabled: boolean` (по умолчанию `false`);
   - `cleanupToggleHotkey: string` (по умолчанию `"Control+Shift+C"`, пустая строка — отключено; валидация `validateHotkey()` + проверка конфликта с `hotkey` и `translation.selectionHotkey`).

   Нормализация для старых настроек — дефолты. Изменение сохраняется сразу и рассылается событием `settings-updated` (использовать существующий механизм публикации настроек).
7. **Горячая клавиша.**
   - `useWidgetHotkey.ts` регистрирует третью клавишу через `register_handy_hotkey`.
   - По событию `Pressed` для неё вызывается `toggleCleanup()` из нового `src/lib/cleanupToggle.ts`:
     - если сейчас выключено и `!isCleanupAvailable` → уведомление «Нет модели для очистки» с действием (открыть настройки, вкладка `model`);
     - иначе инвертировать `cleanupEnabled`, сохранить, показать уведомление, в режиме «Локально» при включении вызвать прогрев LLM (`ensure_runtime` через существующую команду).
   - Hold/double-tap FSM для этой клавиши не нужен — только одиночное нажатие.
8. **Трей** (`tray.rs`):
   - `CheckMenuItem` «ИИ-очистка текста»;
   - `Submenu` «Стиль очистки» с `CheckMenuItem` на каждый пресет `kind: "cleanup"` — это эмуляция радио-группы: при выборе снимать галочки с остальных.

   Меню строится по данным, которые передаёт frontend, потому что пресеты живут в store на стороне TS. Команда `update_cleanup_menu({ enabled, presets: [{id, name}], selectedId })` вызывается при старте и при каждом изменении настроек. Клики из меню уходят событием `tray-cleanup-action { kind: "toggle" | "select", id? }`; обработчик в окне виджета вызывает `toggleCleanup()` или меняет `selectedCleanupPromptId`/`style`.
9. **Контекстное меню виджета.**
   - На `contextmenu` пилюли вызывается `preventDefault()` и строится `Menu` из `@tauri-apps/api/menu` (`CheckMenuItem`, `Submenu`) с `menu.popup()`.
   - Данные те же, что для трея, построение — общая функция `buildCleanupMenuModel(settings)` в `cleanupToggle.ts`.
   - Правый клик не должен запускать перетаскивание (сейчас drag начинается в pointer-обработчиках `Widget.tsx:1690-1718`): учитывать `event.button === 0`.
10. **Индикатор.**
    - В `Widget.tsx` у пилюли (Idle, Recording) — точка или «искра» 4-5 px в углу, цвет — акцентный. Размеры пилюли не меняются.
    - `aria-label` / `title` = «ИИ-очистка включена».
11. **Вкладка «Стиль».** Сверху `FormSection` с `Toggle` «ИИ-очистка текста» и `FormRow` «Горячая клавиша» (переиспользовать `DictationHotkeyControl`/`HotkeyKeycaps`). Ниже, как сейчас, выбор пресета.
12. **История.** Проверить формат записи (`history_storage.rs` и тип записи в TS):
    - если поля `raw`/`cleaned` уже есть — заполнять оба;
    - если есть только `text` — добавить необязательное `rawText`; старые записи без него показываются как есть.

    В UI записи — сегмент «Очищенный | Исходный», только если `rawText` есть и отличается.

## Risks / Trade-offs

- **Задержка.** Локальная LLM добавляет время к каждой диктовке. Для скорости рекомендуемая модель в UI — Qwen3 1.7B или Qwen2.5 3B, это нужно указать в подсказке.
- **`Control+Shift+C`** может быть занят в других приложениях. Клавиша настраиваемая.
- **Синхронизация трея и меню виджета** через события может рассинхронизироваться. Источник истины — store; меню перестраивается при каждом `settings-updated`.
