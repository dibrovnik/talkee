# Proposal

## Why

talkee разрабатывается и используется только на Mac с Apple Silicon. Код для Windows и Linux (191 строка `cfg(...)` в 15 Rust-файлах, отдельные backend'ы захвата звука и вставки текста, NSIS-хуки, Windows-тулчейн в скриптах, трёхплатформенный CI) усложняет каждое изменение, раздувает контекст для агентов, требует лишних зависимостей и замедляет CI. Удаление упрощает кодовую базу и открывает путь к macOS-специфичной оптимизации.

## What Changes

- **BREAKING** Приложение собирается и запускается только на macOS, только `aarch64-apple-darwin`. Сборка на другой ОС завершается понятной ошибкой компиляции.
- Удалить платформенный код Windows/Linux в Rust: `windows_titlebar.rs`, Linux PipeWire и Windows WASAPI backend'ы в `call_capture.rs`, Linux/X11 и generic-ветки в `paste.rs`, non-mac ветки в `commands/*`, `local_stt.rs`, `shutdown.rs`, `lib.rs`, `hotkey_capture.rs`, `native_voice_recorder.rs`, `media_permissions.rs` (Linux-only), `bin/talkee-diarize.rs`, `live_translation.rs`.
- Удалить `cfg(target_os = "macos")` обёртки там, где после удаления других веток они стали безусловными (код становится обычным, без условной компиляции), и добавить одну проверку `compile_error!` для не-macOS.
- Удалить зависимости: `windows-sys`, `pipewire`, `webkit2gtk`, `x11rb`, `tauri-plugin-single-instance`; перенести macOS-зависимости из `[target.'cfg(target_os = "macos")'.dependencies]` в обычные `[dependencies]`.
- Удалить платформенные ветки фронтенда: `src/lib/windowsTitlebar.ts`, `src/lib/frontendHotkeyCapture.ts` (если используется только на Windows/Linux), `isMacPlatform()` и определение ОС через `navigator`, Linux-проверки в `recordingDevice.ts`/`recordingRuntime.ts`, i18n-строки `*Linux`/`*Windows`, CSS `.native-frame`.
- Удалить `src-tauri/tauri.linux.conf.json`, `src-tauri/windows/`, `icon.ico`, `Square*Logo.png`, `StoreLogo.png`, `icons/android`, `icons/ios`; `bundle.windows`, `bundle.linux` в `tauri.conf.json`; `bundle.targets` → `["app", "dmg"]`.
- Удалить скрипты `verify-windows-release.mjs`, `windows-toolchain-env.mjs` (+тест), Windows/Linux-ветки в `build-release.mjs`, `prepare-*-sidecar.mjs`, `run-tauri.mjs`; npm-скрипты `build:release:windows|linux`, `verify:windows-release`.
- CI: только `macos-latest` (arm64), без матриц.
- Документация: убрать упоминания Windows/Linux (README ~29 вхождений в каждом, AGENTS.md Audio Pipeline про WASAPI/PipeWire).

Зависит от: `rename-to-talkee`.

## Capabilities

### New Capabilities
- `platform-support`: поддерживаемые платформы и архитектуры и поведение при попытке сборки на неподдерживаемой.

### Modified Capabilities
<!-- нет -->

## Impact

- Rust: 15 файлов в `src-tauri/src/`, `src-tauri/Cargo.toml`, `src-tauri/sidecars/talkee-llm/Cargo.toml`.
- Frontend: `src/lib/store.ts` (`isMacPlatform` ~15 вызовов), `src/windows/settings/SettingsApp.tsx`, `PermissionScreen.tsx`, `SettingsTabs.tsx`, `useHotkeyCapture.ts`, `OnboardingShell.tsx`, `TranslationTab.tsx`, `Widget.tsx`, `permissions.ts`, `recordingDevice.ts`, `recordingRuntime.ts`, i18n, `src/index.css`.
- Конфиг/сборка: `tauri.conf.json`, `capabilities/default.json`, `package.json`, `scripts/*`, `.github/workflows/*`.
- Размер репозитория: минус ~200 МБ Linux-бинарников в `src-tauri/binaries/` (build-артефакты).
