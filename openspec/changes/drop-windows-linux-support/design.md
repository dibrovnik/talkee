# Design

## Context

Карта платформенного кода (аудит 29.09.2026; строки приблизительные, имена после `rename-to-talkee`):

| Файл | cfg | Что там |
|---|---|---|
| `call_capture.rs` | 89 | Linux PipeWire ~2093-2439; Windows cpal loopback ~2440-2657; per-OS state 234-287; `platform_targets`/`start_platform_capture`/`stop_platform_capture` 1472-1750; `replace_file` 588-594; импорты 10-56 |
| `paste.rs` | 41 | Linux x11rb/xclip 41-310, 388-504, 667-790; generic fallback 506-543; подписи шорткатов 545-580 |
| `commands/widget.rs` | 11 | Linux notice/text окна 298-341; mac vs non-mac 441-552, 552-602 (non-mac resize), 779 |
| `commands/accessibility.rs` | 11 | non-mac заглушки 66, 115, 138 |
| `local_stt.rs` | 8 | 7; 832/844 `make_executable`; 1101-1183 kill процессов (`taskkill` 1156-1183); 1558 |
| `commands/settings_window.rs` | 5 | 40-82 non-mac decorations, Windows titlebar 56-82 |
| `shutdown.rs` | 4 | 18, 27, 54, 104 |
| `lib.rs` | 4 | 22 `mod windows_titlebar`; 31-47 `focus_existing_instance`; 58 single-instance; 94 |
| `hotkey_capture.rs` | 4 | 611-630 |
| `commands/runtime_info.rs` | 4 | 15-19, 40 |
| `native_voice_recorder.rs` | 3 | 632, 663, 667 |
| `bin/talkee-diarize.rs` | 3 | `cfg!(windows)` 831, 839, 1009 |
| `media_permissions.rs` | 2 | Linux-only 1-51 (webkit2gtk) |
| `live_translation.rs` | 1 | 885 |
| `windows_titlebar.rs` | 1 | весь файл |

Frontend: `lib/windowsTitlebar.ts`; `SettingsApp.tsx:49,422-425,570,584`; `lib/store.ts:336 isMacPlatform()` и ~15 вызовов (342-372, 438-534, 982, 1247); `useHotkeyCapture.ts:84`; `OnboardingShell.tsx:66`; `TranslationTab.tsx:480,1304`; `Widget.tsx:1827,1834`; `PermissionScreen.tsx:181-216,433-441`; `SettingsTabs.tsx:102-113`; `lib/permissions.ts:89`; `recordingDevice.ts:7-9`; `recordingRuntime.ts:129-130`; `lib/frontendHotkeyCapture.ts`; i18n `dict/widget.ts:26-39`, `settingsModels.ts:303`, `settingsTabsMisc.ts:275`, `components.ts:45,57`; CSS `index.css:190-194`.

## Goals / Non-Goals

**Goals:**
- Ноль Windows/Linux кода, конфигурации, зависимостей и CI.
- Условная компиляция для macOS заменена безусловным кодом.

**Non-Goals:**
- Оптимизации производительности и размера (изменение `optimize-apple-silicon`).
- Нативный редизайн настроек (изменение `native-macos-ui`); здесь только удаление non-mac веток, сохраняя текущее macOS-поведение один-в-один.

## Decisions

1. **Правило удаления веток:**
   - `#[cfg(target_os = "macos")] X` + `#[cfg(not(target_os = "macos"))] Y` → оставить `X` без атрибута, удалить `Y`.
   - `#[cfg(windows)]`/`#[cfg(target_os = "linux")]`/`#[cfg(any(windows, target_os="linux"))]` → удалить целиком.
   - `#[cfg(unix)]` → оставить код без атрибута (macOS — unix). `#[cfg(not(unix))]` → удалить.
   - `cfg!(windows)` в выражениях → заменить на `false` и упростить.
   - Модули, ставшие пустыми, удалить вместе с `mod` объявлением.
2. **Guard:** в `src-tauri/src/lib.rs` в начале: `#[cfg(not(target_os = "macos"))] compile_error!("talkee supports macOS only");`. То же в `src-tauri/sidecars/talkee-llm/src/main.rs` и в бинарниках `src/bin/*.rs`.
3. **Cargo.toml:** зависимости из `[target.'cfg(target_os = "macos")'.dependencies]` перенести в `[dependencies]` (у `transcribe-cpp` — одна запись с `features = ["metal"]`); удалить секции для `windows`, `linux`, `any(windows, linux)`; `tauri-plugin-autostart` перенести в `[dependencies]`. В `sidecars/talkee-llm/Cargo.toml` аналогично (`llama-cpp-2` с `metal`).
4. **Frontend:** `isMacPlatform()` удалить; в каждом вызове оставить ветку `true`. Определение ОС через `navigator.platform/userAgent` удалить. Если `frontendHotkeyCapture.ts` импортируется только в non-mac ветке — удалить файл.
5. **Single instance:** на macOS единственность экземпляра обеспечивает LaunchServices; `focus_existing_instance` удалить.
6. **Бинарники:** удалить `src-tauri/binaries/*-x86_64-unknown-linux-gnu*`, `*-pc-windows-msvc*`, а также устаревшие `talkis-stt-nvidia-*`, `talkis-stt-qwen-*` (не входят в `externalBin`).
7. **CI** (`.github/workflows/check.yml`, `release-preflight.yml`, `release.yml`): убрать `strategy.matrix`, `runs-on: macos-latest`; удалить шаги Linux deps, Windows RUSTFLAGS/`TRANSCRIBE_CMAKE_ARGS`, `verify-windows`, globs для msi/nsis/deb/rpm/AppImage; в `release.yml` `verify-preflight` требует только macOS preflight. Frontend-check перенести на macOS-runner (или оставить ubuntu для tsc/тестов — допустимо, но проще один runner; решение: один macOS job).

## Risks / Trade-offs

- Большие удаления в `call_capture.rs` и `paste.rs`: после каждой группы — `cargo check`, `cargo test`.
- Некоторые `cfg(not(macos))` ветки могли использоваться тестами на Linux CI — такие тесты становятся macOS-only, это ожидаемо.
