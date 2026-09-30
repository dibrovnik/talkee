# Архитектура Talkee

Карта модулей приложения: что делает каждый файл верхнего уровня и какие команды
или экспорты он предоставляет. Подробности по режимам — в
[processing-modes.md](processing-modes.md), по аудио — в
[docs/audio-pipeline-principles.md](../audio-pipeline-principles.md).

Talkee — macOS-приложение (Apple Silicon): Rust-бэкенд Tauri v2 и React/TypeScript
фронтенд. Две native-окна: плавающий виджет и окно настроек.

## Rust-бэкенд (`src-tauri/src`)

| Файл / модуль | Ответственность | Ключевые команды / экспорты |
| --- | --- | --- |
| `lib.rs` | Точка входа Tauri: сборка `Builder`, плагины, регистрация команд, окна. | `setup`, `run` |
| `main.rs` | Бинарная точка входа десктопного приложения. | `main` |
| `ai.rs` | API-транскрибация и очистка текста (Whisper/LLM по HTTP), маршрутизация моделей, фильтрация галлюцинаций. | `transcribe_only`, `transcribe_and_clean`, `process_text`, `test_api_connection`, `get_cleanup_prompt_preview` |
| `ai/routing.rs` | Выбор endpoint и модели для API-режима. | маршрутизация адаптеров |
| `ai/errors.rs` | Типы ошибок AI-слоя и их маппинг. | `AiError` |
| `realtime.rs` | Realtime-сессии распознавания и перевода (WebSocket). | `start_live_translation`, `stop_live_translation`, `test_realtime_connection` |
| `live_translation.rs` | Синхронный перевод системного звука и озвучка. | команды жизненного цикла перевода |
| `live_dictation.rs` | Потоковая диктовка: промежуточный текст и финальный batch. | потоковые события диктовки |
| `local_stt.rs` | Управляемый локальный STT runtime (`transcribe.cpp`). | `list_stt_models`, `install_stt_model`, `delete_stt_model`, `warm_up_local_stt_runtime`, `get_local_stt_default_models_dir` |
| `llm_runtime.rs` | Управляемый локальный GGUF LLM runtime для саммари. | `start_local_llm`, `stop_local_llm`, `download_local_llm_model`, `list_local_llm_models`, `get_llm_download_progress` |
| `local_translator.rs` | Локальный перевод текста (CTranslate2 / OPUS-MT). | `list_local_translators`, `download_local_translator`, `delete_local_translator`, `translate_with_local_translator` |
| `local_translator/text_units.rs` | Разбиение текста на проверяемые единицы перевода. | `split_text_units` |
| `call_capture.rs` | Захват микрофона и системного звука macOS, сборка транскрипта созвона. | `start_call_capture`, `stop_call_capture`, `pause_call_capture_mic`, `resume_call_capture_mic`, `recover_call_capture_sessions`, `checkpoint_call_transcription` |
| `call_capture/microphone.rs` | Сбор дорожки микрофона внутри сессии созвона. | внутренний API записи |
| `native_voice_recorder.rs` | Нативная запись микрофона (`cpal`), WAV 16 kHz mono PCM16. | `start_native_voice_recording`, `stop_native_voice_recording`, `pause_native_voice_recording`, `resume_native_voice_recording` |
| `media/` | Подготовка и конвертация медиа, probe, чанкинг, запуск ffmpeg. | `prepare_media_for_transcription` |
| `media/ffmpeg.rs` | Обёртка вызовов ffmpeg и тайминги. | конвертация/чанкинг |
| `media/file_prep.rs` | Подготовка произвольных файлов к транскрибации. | подготовка входных файлов |
| `media/probe.rs` | Определение формата/длительности через probe. | `probe_media` |
| `media/local_stt.rs` | Приведение аудио к WAV 16 kHz mono PCM16 для локального STT. | конвертация под локальный STT |
| `media/paths.rs` | Пути рабочих каталогов медиа. | хелперы путей |
| `media/types.rs` | Общие типы медиа-слоя. | структуры запросов/ответов |
| `history_storage.rs` | Локальное хранилище истории и аудиодорожек (файловый I/O). | `read_history_index_file`, `write_history_file`, `save_history_audio`, `read_history_audio`, `delete_history_audio` |
| `paste.rs` | Вставка результата в активное приложение (clipboard + системное нажатие). | `paste_text`, `copy_selected_text`, `remember_paste_target_window` |
| `hotkey_manager.rs` | Регистрация и снятие глобальных горячих клавиш. | `register_handy_hotkey`, `unregister_handy_hotkey` |
| `hotkey_capture.rs` | Нативный захват аккорда горячей клавиши. | `start_native_hotkey_capture`, `stop_native_hotkey_capture` |
| `prompt_config.rs` | Конфигурация промптов и стилей транскрибации. | загрузка промптов |
| `logger.rs` | Файловое логирование (`~/.talkee/talkee.log`). | `log_event`, `get_log_path_cmd`, `clear_logs` |
| `download_cancel.rs` | Отмена активных загрузок моделей. | `cancel_local_model_download` |
| `legacy_migration.rs` | Одноразовая миграция данных из прежней идентичности приложения. | `migrate_app_data_layout` |
| `shutdown.rs` | Корректное завершение управляемых sidecar-процессов. | завершение runtime |
| `tray.rs` | Постоянный системный трей (Open Talkee / Quit). | инициализация трея |
| `commands/widget.rs` | Команды окна виджета: размеры, уведомления, текстовая плашка. | `widget_resize`, `show_widget_notice`, `hide_widget_notice`, `show_widget_text_overlay`, `hide_widget_text_overlay` |
| `commands/widget_visibility.rs` | Показ/скрытие и активация виджета. | `activate_widget_for_hotkey` |
| `commands/accessibility.rs` | Проверка и сброс Accessibility, открытие системных настроек. | `check_accessibility_permission`, `reset_accessibility_permission`, `open_accessibility_settings` |
| `commands/settings_window.rs` | Открытие окна настроек и вкладок. | `open_settings`, `open_settings_tab`, `set_settings_titlebar_theme` |
| `commands/runtime_info.rs` | Сведения о runtime приложения. | `get_app_runtime_info` |
| `bin/talkee-stt.rs` | Managed local STT runtime (sidecar). | бинарь `talkee-stt` |
| `bin/talkee-diarize.rs` | Managed diarization runtime (sidecar). | бинарь `talkee-diarize` |

