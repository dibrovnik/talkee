# Design

## Context

Аудит (29.09.2026, строки до переименования; после `rename-to-talkee` файлы называются `talkee-*`):

- **STT sidecar** `src/bin/talkee-stt.rs`:
  - движок transcribe-cpp 0.1.1 (семейство ggml), на macOS с `metal`;
  - HTTP-сервер создаёт поток на каждое соединение (252-266);
  - `Model::load(&path)` вызывается в `transcribe` (738), `transcribe_streaming` (848) и `transcribe_live` (941), кеша нет;
  - `RunOptions` (1118-1165) не задают потоки;
  - `init_backends_default()` (1092-1110).
- **Управление sidecar'ом** `local_stt.rs`: spawn (1231-1271), polling готовности (1217), `sleep` по 700 мс (1419-1439).
- **LLM sidecar** `sidecars/talkee-llm`:
  - llama-cpp-2 0.1.150 с фичами `openmp`, `sampler` и `metal` на macOS;
  - `with_n_gpu_layers(999)` (main.rs:56), `DEFAULT_CTX` 4096, `n_threads` не задан (375);
  - модель под Mutex.
- **Переводчик** `local_translator.rs`: ct2rs 0.9.19 с `all-tokenizers` и `ruy`, `Device::CPU`, `ComputeType::AUTO` (484-489, 787-789). В ct2rs есть фича `accelerate` (проверено по crates.io).
- **Рекордер** `native_voice_recorder.rs`: cpal (CoreAudio), линейный ресемплинг до 16 кГц. События уровня не отправляются: `stream = null` в `useWidgetRecording.ts:457`, поэтому волна анимируется без реального сигнала.
- **ffmpeg**:
  - `media/ffmpeg.rs:44` — sidecar с fallback на системный ffmpeg;
  - используется в `media/file_prep.rs` (170, 257, 315, 369) и `media/local_stt.rs:31-48`;
  - нативный WAV 16 кГц mono PCM16 обходит ffmpeg (`media/local_stt.rs:17`).
- **Frontend**:
  - `Widget.tsx:2382-2440` — `setInterval` раз в 80 мс, внутри три IPC (`cursorPosition`, `position`, `size`); `getCurrentWindow()` пересоздаётся на каждом рендере (2398), поэтому интервал перевзводится;
  - `Widget.tsx:2625` — rAF без ограничения частоты;
  - `components/Waveform.tsx:24` уже ограничивает частоту до 30 fps, это образец;
  - `index.css:227,533` — `backdrop-filter: blur(...)`.
- **Сборка**: `[profile.release]` отсутствует; `MACOSX_DEPLOYMENT_TARGET=11.0` (`scripts/build-release.mjs:58`, `build-release-macos.sh`); `minimumSystemVersion: "11.0"`.
- **Мёртвая зависимость**: `window-vibrancy` нигде не используется.

## Goals / Non-Goals

**Goals:** бюджеты из спеки, воспроизводимые замеры.

**Non-Goals:**
- Смена STT-движка или моделей.
- CoreML/ANE. transcribe-cpp 0.1.1 не даёт фичи CoreML: есть только `cuda`, `metal`, `openmp`, `vulkan`, `dynamic-backends`, `shared`. Вернуться к этому, если появится поддержка.
- Streaming-архитектура.

## Decisions

1. **Кеш модели в STT sidecar'е.**
   - Структура `ModelCache { key: (PathBuf, SystemTime /*mtime*/), model: Arc<Model>, last_used: Instant }` под `Mutex`, глобально в процессе sidecar'а.
   - `get_or_load(path) -> Arc<Model>` отдаёт модель из кеша при совпадении ключа, иначе загружает новую, а старую освобождает.
   - Все три вызова `Model::load` заменить на `get_or_load`.
   - Если `Model` не `Send + Sync`, запросы к модели сериализуются через `Mutex<Model>`. Для одного пользователя это допустимо: STT-запросы и так идут последовательно.
   - Фоновый поток раз в 30 с проверяет `last_used`. При простое дольше `--idle-unload-secs` (по умолчанию 600) модель выгружается. Аргумент передаёт `local_stt.rs`.
   - Новые HTTP-эндпоинты sidecar'а:
     - `POST /v1/warmup {"model": "<id>"}` — загружает модель, отвечает 200 после загрузки;
     - `GET /v1/status` — возвращает `{loaded_model, last_used_secs}`.
   - Логи: `model_load_ms` (0 при попадании в кеш), `inference_ms`.
