# Tasks

## 1. Ядро очистки

- [ ] 1.1 `src-tauri/src/prompt_config.rs` / `lib.rs`: команда `get_cleanup_prompt(language, style)` доступна в release (design.md, решение 2)
- [ ] 1.2 Создать `src/lib/textCleanup.ts` (design.md, решение 3) и `src/lib/textCleanup.test.ts` со всеми сценариями из решения 3; runner `resolveSummaryBackend(...).run(...)` вместо генератора промптов. В `summarize.ts` передать `signal`/`deadlineMs`, прекратить повторные попытки после отмены; в `ai.rs` добавить необязательный `deadline_ms` и timeout отправки/чтения HTTP, сохранив поведение запросов без дедлайна; тесты отмены транспорта и позднего результата
- [ ] 1.3 `src/windows/widget/services/transcriptionGuard.ts`: правило длины ответа (+ тест)
- [ ] 1.4 Проверка: `bun test src/lib/textCleanup.test.ts src/windows/widget/services/transcriptionGuard.test.ts`

## 2. Пайплайн

- [ ] 2.1 `src/windows/widget/services/transcriptionPipeline.ts`: вызов `cleanupDictation` после STT, уведомления при откате, логи (design.md, решение 4)
- [ ] 2.2 `src-tauri/src/ai.rs`: удалить лог «disabled by policy» и неиспользуемые `llm_*` поля запроса (design.md, решение 1); синхронизировать `invoke`
- [ ] 2.3 `sidecars/talkee-llm`: `enable_thinking=false` для шаблонов с поддержкой (design.md, решение 5)
- [ ] 2.4 Проверка: `cargo test --workspace`; вручную — локальная LLM, очистка включена → вставлен очищенный текст; отключить LLM runtime → вставлен исходный текст + уведомление

## 3. Настройки и переключение

- [ ] 3.1 `src/lib/store.ts`: `cleanupEnabled`, `cleanupToggleHotkey`, нормализация, валидация конфликтов (design.md, решение 6) + тесты
- [ ] 3.2 Создать `src/lib/cleanupToggle.ts`: `toggleCleanup`, `selectCleanupPreset`, `buildCleanupMenuModel` (design.md, решения 7-9) + тесты
- [ ] 3.3 `src/windows/widget/hooks/useWidgetHotkey.ts`: регистрация третьей горячей клавиши и перерегистрация при изменении
- [ ] 3.4 Уведомления «включена · стиль» / «выключена» / «Нет модели для очистки» с действием; i18n-строки
- [ ] 3.5 Проверка: `bun test`; вручную — горячая клавиша переключает, уведомление показывается

## 4. Трей и контекстное меню

- [ ] 4.1 `src-tauri/src/tray.rs`: пункты и команда `update_cleanup_menu`, событие `tray-cleanup-action` (design.md, решение 8)
- [ ] 4.2 Обработчик `tray-cleanup-action` в окне виджета; вызов `update_cleanup_menu` при старте и при `settings-updated`
- [ ] 4.3 `src/windows/widget/Widget.tsx`: контекстное меню по правому клику, drag только для левой кнопки (design.md, решение 9)
- [ ] 4.4 Проверка: вручную — смена стиля в трее отражается в контекстном меню и во вкладке «Стиль» и наоборот

## 5. Индикатор, вкладка, история

- [ ] 5.1 Индикатор на пилюле (design.md, решение 10)
- [ ] 5.2 Вкладка «Стиль»: переключатель и горячая клавиша вверху (design.md, решение 11)
- [ ] 5.3 История: сохранение исходного текста и переключатель «Очищенный | Исходный» (design.md, решение 12) + тест совместимости старых записей
- [ ] 5.4 Прогрев локальной LLM при включении очистки
- [ ] 5.5 Проверка: `bun run gate`; `openspec validate quick-ai-cleanup-toggle --strict`