## Frontend (`src`)

Точка входа — `src/main.tsx`, она маршрутизирует в окно виджета или настроек.

### `src/lib`

| Файл | Ответственность |
| --- | --- |
| `store.ts` | Постоянные настройки и история через `tauri-plugin-store`, валидация горячих клавиш, промпты. |
| `logger.ts` | Логирование из фронтенда. |
| `permissions.ts` | Проверка и запрос системных разрешений (микрофон, Accessibility, системный звук). |
| `modelMode.ts` | Определение активного режима обработки (API / Локально). |
| `processingControl.ts` | Реестр отмены активных задач транскрибации. |
| `serialTaskQueue.ts` | Последовательная очередь задач. |
| `stats.ts` / `statsCore.ts` | Статистика слов: события обновления и чистая логика подсчёта. |
| `summarize.ts` | Саммари и map-reduce обработка длинных текстов. |
| `fileTranscription.ts` | Сценарий транскрибации файлов и повтор прерванных записей. |
| `callCapture.ts` | Клиент захвата созвонов и сборка транскрипта. |
| `realtimeModels.ts` | Каталог realtime-адаптеров и проверка capability. |
| `localLlmSelection.ts` | Выбор и отключение локальной текстовой модели. |
| `onboarding.ts` | Логика первого запуска и проверочной фразы. |
| `transcriptionPrompts.ts` | Стили транскрибации. |
| `hotkeyEvents.ts` | Имена и типы оконных событий горячих клавиш. |
| `hotkeyPreview.ts` | Предпросмотр аккорда клавиш. |
| `historyEmbeddings.ts` | Embeddings для поиска по истории. |
| `offlineHistorySearchTemplates.ts` | Offline-шаблоны поиска по истории. |
| `devChatHistoryContext.ts` / `devChatScope.ts` | Контекст и ограничения dev-чата. |
| `theme.ts` | Тема оформления. |
| `widgetScale.ts` | Масштаб виджета. |
| `icons.ts` | Фасад иконок приложения. |
| `utils.ts` | Общие хелперы (`cn`, форматирование ошибок и длительности). |
| `i18n/` | Словари строк и провайдер локализации. |
| `../config/` | Языки, модели онбординга и промпты транскрибации. |

### `src/windows`

| Каталог | Ответственность |
| --- | --- |
| `widget/` | UI индикатора записи. Два представления одного окна `widget`: плавающая пилюля (`pill/`) и остров у выреза (`island/`). Режим `widgetPresentation` и запасной вариант без выреза `islandFallback` живут в настройках. Хуки `useWidgetController`, `useWidgetHotkey`, `useWidgetRecording`, `useWidgetNotice`, сервисы `recordingRuntime`, `transcriptionPipeline`, `hotkeyFsm`/`hotkeyTransaction`, `liveTranslation`, `callMicrophone`, `selectionTranslation`, `widgetConstants`. |
| `settings/` | Окно настроек: `SettingsApp.tsx`, навигация, захват горячих клавиш и вкладки `tabs/` (Main, FileTranscription, Translation, RealtimeTranslationModels, DevChat). |

### `src/components`

| Ответственность | Файлы |
| --- | --- |
| Общие контролы и модалки | `SlideOverModal`, `RowActionsMenu`, `SummaryModal`. Примитивы (`Button`, `PopUpButton`, `FormSection` и др.) — в `src/ui/`. |
| Горячие клавиши | `DictationHotkeyControl`, `HotkeyKeycaps`, `useLiveHotkeyPreview`. |
| Модели и разрешения | `LocalLlmModels`, `LocalSttModelCard`, `ModelCardDisclosureButton`, `PermissionScreen`. |
| История, запись и статистика | `HistoryAudioTrack`, `Waveform`, `SpeakerNameInput`, `TranscriptionStatsPanel`. |
| Онбординг | `onboarding/OnboardingFlow`, `OnboardingShell`, `OnboardingModelStep`, `OnboardingTestStep`, `OnboardingConfetti`. |

## Related documents

- [processing-modes.md](processing-modes.md) — режимы API и Локально.
- [../audio-pipeline-principles.md](../audio-pipeline-principles.md) — правила аудио-пайплайна.
- [../local-stt-runtime.md](../local-stt-runtime.md) — локальный STT runtime.
- [../privacy.md](../privacy.md) — приватность.
- [../../rules/style.rule.md](../../rules/style.rule.md) — UI-стиль.
- [../../rules/release.rule.md](../../rules/release.rule.md) — релизный процесс.
