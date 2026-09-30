# Tasks

## 0. Базовые замеры (до любых изменений)

- [x] 0.1 Собрать `bun run build:release:macos`; записать в `docs/performance.md` размер `.app` и каждого sidecar'а (`du -sh`)
- [x] 0.2 Записать медиану `pipeline_total_ms` (или ближайшего существующего лог-поля) для 5 диктовок фразы 5 с в локальном режиме; CPU в простое за 60 с
- [x] 0.3 Проверка: таблица «до» заполнена

## 1. Кеш и прогрев STT-модели

- [x] 1.1 `src-tauri/src/bin/talkee-stt.rs`: `ModelCache` + `get_or_load` (design.md, решение 1); заменить три вызова `Model::load`
- [x] 1.2 Idle-выгрузка: фоновый поток + аргумент `--idle-unload-secs` (по умолчанию 600)
- [x] 1.3 Эндпоинты `POST /v1/warmup`, `GET /v1/status`
- [x] 1.4 Логи `model_load_ms`, `inference_ms` в каждом запросе транскрибации
- [x] 1.5 Unit-тесты кеша (с подменой загрузчика через trait/замыкание): попадание, смена модели, выгрузка по простою
- [x] 1.6 `src-tauri/src/local_stt.rs`: передавать `--idle-unload-secs`; `src-tauri/src/ai.rs` `warm_up_local_stt_runtime`: после готовности runtime вызывать `POST /v1/warmup` (design.md, решение 2)
- [x] 1.7 `src/windows/widget/hooks/useWidgetRecording.ts`: запускать прогрев в режиме «Локально» и для batch-диктовки (fire-and-forget, без `await` в критическом пути); потоковую ветку не менять
- [x] 1.8 Проверка: `cargo test --workspace`; две диктовки подряд → во второй `model_load_ms=0`

## 2. Потоки и фичи крейтов

- [x] 2.1 `perf_core_count()` в `talkee-stt.rs` и `sidecars/talkee-llm/src/main.rs`; применить (design.md, решение 3)
- [x] 2.2 `src-tauri/src/local_translator.rs`: число потоков ct2rs
- [x] 2.3 `src-tauri/Cargo.toml`: ct2rs `accelerate` вместо `ruy`; `sidecars/talkee-llm/Cargo.toml`: убрать `openmp`
- [x] 2.4 Логировать при старте sidecar'ов: backend (Metal/CPU), число потоков
- [x] 2.5 Проверка: `cargo test --workspace`; ручной замер перевода и LLM-summary до/после на фиксированном тексте — регрессии нет

## 3. Сборка

- [x] 3.1 `src-tauri/Cargo.toml`: `[profile.release]` (design.md, решение 5)
- [x] 3.2 `scripts/build-release-macos.sh`, `scripts/build-release.mjs`: `MACOSX_DEPLOYMENT_TARGET=14.0`, `RUSTFLAGS` с `TALKEE_TARGET_CPU` (по умолчанию `native`); в CI — `apple-m1`
- [x] 3.3 `src-tauri/tauri.conf.json`: `minimumSystemVersion: "14.0"`
- [x] 3.4 Удалить `window-vibrancy`; `cargo install cargo-machete && cargo machete src-tauri` — удалить подтверждённо неиспользуемые зависимости
- [x] 3.5 Проверка: release-сборка проходит; `plutil -extract LSMinimumSystemVersion raw .../Talkee.app/Contents/Info.plist` → `14.0`

## 4. Минимальный ffmpeg

- [x] 4.1 Составить список используемых аргументов ffmpeg (grep из design.md, решение 7) и форматов диалога выбора файла; записать в `docs/third-party/ffmpeg.md`
- [x] 4.2 Переписать `scripts/prepare-ffmpeg-sidecar.mjs`: загрузка исходников с проверкой SHA256, `configure` с флагами из design.md, кеш сборки, копирование в `src-tauri/binaries/talkee-ffmpeg-aarch64-apple-darwin`
- [x] 4.3 Решить вопрос ffprobe по `media/probe.rs` (design.md, решение 7)
- [x] 4.4 Удалить `ffmpeg-static` из `package.json`
- [x] 4.5 Добавить Rust-тест или скрипт `scripts/smoke-ffmpeg.mjs`: сгенерировать тестовые файлы (wav, m4a/aac, mp3, ogg/opus, webm/opus, mp4 с видео+aac) системным `afconvert`/заранее положенными маленькими фикстурами ≤ 100 КБ в `src-tauri/tests/fixtures/media/` и прогнать через встроенный ffmpeg → WAV 16 кГц mono
- [x] 4.6 Проверка: `ls -la src-tauri/binaries/talkee-ffmpeg-*` ≤ 8 МБ; smoke-тест зелёный

## 5. Уровень звука и frontend в простое

- [x] 5.1 `native_voice_recorder.rs`: событие `native-voice-level` 20 Гц (design.md, решение 8)
- [x] 5.2 `useWidgetRecording.ts` / `Widget.tsx`: подписка на событие; индикатор использует реальный уровень
- [x] 5.3 `Widget.tsx`: hover без 80 мс опроса (design.md, решение 9)
- [x] 5.4 `Widget.tsx`: rAF ≤ 30 fps и только в `recording` (design.md, решение 10)
- [x] 5.5 `src/index.css`: убрать `backdrop-filter` у виджета (design.md, решение 11)
- [x] 5.6 Проверка: `bun test`; ручная проверка hover при активном другом приложении; CPU в простое ≤ 0,5% за 60 с

## 6. App Nap

- [x] 6.1 Команды `begin_work_activity` / `end_work_activity` (design.md, решение 12); регистрация в `lib.rs`
- [x] 6.2 Вызовы в пайплайне диктовки (`transcriptionPipeline.ts` / `useWidgetRecording.ts`) с `finally`
- [x] 6.3 Проверка: лог показывает begin/end для каждой диктовки, включая ошибочную

## 7. Итоговые замеры

- [x] 7.1 `scripts/report-bundle-size.mjs` + вызов в `build:release:macos` (бюджеты из спеки)
- [x] 7.2 Заполнить таблицу «после» в `docs/performance.md`
- [x] 7.3 Проверка: бюджеты из спеки выполнены; `bun run gate`; `openspec validate optimize-apple-silicon --strict`
