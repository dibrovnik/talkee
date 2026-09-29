# Proposal

## Why

Продукт — независимый форк и должен называться talkee. Сейчас имя Talkis зашито в bundle identifier (`com.trixter.talkis`), имя приложения, Cargo-пакеты, sidecar'ы (`talkis-stt`, `talkis-llm`, `talkis-diarize`, `talkis-ffmpeg`), путь логов `~/.talkis`, файл настроек `talkis.json`, env-переменные `TALKIS_*`, ≈75 UI-строк и документацию. Смена identifier меняет каталог данных приложения, поэтому нужна миграция, иначе пользователь потеряет настройки, историю и скачанные модели (гигабайты).

## What Changes

- Отображаемое имя приложения: **Talkee** (`productName`, заголовки окон, трей, «О программе», UI-строки). В идентификаторах и путях — `talkee` в нижнем регистре.
- **BREAKING** Bundle identifier `com.trixter.talkis` → `com.talkee.app`. Разрешения macOS (Микрофон, Универсальный доступ, Запись экрана/системного звука) придётся выдать заново.
- Cargo: пакет `talkee`, lib `talkee_lib`, `default-run = "talkee"`, sidecar-крейт `sidecars/talkee-llm`, бинарники `talkee-stt`, `talkee-diarize`; `externalBin` → `binaries/talkee-{ffmpeg,stt,diarize,llm}`.
- npm-пакет `talkee`; скрипты `logs`/`logs:clear` → `~/.talkee/talkee.log`.
- Файл настроек `talkis.json` → `talkee.json`; ключ localStorage `talkis.uiLanguage` → `talkee.uiLanguage`; маркер `.talkis-app-data-layout-v3` → `.talkee-app-data-layout-v3`; sentinel `__TALKIS_SELECTION_SENTINEL_` → `__TALKEE_SELECTION_SENTINEL_`; UID агрегатного аудиоустройства `com.talkee.app.call.{id}`.
- Env-переменные `TALKIS_*` → `TALKEE_*` (в коде, скриптах, CI); флаг `--talkis-check-dev-port` → `--talkee-check-dev-port`.
- Одноразовая миграция данных со старого каталога и старых путей при первом запуске.
- Документация, rules/skills, README: имя talkee. Скилл `skills/talkis-product-ui-style/` → `skills/talkee-product-ui-style/`.
- Автоматическая проверка «нет talkis» в исходниках (кроме кода миграции и CHANGELOG).

Зависит от: `remove-talkis-cloud`.

## Capabilities

### New Capabilities
- `app-identity`: имя, идентификаторы и пути данных приложения и миграция данных со старой идентичности Talkis.

### Modified Capabilities
<!-- нет -->

## Impact

- Конфиг: `src-tauri/tauri.conf.json`, `src-tauri/Info.plist`, `src-tauri/Cargo.toml`, `src-tauri/sidecars/talkis-llm/Cargo.toml` (переименование каталога), `package.json`, `index.html`, `src-tauri/Cargo.lock` (регенерируется).
- Rust: `lib.rs`, `logger.rs`, `history_storage.rs`, `local_stt.rs`, `llm_runtime.rs`, `media/ffmpeg.rs`, `shutdown.rs`, `commands/accessibility.rs`, `call_capture.rs`, `paste.rs`, `tray.rs`, `bin/talkis-stt.rs` → `bin/talkee-stt.rs`, `bin/talkis-diarize.rs` → `bin/talkee-diarize.rs`.
- Frontend: `src/lib/store.ts`, `src/lib/stats.ts`, `src/lib/logger.ts`, `src/i18n/index.tsx`, i18n-словари (~73 вхождения «Talkis»).
- Скрипты и CI: `scripts/*` (64 вхождения), `.github/workflows/*` (28).
- Документация: `AGENTS.md`, `README*.md`, `docs/**`, `rules/**`, `skills/**`.
- Пользователь: повторная выдача системных разрешений.
