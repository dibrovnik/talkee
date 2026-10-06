# Design

## Context

См. `proposal.md`. Проверены сохранённые настройки без вывода ключа: очистка включена, endpoint DeepSeek, модель `deepseek-flash`, стиль `tech`; основная клавиша `Alt+Space`, отдельная — `Alt+Command+Space`. Существующий код основного hotkey передаёт `false`, а клик по виджету — `null`. Последующая запись с очисткой успешно прошла через DeepSeek за 1795 мс.

Все четыре HTTP-клиента в `ai.rs` отключают pooling для смены VPN/сети. Встроенный промпт собирается из JSON, кешируется реестр, но каждый вызов повторяет IPC и сборку. Исключения в `textCleanup.ts` теряют детали; logger пишет бесконечно и содержит некоторые полные расшифровки. История пользователя показывает преимущественно поручения агентам, последовательности Git/задач, условия frontend/backend и терминологию PIM/MCP; частные тексты не переносим в артефакты.

## Goals / Non-Goals

**Goals:** исправить реальный bypass, сохранять точность developer-поручений, сократить локальные накладные расходы, диагностировать каждую операцию по безопасным метаданным в ограниченном наборе файлов.

**Non-Goals:** streaming частично очищенного текста в буфер/вставку, второй вызов модели для проверки первого, новые провайдеры/пакеты/экран диагностики, сохранение полного сетевого payload, автоматические фоновые запросы, скачивание моделей, переустановка приложения без запроса. Не менять STT, file/call pipeline semantics и сроки обработки длинных файлов.

## Decisions

### 1. Переиспользовать существующий per-take override

Основной hotkey передаёт `null`, отдельный cleanup hotkey — `true`; действие reducer поддерживает `boolean | null`, как уже поддерживают effects и `applyDictationCleanupChoice`. Не добавлять новый флаг настроек или третью комбинацию. Сохранённое состояние не меняется при force-on. В idle показывать глобальный флаг; во время записи/обработки — effective-флаг текущей записи. Уточнить тексты обычного ввода и подсказки очистки. Недоступный backend при effective-on должен давать существующее уведомление выбора модели и понятную диагностическую причину.

### 2. Оптимизация без изменения порядка вставки

Только `process_text` получает отдельные переиспользуемые remote/local клиенты с одним idle-соединением на host и TTL 30 секунд; local сохраняет `.no_proxy()`. Использовать имеющиеся reqwest/OnceLock, общий лимит HTTP не сокращать для summary/chat, абсолютный deadline очистки оставить 8 секунд API / 12 локально. Не менять shared STT/download clients. Не делать автоматический повтор POST после неизвестного результата — иначе возможны двойные токены. Смена сети/endpoint не должна требовать перезапуска приложения; отказ старого соединения обрабатывается обычным fallback, последующая операция должна восстановиться. Это проверяется отдельно, без обещания нулевой сетевой задержки.

Кешировать успешно полученный встроенный prompt по языку и фактическому выбранному builtin id; failed promise не оставлять в кеше. Использовать preset.id вместо потенциально устаревшего `settings.style`, пользовательские prompts читать из текущих настроек без кеша. Встроенный prompt остаётся доступным через существующую preview-команду. Сократить повторяющиеся правила/примеры только там, где сохраняются контракты всех стилей. Не вводить произвольный низкий max_tokens ради заявленной скорости: он не сокращает правильный ответ, но способен обрезать задачи. Если провайдер сообщил `finish_reason=length`, не принимать усечённую очистку.