2. **Прогрев — расширить существующий механизм, не дублировать.**
   - Уже есть команда `ai::warm_up_local_stt_runtime` (регистрация `lib.rs:210`) и клиентский `warmUpLiveDictationRuntime` + `waitForRuntimeWarmUpWithinBudget` (`src/windows/widget/services/runtimeWarmup.ts`, вызов `useWidgetRecording.ts:352-432`). Сейчас прогрев запускается только при включённой потоковой диктовке (`localLiveStreamingEnabled`) и поднимает процесс runtime, но не загружает модель.
   - Изменить: (а) в `warm_up_local_stt_runtime` после готовности runtime отправлять `POST /v1/warmup` с выбранной моделью; (б) в `useWidgetRecording.ts` запускать прогрев в режиме «Локально» всегда; для batch-режима — fire-and-forget, без ожидания бюджета и без блокировки старта записи.
   - Логику бюджета для потоковой диктовки не менять; `runtimeWarmup.test.ts` должен остаться зелёным.
3. **Потоки.**
   - Хелпер `perf_core_count()` читает `sysctlbyname("hw.perflevel0.physicalcpu")`, при ошибке берёт `std::thread::available_parallelism()`.
   - В обоих sidecar'ах он дублируется маленькой функцией: у них нет общего крейта, заводить его ради одной функции не нужно.
   - Где применяется:
     - STT: поле потоков в `RunOptions`/`WhisperRunOptions`, если API его предоставляет (проверить по документации transcribe-cpp 0.1.1); если нет — пропустить с комментарием;
     - LLM: `n_threads` и `n_threads_batch`;
     - ct2rs: `num_threads_per_replica` / `intra_threads` в конфиге транслятора.
4. **Фичи крейтов.**
   - `ct2rs = { version = "0.9.19", default-features = false, features = ["all-tokenizers", "accelerate"] }`.
   - Из `llama-cpp-2` убрать `openmp`, оставить `sampler` и `metal`.
   - После изменения прогнать тесты переводчика и LLM и сравнить время на фиксированном входе с замером «до».
5. **Release-профиль** в `src-tauri/Cargo.toml` на уровне workspace:
   ```toml
   [profile.release]
   opt-level = 3
   lto = "fat"
   codegen-units = 1
   strip = true
   debug = false
   ```
   - `panic` остаётся `unwind`: код может использовать `catch_unwind`, а поведение менять не нужно.
   - `target-cpu`: в `scripts/build-release-macos.sh` по умолчанию `RUSTFLAGS="-C target-cpu=native"`, переопределяется через `TALKEE_TARGET_CPU`.
   - В CI используется `apple-m1`, чтобы собранный артефакт запускался на любом Apple Silicon.
6. **macOS 14.0.**
   - `tauri.conf.json`: `bundle.macOS.minimumSystemVersion = "14.0"`.
   - Во всех скриптах `MACOSX_DEPLOYMENT_TARGET=14.0`.
   - Это же открывает API, нужные для notch-режима (`NSScreen.safeAreaInsets`, macOS 12+).
7. **Минимальный ffmpeg.**
   - Сначала составить список фактически используемых фильтров и форматов вывода: `grep -n '"-af"\|"-filter\|"-f"\|"-acodec"\|"-c:a"\|"-ar"\|"-ac"' src-tauri/src/media/*.rs`.
   - Переписать `scripts/prepare-ffmpeg-sidecar.mjs`:
     - скачать исходники ffmpeg фиксированной версии (последний стабильный 7.x) с `https://ffmpeg.org/releases/ffmpeg-<v>.tar.xz` и проверить SHA256, прописанный в скрипте;
     - кешировать в `src-tauri/target/ffmpeg-build/`;
     - собрать с флагами `--disable-everything --disable-autodetect --disable-network --disable-doc --disable-programs --enable-ffmpeg --disable-ffplay --disable-ffprobe --enable-small --disable-gpl --disable-nonfree --arch=arm64 --cc=clang --extra-cflags=-mmacosx-version-min=14.0`;
     - включить `--enable-protocol=file,pipe`;
     - демультиплексоры: `mov,matroska,ogg,mp3,wav,flac,aac,aiff,caf,m4a` (для имён, которых нет в `ffmpeg -demuxers`, использовать фактическое, например `mov` покрывает mp4/m4a);
     - декодеры: `aac,mp3,mp3float,opus,vorbis,flac,alac,pcm_s16le,pcm_s24le,pcm_s32le,pcm_f32le,pcm_s16be,pcm_mulaw,pcm_alaw,amrnb,amrwb` — только аудио: видеодекодеры не нужны, потому что при `-vn` видеопоток отбрасывается без декодирования;
     - энкодер: `pcm_s16le`; мультиплексоры: `wav,pcm_s16le` (или `s16le`);
     - фильтры: `aresample,aformat,anull,atrim,pan,volume` плюс найденные grep'ом;
     - `--enable-audiotoolbox` — позволяет декодировать AAC/ALAC системными кодеками.
   - Если `ffprobe` используется в `media/probe.rs`, заменить probe на `ffmpeg -i` с разбором stderr или включить `--enable-ffprobe`. Проверить по коду и выбрать минимальный вариант.
   - Удалить `ffmpeg-static` из `devDependencies`.
   - Лицензия: LGPL-сборка без GPL-компонентов. Сохранить `configure`-флаги и ссылку на исходники в `docs/third-party/ffmpeg.md`.
