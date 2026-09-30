# Tasks

## 1. Cargo и guard

- [x] 1.1 `src-tauri/Cargo.toml`: применить design.md, решение 3; удалить `windows-sys`, `pipewire`, `webkit2gtk`, `x11rb`, `tauri-plugin-single-instance`
- [x] 1.2 `src-tauri/sidecars/talkee-llm/Cargo.toml`: одна запись `llama-cpp-2` с `metal` в `[dependencies]`
- [x] 1.3 Добавить `compile_error!` guard (design.md, решение 2) в `src-tauri/src/lib.rs`, `src-tauri/src/bin/*.rs`, `src-tauri/sidecars/talkee-llm/src/main.rs`
- [x] 1.4 Проверка: `cargo check --manifest-path src-tauri/Cargo.toml --workspace` (будут ошибки из-за удалённых крейтов — исправляются в группе 2)

## 2. Rust: удаление платформенных веток (по одному файлу, `cargo check` после каждого)

- [x] 2.1 Удалить `src-tauri/src/windows_titlebar.rs` и `mod windows_titlebar` в `lib.rs`; в `lib.rs` удалить single-instance plugin, `focus_existing_instance`, прочие cfg (правила — design.md, решение 1)
- [x] 2.2 `call_capture.rs`: удалить Linux PipeWire и Windows backend'ы, per-OS state, упростить `platform_targets`/`start_platform_capture`/`stop_platform_capture` до macOS-реализации
- [x] 2.3 `paste.rs`: удалить Linux/X11 и generic-ветки; подписи шорткатов только macOS
- [x] 2.4 `commands/widget.rs`, `commands/accessibility.rs`, `commands/settings_window.rs`, `commands/runtime_info.rs`
- [x] 2.5 `local_stt.rs`, `shutdown.rs`, `hotkey_capture.rs`, `native_voice_recorder.rs`, `live_translation.rs`, `bin/talkee-diarize.rs`
- [x] 2.6 Удалить `media_permissions.rs`, если после удаления Linux-кода он пуст (и его `mod`/регистрацию команд)
- [x] 2.7 Проверка: `grep -rn "cfg(windows)\|target_os = \"linux\"\|target_os = \"windows\"\|not(target_os = \"macos\")\|cfg!(windows)" src-tauri/src src-tauri/sidecars` пуст; `cargo check --workspace` и `cargo test --workspace` (manifest `src-tauri/Cargo.toml`) зелёные

## 3. Конфиг и ассеты

- [ ] 3.1 Удалить `src-tauri/tauri.linux.conf.json`, `src-tauri/windows/`
- [ ] 3.2 `src-tauri/tauri.conf.json`: удалить `bundle.windows`, `bundle.linux`; `bundle.targets: ["app", "dmg"]`; из `bundle.icon` убрать `icon.ico`
- [ ] 3.3 Удалить `src-tauri/icons/icon.ico`, `Square*Logo.png`, `StoreLogo.png`, `src-tauri/icons/android/`, `src-tauri/icons/ios/`
- [ ] 3.4 Удалить из `src-tauri/binaries/` Linux/Windows бинарники и устаревшие `*-stt-nvidia-*`, `*-stt-qwen-*`
- [ ] 3.5 Проверка: `bun run tauri build` создаёт `.app` и `.dmg`

## 4. Frontend

- [ ] 4.1 Удалить `src/lib/windowsTitlebar.ts` и использование в `SettingsApp.tsx`; CSS `.app-root.native-frame` в `src/index.css`
- [ ] 4.2 `src/lib/store.ts`: удалить `isMacPlatform()`, оставить macOS-ветки во всех вызовах (`grep -rn isMacPlatform src`)
- [ ] 4.3 Удалить определение ОС через `navigator` в `PermissionScreen.tsx`, `SettingsTabs.tsx`, `permissions.ts`, `recordingDevice.ts`, `recordingRuntime.ts`; оставить macOS-поведение
- [ ] 4.4 `src/lib/frontendHotkeyCapture.ts`: удалить, если используется только вне macOS; обновить `useHotkeyCapture.ts`
- [ ] 4.5 i18n: удалить ключи `*Linux`, `*Windows` и строки с PipeWire/X11/WASAPI
- [ ] 4.6 Обновить/удалить тесты, проверявшие non-mac поведение
- [ ] 4.7 Проверка: `bunx tsc --noEmit && bun test`; `grep -rni "windows\|linux\|pipewire\|x11" src` — остаются только нерелевантные совпадения (например, «windows» как окна Tauri: `src/windows/`)

## 5. Скрипты и CI

- [ ] 5.1 Удалить `scripts/verify-windows-release.mjs`, `scripts/windows-toolchain-env.mjs`, `scripts/windows-toolchain-env.test.mjs`
- [ ] 5.2 `scripts/build-release.mjs`, `scripts/prepare-ffmpeg-sidecar.mjs`, `scripts/prepare-stt-sidecar.mjs`, `scripts/run-tauri.mjs`: удалить Windows/Linux ветки (MSVC CRT, Linux lib dirs, `ensureLinuxBuildDependencies`, `.exe`)
- [ ] 5.3 `package.json`: удалить `build:release:windows`, `build:release:linux`, `verify:windows-release`; `build:release` = macOS
- [ ] 5.4 `.github/workflows/*`: design.md, решение 7
- [ ] 5.5 Проверка: `bun run check:release` проходит локально

## 6. Документация

- [ ] 6.1 `README.md`, `README.ru.md`: удалить разделы установки/сборки для Windows и Linux, ссылки на EXE/AppImage
- [ ] 6.2 `AGENTS.md`: в «Audio Pipeline Rules» удалить абзац о WASAPI/PipeWire; указать «macOS only (Apple Silicon)»
- [ ] 6.3 `docs/audio-pipeline-principles.md`, `docs/architecture/processing-modes.md`: удалить упоминания других ОС
- [ ] 6.4 Проверка: `openspec validate drop-windows-linux-support --strict`
