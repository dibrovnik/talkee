# Design

## Context

Мотивация и объём — в `proposal.md`. Проверенный текущий код:

- `SettingsApp.tsx` содержит `key={navigationNonce}` над страницами; навигация пересоздаёт их поддерево. `FileTranscriptionTab.tsx` владеет promise и локальным прогрессом, записывает успешную историю только после завершения, в path-сценарии не сохраняет `filePath` результата. Это риск потери отображения/возможности повтора, а не доказанное прекращение Rust-обработки.
- Виджет уже создаёт файловую запись до обработки, использует `beginProcessing` / `finishProcessing` и получает запросы отмены. `processingControl.ts` прямо предполагает владельца в widget-webview. Разные webview не разделяют JS-модули.
- `transcribe_file_path` в `ai.rs` работает нативно и по фрагментам; progress содержит индекс начатого фрагмента, но не длительность/время завершённой работы. Уже есть HTTP-клиенты 120/1800 секунд; нельзя просто увеличить все таймауты и заявить надёжность.
- `lib.rs` предотвращает закрытие settings и скрывает окно. Это сохранить. Полный выход не входит в запрос.
- Обычные созвоны уже пишут дорожки независимо от `saveRecordingAudio`; `pruneHistoryAudioRetention` ограничивает только voice-аудио. Общая история всё же имеет лимит 200 созвонов и 50 МБ индекса; это не обещание вечного хранения. Live translation — отдельный источник, его поведение не менять.
- Есть системные токены, `src/ui`, два режима STT, независимые `llmEndpoint`/`llmModel`, простая очередь `serialTaskQueue`, статистика слов по дням/месяцам. Не вводить второй store или UI-фреймворк целиком.

## Goals / Non-Goals

**Goals:** единый владелец длительных задач, устойчивые подписки интерфейса, небольшая измеряемая модельная подборка и единая визуальная система.

**Non-Goals:** возобновление после выхода/краша, облачная очередь, новая подписка/телеметрия, полная замена Rust-STT, новая чат-функциональность, изменение острова и диктовочных hotkey, автоматическое удаление старых моделей, гарантия «нулевой нагрузки».

## Decisions

### 1. Визуальная система и библиотека