8. **Уровень звука.**
   - `native_voice_recorder.rs`: в callback'е cpal копить RMS/peak окна и раз в 50 мс (20 Гц) эмитить событие `native-voice-level {rms: f32 (0..1), peak: f32}`.
   - Эмитить через канал в отдельный поток, не из аудиопотока напрямую.
   - `useWidgetRecording.ts` подписывается на событие и передаёт уровень туда, где сейчас используется `AnalyserNode`.
   - Через этот же интерфейс уровня потом будет работать notch-режим.
9. **Hover без опроса.**
   - Сначала попробовать DOM-события `pointerenter`/`pointerleave` на корневом элементе пилюли. У окна уже включены `acceptFirstMouse` и `setAcceptsMouseMovedEvents` (`commands/widget.rs:42-69`), поэтому WKWebView должен получать события движения мыши и без фокуса.
   - Проверить вручную: навести курсор, когда активно другое приложение.
   - Если не работает — оставить опрос, но раз в 250 мс, только пока окно видимо, с `widgetWindow` из `useMemo`/`useRef` и остановкой при `document.hidden`.
   - Удалить три IPC на тик: брать геометрию окна один раз и обновлять её по событиям `onMoved`/`onResized`.
10. **Волна.** В `Widget.tsx` ограничить rAF до 30 fps по образцу `Waveform.tsx:24` и запускать цикл только в состоянии `recording`.
11. **backdrop-filter.** Удалить у элементов виджета (`index.css:227,533` — проверить, что это именно виджет). Пилюля непрозрачная чёрная, размытие фона ей не нужно. В окне настроек размытие заменит нативный vibrancy (изменение `native-macos-ui`).
12. **App Nap.**
    - `objc2-foundation`: `NSProcessInfo::processInfo().beginActivityWithOptions_reason(NSActivityUserInitiated, "Dictation")`.
    - Хранить токен в состоянии, снимать через `endActivity`.
    - Tauri-команды `begin_work_activity` / `end_work_activity` вызываются из пайплайна диктовки: begin при старте записи, end после вставки или ошибки. Защита от утечки: end в `finally`.
13. **Замеры.**
    - `docs/performance.md` содержит методику и таблицу «до/после»:
      - `pipeline_total_ms` для фразы 5 с — 5 прогонов, медиана;
      - CPU в простое (Мониторинг системы, 60 с);
      - размер `.app` и каждого sidecar'а.
    - Скрипт `scripts/report-bundle-size.mjs` вызывается в конце `build:release:macos` и падает при превышении бюджета.

## Risks / Trade-offs

- **Кеш модели держит гигабайты в unified memory.** Решение — idle-выгрузка. На M5 с 16+ ГБ это приемлемо.
- **`target-cpu=native`** — бинарник может не запуститься на более старых чипах. Приемлемо для локальной сборки, а в CI используется `apple-m1`.
- **Сборка ffmpeg из исходников** занимает 2-4 минуты при первом запуске. Результат кешируется.
- **Минимальный ffmpeg может не открыть экзотический формат.** Список форматов нужно явно сверить с фильтром диалога выбора файла и тестами `media/probe.rs`.
- **Отключение `openmp` в llama** может изменить скорость на CPU-части. Проверить замером, при регрессии вернуть.