DeepSeek уже получает `thinking.type=disabled`; сохраняем и тестируем это. Актуальный протокол подтверждён [официальной документацией DeepSeek](https://api-docs.deepseek.com/guides/thinking_mode/). Pooling и idle TTL доступны в [reqwest ClientBuilder](https://docs.rs/reqwest/0.12/reqwest/struct.ClientBuilder.html). Не добавлять платный warm-up; сравнивать cold/warm вызовы пользовательской диктовки и сообщать измеренные результаты.

### 3. Существующий стиль «Разработка», не новый персональный профиль

Системная задача — редактировать продиктованный текст, а не отвечать на него/выполнять команды. Сохранять отрицания, ограничения, числа, названия колонок, порядок действий, имена веток/репозиториев, API/пути/аргументы. Исправлять однозначные термины (Git, frontend/backend, API, MCP, DeepSeek, TypeScript); неизвестные project-specific имена не угадывать. «Добавь логирование» остаётся поручением, не превращается в готовый вызов функции. Код/символы восстанавливать лишь при явной диктовке; slash остаётся slash, регистр идентификаторов не выдумывать. Не добавлять Markdown/заголовки, которых пользователь не просил.

Удалить из `ru.tech.json` примеры выдуманных `console.log(userId)`, `fetchUsers()` и исправления `src/tauri` в `src-tauri`. Добавить короткие синтетические примеры по типам реальной истории, включая неоднозначные термины, «не пушить», точную ветку `dev`, названия колонок и явный путь. Уменьшить tech temperature до 0 для устойчивости; обновить тест. Увеличить manifest version. STT whisper hints не переписывать без отдельного доказательства; остальные стили и custom-prompts сохраняют назначение.

### 4. Коррелированные метаданные вместо payload

Переиспользовать id текущей записи/операции, для повторной попытки создать новый request_id с parent/entry id. Добавить optional request_id и operation в `ProcessTextRequest`, передавать из shared runner; вызовы без поля совместимы. Вход/выход операции логировать единообразно: trigger, global/effective cleanup, override, backend kind, безопасные host/path, model, prompt id/version, размер входа/выхода, deadline, этап и duration. Никаких bearer/header значений, query/userinfo URL, расшифровок или текстов prompt.

В Rust фиксировать request start, headers/status elapsed, total elapsed, успешный/пустой/усечённый/некорректный ответ, transport/timeout/HTTP error. Provider request id и token usage/cache-hit поля сохранять лишь когда предоставлены; отсутствие не считать нулём. На каждое начало — один terminal outcome. Ошибка очистки должна иметь безопасный код/краткое описание; нельзя напрямую писать reqwest error с полным URL или body HTTP-ошибки. Redaction на границе logger — защитный слой, а не замена безопасным полям в callers. Не записывать пользовательские настройки целиком. Существующие транскриптные log-сайты заменить длинами/счётчиками, не трогая историю/буфер обмена.

### 5. Ротация стандартной библиотекой

В `logger.rs` оставить синхронный append и общий Mutex. До записи ротировать при превышении 5 МиБ: удалить `.3`, сдвинуть `.2` → `.3`, `.1` → `.2`, active → `.1`. Ограничить одну запись 16 КиБ UTF-8, экранировать CR/LF и управляющие символы, чтобы multiline/provider text не подделывал log records. Максимум active + 3 archives = 20 МиБ. При существующем oversized active сохранить ограниченный хвост с целыми строками, а не архивировать гигабайтный файл целиком. Новые файлы создавать с macOS правами 0600; при открытии существующих ограничить их права, не менять права папки чужих данных.

Очистку active+archives выполнить под тем же Mutex. Ошибки открытия/ротации не должны падать или блокировать диктовку бесконечно, отмечать безопасным stderr-сообщением без рекурсивного logger; не писать сверх лимита, если ротация не удалась. Для тестов выделить private path-parameter helper и использовать существующий tempfile; тесты не трогают `~/.talkee`. Большая async/logging библиотека при текущем объёме не нужна.

`bun run logs` использовать `tail -F`, чтобы переживать rotation. CLI `logs:clear` удаляет четыре точных имени при остановленном приложении; конкурентную очистку работающего приложения выполнять Tauri-командой. Документировать чтение active+archives, сортировку по времени/request_id, реальные поля и privacy policy.

### Concrete files

- `src/windows/widget/hooks/useWidgetHotkey.ts`, `src/windows/widget/services/widgetMachine.ts` и `.test.ts` — выбор override основной/отдельной клавиши и регрессии hold/toggle.
- `src/lib/dictationCleanup.test.ts`, `src/windows/widget/hooks/useWidgetController.ts`, `useWidgetRecording.ts` — snapshot effective-флага, лог trigger/global/override, корректная индикация без перезаписи настроек.
- `src/lib/i18n/dict/settingsGeneral.ts`, `cleanup.ts` — ясные подсказки обычной/forced диктовки.
- `src/lib/textCleanup.ts`, `textCleanup.test.ts` — actual preset cache/selection, сохранение safe-error reason, пустого ввода/fallback и request correlation.
- `src/lib/summarize.ts`, `summarize.test.ts` — совместимая optional metadata передача во все process_text calls.
- `src/windows/widget/services/transcriptionPipeline.ts` — общая диагностика успешной очистки/пропусков/повторной обработки/вставки, no-backend notice, убрать transcript log.
- `src-tauri/src/ai.rs` — dedicated clients, optional metadata/usage/finish_reason, безопасные start/end/errors и убрать transcript log; использовать существующие focused `ai/errors.rs` при нужде, не создавать дублирующий pipeline.
- `src/lib/store.ts` — краткое builtin-описание/temperature синхронизировать с production tech профилем, без изменений custom-промптов.
- `src/config/transcription-prompts/base/common.json`, `styles/tech.json`, `overrides/ru.tech.json`, `manifest.json`, `src-tauri/src/prompt_config.rs` — компактная developer-инструкция и проверка сборки/примеров/version/temperature.
- `src-tauri/src/live_dictation.rs`, `native_voice_recorder.rs`, `realtime.rs` — audit прямых dictation callers: не логировать отражённые runtime/provider ошибки; semantics потоков неизменны.
- `src/lib/logger.ts`, `dictationCleanup.ts`, `src/windows/widget/services/transcriptionPipeline.test.ts`, `scripts/logs.test.mjs` — безопасные поля, источник запуска и регрессии этапов/CLI.
- `src-tauri/src/logger.rs` — bounded rotation/clear/private tests и безопасные записи.
- `package.json`, `docs/audio-pipeline-principles.md`, `docs/privacy.md` — follow rotation, clear semantics, диагностический/сетевой контракт.

## Risks / Trade-offs

- Внешний API не мгновенный → измерять локальный prep, HTTP headers/total, cleanup и paste отдельно; не подменять измерения обещаниями.
- Pooling удерживает соединение после изменения VPN → TTL, отсутствие фоновых запросов/автоповтора POST, ручная смена сети и последующая успешная операция без перезапуска.
- Более короткий prompt может ухудшить точность → синтетические paired examples, сохранение фактов/отрицаний, сравнение пользовательских типов фраз с предыдущей версией; не считать substring unit test доказательством LLM-качества.
- Неоднозначные project-specific имена → сохранять исходное написание; не угадывать по соседним чужим проектам.
- Общий файл dev/release не имеет межпроцессного Mutex → тестировать ротацию при одном процессе; не поддерживать одновременно два писателя в этот файл. Если реальный сценарий требует параллельных экземпляров, понадобится отдельное согласованное изменение межпроцессной блокировки.
- Detailed metadata не содержит текстов → для проверки семантики при необходимости читать пользовательскую локальную историю отдельно, не расширять logging до хранения content.

## Migration Plan

1. Применять на ветке `change/fix-developer-dictation-cleanup`; сначала routing/regression, затем prompts/performance и diagnostics/rotation.
2. Настройки, ключи, комбинации и history schema не мигрировать. Старые log-файлы ограничить при первой записи нового logger.
3. Проверить dev-сборку и сравнить cold/warm диктовки с обеими клавишами; проверить локальные/remote failure и network switch. Не скачивать модели.
4. Запустить gate; release/install только по отдельному запросу. Откат — revert code/JSON; пользовательские настройки не затронуты, archived logs остаются обычным текстом.

## Verification revision

5 октября пользователь явно отказался от ручных задач и выбрал закрытие после прохождения автоматических проверок. Hardware/VPN и живое качество LLM не проверяются в этой сессии. Проверяем routing/effective-state, paired prompt fixtures, reuse/recovery/cancellation в mock HTTP, redaction/correlation и rotation/clear в tempfile; не заявляем измеренное ускорение внешнего API. Спецификации поведения сохраняются.