Использовать [Radix Primitives](https://www.radix-ui.com/primitives/docs/overview/introduction) для сложных контролов (Switch, ToggleGroup, Dialog, Tooltip, Select) через текущие публичные wrappers `src/ui`. Radix предоставляет доступное поведение без навязанной темы; это не нативная библиотека macOS. Простые Button/TextField и системный `<select>` сохранять, если их поведение уже достаточно. Добавлять только реально используемые пакеты через bun.

Токены и общие состояния остаются в `src/index.css`; компоненты используют inline styles/CSS variables. Системные шрифты, семантические цвета, темы, accessibility, native chrome сохраняются. Обновить источник истины `rules/style.rule.md`, явно заменить 22 px на 36/40 px только в основном окне. Не увеличивать pill/island/HUD. Боковая панель ориентировочно 240 px, рабочая текстовая колонка до 900 px, шкала отступов 4/8/12/16/24/32 px; при узком окне уменьшать отступы, а не шрифты и hit targets. Не добавлять удалённые шрифты или имитацию светофоров. Образец — структура веб-ChatGPT, не точная копия бренда и не превращение Talkee в чат.

Альтернативы: один CSS-redesign дешевле, но не выполняет запрос готовой библиотеки; Radix Themes/полный shadcn-kit добавляет вторую систему стилей и больше миграции. AppKit требует переписывания React-интерфейса и не нужен для этого объёма.

### 2. Модели: отдельные секции и сохранение совместимости

Секции «Распознавание речи» и «Обработка текста» имеют независимые переключатели API/Локально, отдельные активные подписи и действия «Выбрать», «Скачать», «Проверить». Просмотр категории не переключает настройки. DeepSeek — первый текстовый API-пресет; настройки и ключ пользователя не перезаписывать. Новая установка без ключа не выполняет запросов. API-очистка не прогревает локальную LLM.

Подборка на 01.10.2026 — ограниченный набор уже поддержанных runtime, а не утверждение универсального лидерства:

| Модель | Назначение и ограничение |
| --- | --- |
| [Nemotron 3.5 ASR Streaming 0.6B](https://huggingface.co/nvidia/nemotron-3.5-asr-streaming-0.6b) | основной STT; русский указан среди готовых языков, streaming сохраняется через текущий managed runtime |
| [GigaAM v3](https://huggingface.co/ai-sage/GigaAM-v3) | русскоязычная альтернатива; batch, текущий RNNT-лимит фрагмента ≤25 секунд сохраняется |
| [Whisper large-v3-turbo](https://huggingface.co/openai/whisper-large-v3-turbo) | универсальный резерв и совместимость текущей диаризации; не обозначать как native streaming |
| OpenAI GPT-4o Transcribe / [Groq Whisper Turbo](https://console.groq.com/docs/speech-to-text) | короткая API-подборка; существующие adapters и ручной endpoint сохраняют старые конфигурации |
| [Qwen3 1.7B](https://huggingface.co/Qwen/Qwen3-1.7B), Q4_K_M | компактная локальная очистка, строго без thinking |
| [Qwen2.5 3B Instruct](https://huggingface.co/Qwen/Qwen2.5-3B-Instruct), Q4_K_M | вторая небольшая альтернатива, русский заявлен в карточке |

Для текущего DeepSeek-пресета проверить официальный [список моделей](https://api-docs.deepseek.com/quick_start/pricing/) и [параметры thinking](https://api-docs.deepseek.com/guides/thinking_mode/): на дату просмотра указан `deepseek-flash`, thinking включён по умолчанию. Сохранённое имя пользователя не мигрировать вслепую; новый пресет использует поддержанный ID и явное отключение thinking. Проверка подключения — только по действию пользователя.

Каталоги рекомендаций сократить, но техническое распознавание старых ID и установленных файлов оставить; ранее выбранная модель показывается отдельно с пометкой, не теряется при запуске. Не удалять backend поддержки только ради короткого UI. Не устанавливать модели автоматически. Реальные показатели RSS/времени измерять отдельно от размера GGUF.

Перед отметкой локальной текстовой модели как рекомендованной проверить минимум 20 русских примеров: слова-паразиты, числа, имена, самокоррекция, технические термины, смешанный RU/EN, уже чистый текст. Не допускаются изменение фактов и добавление ответа вместо очистки. Учитывать нынешний deadline 12 секунд; при непрохождении оставить модель доступной без рекомендации и зафиксировать ограничение, не подменять набор на большую модель. Сохранить существующий ограниченный контекст runtime (сейчас 4096) и non-thinking-защиту sidecar. Никаких 7–8B в новых рекомендациях.

### 3. Файловые задачи: использовать существующего владельца

Создать `src/lib/fileTranscriptionJobs.ts`: общий runner, типы задачи и клиентский контракт. Единственный исполняющий экземпляр регистрируется в постоянном widget-webview. Settings и widget-drop отправляют запрос с `jobId` и native path; service принимает его один раз, создаёт processing-history, ставит задачи в существующую последовательную очередь, вызывает `transcribeFilePathOnly`, завершает историю ровно один раз. Повтор доставки того же `jobId` возвращает snapshot, а не запускает заново.

Контракт событий: start request, snapshot request/response и update; snapshot содержит jobId/historyId, имя файла, queued/running/completed/failed/interrupted, этап, elapsed, completed audio seconds/total audio seconds, ETA либо null и понятную ошибку. Ключи/endpoint-секреты не передавать через события: владелец загружает settings перед стартом и фиксирует конфигурацию задачи. На позднюю подписку UI получает snapshot; события не являются единственным хранилищем результата. Terminal-result находится в обычной истории; in-memory реестр ограничивается активными/последними задачами, подписки очищаются без отмены выполнения.

Вкладка выбирает путь, отображает snapshot/историю и отправляет explicit cancel. DOM File-сценарий не использовать для больших файлов: нативный диалог/drag-drop должен возвращать path. Настройка диаризации остаётся до запуска; переход к ней не является обработкой. Нативный pipeline работает при скрытом settings-webview; UI timers не управляют его жизнью. Если скрыт и виджет, Rust продолжает inference; после возвращения UI сверяется со snapshot, а не с устаревшим setState.

Для отмены связать jobId/requestId с cooperative cancellation в Rust: проверять до/после подготовки и между фрагментами, отменять только HTTP текущей задачи где поддержано, освобождать временные файлы, не останавливать общий runtime. Late result не сохранять как success. Сохранённые завершённые фрагменты можно показать как неполный draft в рамках текущей сессии, не выдавая за завершённую транскрипцию. Не вводить restart-checkpoints.

Альтернатива — только снять React key: маленькая правка, но оставляет дублирующие widget/settings pipelines и не решает snapshot/общую отмену. Новый Rust scheduler с постоянной очередью избыточен для требования без restart recovery.

### 4. Честный ETA и streaming

Расширить нативный progress данными общего аудиовремени, длительности завершённых фрагментов и времени их обработки (монотонный clock). Не путать chunk-start и chunk-complete. Для plain streaming передавать request ID и частичный текст только если существующий протокол runtime предоставляет надёжные обновления; не создавать иллюзию потока таймером.

После двух завершённых фрагментов вычислять сглаженное отношение wall time / audio seconds; ETA этапа = оставшееся audio seconds × отношение. Неравные фрагменты учитываются по секундам, нулевая длительность даёт null. Холодный запуск/подготовку не включать в скорость inference. Общий процент не достигает 100 до завершения сборки. Для подготовки/диаризации без измерений — indeterminate и «Оцениваем время»; при STT с предстоящей неизвестной сборкой показывать «Распознавание: осталось примерно …», а не гарантированный остаток всего задания. После успешного завершения ETA = 0. Обновления UI ограничить примерно 250–500 мс, без бесконечного high-frequency polling.

Сохранить path-based input, 8 ГБ лимит backend, существующий чанкинг, no-proxy loopback, эффективный dynamic endpoint и warmup reuse. Проверить actual HTTP-клиент в каждом STT/file/diarization пути; использовать bounded long-client для длинных запросов, не переносить его на dictation cleanup. Не обещать, что таймаут/потеря сети невозможны: ошибка остаётся явной, исходный путь и готовый draft доступны для повтора.

### 5. Трей и независимое аудио созвонов

Новый пункт трея отправляет действие widget-owner к тому же `startCallListening`, что использует кнопка виджета. Проверки разрешений/микрофона, mutual exclusion и live sessions остаются единственными. При active call пункт меняется на «Остановить запись созвона»; при starting/stopping или несовместимой записи блокируется. Backend не доверяет одному визуальному disabled.

Не добавлять новый параметр сохранения: обычные call tracks уже durable. Закрепить поведение тестами для выключенного saveRecordingAudio, успешного/ошибочного STT и voice-retention. Настройку переименовать в «Сохранять аудио диктовки», добавить пояснение о созвонах. Общее удаление/лимиты истории не менять; liveTranslation не включать в новую политику. Ошибки сохранения отражать в UI и логе без секретов.

### 6. Локальная аналитика без второй системы хранения

Расширить текущие statsCore/stats; версия схемы 3 с агрегатами по локальному дню × source × STT model: words, completedCount, audioSec, processingSec, voiceWords/audioSec/processingSec для строк с полными измерениями. Никаких транскриптов, ключей, путей и названий приложений в статистике. Источник модели фиксировать при выполнении, а не читать сегодняшние настройки для старой записи.

Из старой v2 сохранить all-time/day/month/voice totals; детали разрезов начинаются с обновления, в UI показывать границу полноты. Не пересчитывать всю старую историю автоматически и не добавлять её поверх уже накопленных totals. Не выдумывать processingSec=0 для отсутствующих данных. Экономию пересчитывать из полных voice-агрегатов при изменении typingWpm; отдельно показывать долю записей без измерений.

Статистику записывать через одного владельца и последовательную очередь, продумать повтор финализации после окна/события: повтор `updateHistoryEntry` completed-entry не должен снова считать её даже после выпадения из текущих 600 remembered IDs. Сохранять маркер/receipt в метаданных записи и проверять прежний terminal status; не хранить неограниченный массив идентификаторов ради дедупликации. Ошибки статистики не ломают основную историю.

`typingWpm` — optional, диапазон 5–250. Тест 60 секунд считает совпадающие введённые слова/текст и ошибки, отмена ничего не сохраняет, paste исключён; материал теста локальный. Графики SVG с текстовым summary/таблицей для VoiceOver, фильтры 7/30/90/all, source/model. Нет отдельной chart-library и нет сторонних запросов.

### 7. Конкретные файлы

Все пути ниже относительно корня `/Users/macbookair/Desktop/Работа/talkee`:

| Пути | Причина |
| --- | --- |
| `rules/style.rule.md`, `src/index.css`, `src/ui/{Button,Toggle,SegmentedControl,SelectMenu,Gallery}.tsx`, новые wrappers `src/ui/{Dialog,Tooltip}.tsx`, `src/ui/index.ts`, `package.json`, `bun.lock` | новые размеры, поведение Radix и единые состояния |
| `src/windows/settings/SettingsApp.tsx`, `settingsNavigation.ts`, `settingsNavigation.test.ts`, `src/lib/hotkeyEvents.ts`, `src-tauri/src/commands/settings_window.rs` | shell, маршруты статистики и существующие deep links |
| `src/windows/settings/tabs/{MainTab,FileTranscriptionTab,SettingsTab,DevChatTab,TranslationTab}.tsx`, `tabs/style/StyleTab.tsx` | согласованная рабочая область и действия без расширения функций |
| `src/windows/settings/tabs/model/{ModelsTab,TextModelCard}.tsx`, `tabs/useSettingsTabsState.ts`, `tabs/settingsTabsTypes.ts`, `src/components/{LocalLlmModels,LocalSttModelCard}.tsx` | независимые секции и небольшой видимый каталог |
| `src/lib/{modelMode,localLlmSelection,store}.ts`, `src-tauri/src/{local_stt,llm_runtime}.rs`, `src-tauri/sidecars/talkee-llm/src/main.rs`, `src-tauri/src/ai.rs` | defaults, compatibility IDs, каталог LLM, non-thinking DeepSeek и сохранение действующих budgets |
| `src/lib/fileTranscriptionJobs.ts`, `src/lib/fileTranscriptionJobs.test.ts`, `src/lib/{fileTranscription,processingControl,hotkeyEvents}.ts`, `src/windows/widget/Widget.tsx` | единственный runner, lifecycle, request IDs и подписки |
| `src/lib/fileTranscriptionEta.ts`, `src/lib/fileTranscriptionEta.test.ts`, `src-tauri/src/ai.rs`, новый `src-tauri/src/ai/file_jobs.rs`, `src-tauri/src/lib.rs`, `src-tauri/src/media/{types,file_prep,probe}.rs` | completed progress, длительности, cancellation, ETA и долгие HTTP paths |
| `src-tauri/src/tray.rs`, `src/windows/widget/Widget.tsx`, `src/lib/{callCapture,hotkeyEvents}.ts`, `src/lib/historyAudioRetention.test.ts` | старт/стоп созвона из трея и тест независимого хранения |
| `src/lib/{statsCore,stats,store}.ts`, `src/lib/statsCore.test.ts`, `src/windows/settings/tabs/StatsTab.tsx`, `src/components/TypingSpeedTest.tsx`, `src/lib/typingSpeed.ts`, `src/lib/typingSpeed.test.ts` | схема агрегатов, измерение печати, графики |
| `src/lib/i18n/dict/{settingsModels,settingsGeneral,settingsRest,settingsTabsMisc,widget,components}.ts` | новые сообщения через существующий i18n |
| `docs/{audio-pipeline-principles,local-stt-runtime,privacy}.md`, `docs/architecture/{overview,processing-modes}.md`, `docs/testing/manual-style-test-plan.md`, `CHANGELOG.md` | обновлённые контракты и проверки |

## Risks / Trade-offs

- Headless-библиотека сама по себе не делает интерфейс красивым → единые токены и визуальная проверка всех основных страниц в обеих темах на macOS WKWebView.
- Русскоязычная карточка модели не доказывает качество очистки и RSS → русский evaluation set, измерение холодного/тёплого latency и памяти; результаты записать здесь перед рекомендацией.
- Widget.tsx уже велик → вынести только файловый runner по устойчивой границе, не делать попутный рефакторинг созвонов/перевода.
- ETA меняется с нагрузкой и backend → приблизительная маркировка и null вместо ложной точности.
- История/статистика могут обновляться из разных webview → один writer событий статистики, сериализация и тест конкурентных финализаций.
- Call-аудио расходует диск → понятное пояснение, ошибки I/O и действующие лимиты/явное удаление; новое автоматическое удаление вне объёма.
- Большая миграция внешнего вида → внедрять wrappers/страницы последовательно, сохранять keyboard contracts и доступность.

## Migration Plan

1. Работать на `change/polish-daily-workflow`, не перемешивать текущую CPU-правку. Менять только план до отдельного запроса на apply.
2. По задачам обновить tokens/wrappers, затем модели и tray, затем job-owner/ETA, затем analytics. Не устанавливать пользовательские модели/ключи автоматически.
3. Settings additions имеют безопасные optional defaults, stats v2 → v3 сохраняет totals. Старые model IDs поддерживаются; history paths и source остаются совместимыми.
4. Перед выпуском пройти gate и ручную матрицу, обновить changelog без bump/commit/install до отдельного запроса.
5. Откат к прежнему UI не удаляет модели/аудио. При откате новой статистики сохранить backup stats-схемы; старые defaults должны игнорировать новые optional поля, а не стирать их намеренно.

### Проверка primitives — 2026-10-01

- `bun install --frozen-lockfile`, `bunx tsc --noEmit`, `bun test src/ui` (11 тестов) и `git diff --check` прошли.
- DEV Gallery запущена в WebKit через localhost:14320/?ui-gallery=1, светлая и тёмная темы визуально проверены. Контролы читаемые; узкая колонка переносит кнопки.
- Space выключает Switch; Right выбирает тёмную тему в RadioGroup; Down/Enter выбирает «Локально» в SelectMenu. Escape закрывает список с возвратом фокуса.
- Dialog автофокусирует поле; два Tab циклически возвращают фокус в поле; Escape закрывает и возвращает его на кнопку открытия. Tooltip показан при Tab-фокусе и доступен в AX. Disabled-семантика и доступные имена дополнительно покрыты SSR-тестом.
- Нативные AppKit/traffic lights/Reduce Motion/Transparency ещё не проверены; нативные проверки выполняются отдельно в задачах раздела 2.

### Нативная проверка workspace — 2026-10-01

- Talkee Dev собран и запущен через штатный macOS runner; абсолютный путь runner необходим при прямом вызове Tauri CLI.
- Проверены реальные светлая/тёмная темы настроек. Найден и исправлен недостаточный контраст: native material оставался тёмным при смене WebKit color-scheme. Workspace теперь использует системный Canvas и полупрозрачный Canvas-tint для sidebar; pill/island не затронуты.
- После проверки сохранённая тема возвращена на исходную «Системная». История/ключи/модели не изменялись, запись/сетевые AI-запросы не запускались.
- shell получил адаптивный sidebar 208–240 px и читаемую колонку 900 px; история — увеличенные интервалы и действия 32 px. Задачи 2.1–2.2 не закрыты: полный набор операций и минимальный размер ещё не проверены. Попытки resize через CUA не изменили размер окна, их не считаем проверкой.
- Пользователь запретил скачивать модели для benchmark. Уже установлен Qwen3 1.7B Q4_K_M; Qwen2.5 3B Q4_K_M отсутствует в managed model directory. Парное сравнение задачи 3.6 без разрешения на загрузку выполнить нельзя; не делать неподтверждённых рекомендаций.

### Tray call implementation — 2026-10-01

- Native menu start/stop delegates explicitly to widget; menu action is consumed atomically until phase sync, transitional/conflicting states disable start. Updates serialized in frontend. Shared call guards use synchronous refs, avoiding duplicate starts/stops before React commit. Rejected/stale events resync menu in finally.
- `cargo test ... tray::tests --lib`: 2 pass. Focused call/retention tests: 11 pass, including mic+system track preservation after success/failure and dictation saving OFF. Call path never reads saveRecordingAudio, so no retention pipeline rewrite was needed.
- Label now says «Сохранять аудио диктовки», explains independent call audio. Docs retain explicit deletion, 200-call/50 MB history and separate live translation policy.
- Tasks4.2/4.4 remain unverified: actual tray start/stop, permission refusal, playback/retry/delete on disposable capture were not performed. No user audio was captured or uploaded.

### File owner / progress verification (2026-10-01)

- Added Widget-owned serial jobs, path-only settings client, versioned snapshot merge,
  same-owner widget drop/history retry, processing history before inference and retained
  filePath. Focused jobs/client tests cover duplicate IDs, queue failure/cancellation,
  late success suppression, snapshot ordering and credential-free requests.
- Native durations come from FFmpeg segment CSV (short last segment included) or
  ready-WAV metadata; separate completed chunks/audio seconds and measured transcription
  elapsed feed an estimator. Cold start and unknown stages have no fabricated ETA.
- Signed Talkee Dev native test uses a local MP4 copy (1821.218 s, 15,520,280 bytes)
  of an authorized user meeting WebM; original unchanged, local Nemotron endpoint
  `127.0.0.1:8000`, speaker separation off. No remote transcription or model download.
- Job `59322f2e-eaa6-43f8-9133-008607a4cf83` was visible in history before inference.
  Switched to Main, closed settings via red traffic light, reopened through app menu
  Settings and selected Files: same running task restored at chunk 3/8, elapsed 2:14,
  measured ETA approximately 5:02. Native logs show one start and continued chunks.
- Final completion/uniqueness is still under observation; native drag-drop, cooperative
  cancellation, bilingual/theme transcript review and full WAV/GigaAM/diarization matrix
  are not yet claimed complete. Cancellation currently suppresses late UI/history
  success but waits for the native request to settle before releasing the queue.
