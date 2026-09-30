# Proposal

## Why

talkee работает на одном Mac с Apple M5. Сейчас приложение этим почти не пользуется и тратит ресурсы впустую:

- **STT-модель грузится заново на каждый запрос.** `Model::load` вызывается в `src-tauri/src/bin/talkee-stt.rs:738,848,941`. На больших моделях Whisper/Parakeet это добавляет сотни миллисекунд или секунды к каждой диктовке.
- **Не оптимизированы сборка и зависимости:**
  - нет `[profile.release]` — сборка без LTO, с 16 codegen units и без strip;
  - `MACOSX_DEPLOYMENT_TARGET=11.0`;
  - переводчик ct2rs использует переносимый `ruy`, а не Apple Accelerate;
  - число потоков нигде не задано.
- **Лишняя нагрузка в простое:**
  - виджет каждые 80 мс делает три IPC-вызова, чтобы определить hover, и перевзводит интервал на каждом рендере;
  - анимация волны идёт через `requestAnimationFrame` без ограничения, то есть 120 Гц на ProMotion.
- **Раздутый бандл.** ffmpeg-static (полная сборка) весит 45,6 МБ из ~59 МБ sidecar'ов, хотя приложению нужна только конвертация аудио.

## What Changes

**Задержка STT**
- STT sidecar держит загруженную модель в памяти между запросами. Модель выгружается после простоя (по умолчанию 10 минут), чтобы освободить unified memory.
- Прогрев: при нажатии горячей клавиши диктовки приложение асинхронно просит sidecar загрузить выбранную модель. Загрузка идёт параллельно с речью пользователя.

**Вычисления на Apple Silicon**
- Metal остаётся включённым для STT и LLM, приложение логирует активный backend.
- Число CPU-потоков для STT, LLM и переводчика равно числу производительных ядер (`hw.perflevel0.physicalcpu`).
- ct2rs на macOS использует `accelerate` вместо `ruy`.
- У `llama-cpp-2` отключается `openmp`: ggml на macOS использует собственный пул потоков и Metal.
- Во время записи и распознавания App Nap блокируется через `NSProcessInfo.beginActivity`.

**Сборка**
- Release-профиль: `lto = "fat"`, `codegen-units = 1`, `strip = true`, `opt-level = 3`.
- Только `aarch64-apple-darwin`.
- Минимальная версия macOS — **14.0**.
- Локальная release-сборка по умолчанию использует `-C target-cpu=native`.

**Размер бандла**
- Своя минимальная сборка ffmpeg (LGPL). В неё входят только декодеры, демультиплексоры и фильтры, которые реально используются в `src-tauri/src/media/`. Цель — не больше 8 МБ.
- Удалить неиспользуемые Rust-зависимости: `window-vibrancy` и те, что найдёт `cargo machete`.

**Frontend в простое**
- Определение hover без IPC-опроса каждые 80 мс.
- Анимация волны ограничена 30 fps и работает только во время записи.
- Реальный уровень звука приходит от нативного рекордера событием (~20 Гц) вместо анимации «вслепую».
- С прозрачного виджета убран `backdrop-filter`.

**Измерения**
- Структурированные тайминги в логах: `model_load_ms`, `inference_ms`, `pipeline_total_ms`.
- Документ `docs/performance.md` с замерами «до/после».

Зависит от: `quality-gates`.

## Capabilities

### New Capabilities
- `performance`: бюджеты задержки диктовки, потребления в простое и размера бандла на Apple Silicon, а также то, как они измеряются.

### Modified Capabilities
<!-- нет -->

## Impact

- **Rust:**
  - `src-tauri/src/bin/talkee-stt.rs` — кеш модели, прогрев, потоки;
  - `src-tauri/src/local_stt.rs` — команда прогрева, idle-выгрузка;
  - `src-tauri/sidecars/talkee-llm/src/main.rs` — потоки;
  - `src-tauri/src/local_translator.rs` — потоки;
  - `src-tauri/src/native_voice_recorder.rs` — события уровня;
  - `src-tauri/src/lib.rs` — App Nap;
  - `src-tauri/Cargo.toml`, `src-tauri/sidecars/talkee-llm/Cargo.toml`.
- **Frontend:**
  - `src/windows/widget/Widget.tsx` (hover ~2382-2440, волна ~2591-2702);
  - `src/windows/widget/hooks/useWidgetRecording.ts`;
  - `src/index.css` (backdrop-filter у виджета).
- **Сборка:**
  - `scripts/prepare-ffmpeg-sidecar.mjs` — сборка ffmpeg из исходников;
  - `scripts/build-release*.{mjs,sh}`;
  - `src-tauri/tauri.conf.json` (`minimumSystemVersion`);
  - `package.json` — удаляется `ffmpeg-static`.
- **Время release-сборки** вырастет из-за LTO. Dev-сборка не меняется.
