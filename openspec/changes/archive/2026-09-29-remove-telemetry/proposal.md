# Proposal

## Why

Приложение должно быть полностью приватным: никаких фоновых обращений в сеть, о которых пользователь не знает. Аудит показал, что аналитических SDK (Metrika, GA, Sentry, PostHog и т.п.) в коде нет, но есть неявные «звонки домой»: автоматическая проверка обновлений на GitHub исходного автора (через 60 с после старта, затем каждые 6 ч и при каждом открытии настроек), загрузка шрифтов с Google Fonts при каждом запуске WebView и CDN-зависимости на лендинге.

## What Changes

- Удалить подключение Google Fonts из `src/index.css:1`; до изменения `native-macos-ui` использовать системный стек шрифтов (`-apple-system, BlinkMacSystemFont, "SF Pro Text", ...`).
- **BREAKING** Удалить плагин автообновления целиком: `tauri-plugin-updater`, `@tauri-apps/plugin-updater`, `src/lib/updater.ts`, `AppUpdateFooter` в настройках, пункт трея «Проверить обновления», `plugins.updater` и `createUpdaterArtifacts` в `tauri.conf.json`, права `updater:*` в capabilities, генерацию `latest.json` в CI. Обновление приложения — ручной пересбор/переустановка.
- Удалить `@tauri-apps/plugin-process`/`tauri-plugin-process`, если после удаления updater они больше нигде не используются (используется только для relaunch после обновления).
- Добавить автоматическую проверку «запрещённых хостов» (скрипт `scripts/check-network-hosts.mjs`), которая падает, если в `src/` или `src-tauri/src/` появляется URL, не входящий в allowlist.
- Задокументировать сетевую политику в `docs/privacy.md`.

Зависит от: —

## Capabilities

### New Capabilities
- `network-privacy`: правила, когда приложение имеет право выходить в сеть, и автоматическая проверка этих правил.

### Modified Capabilities
<!-- нет: openspec/specs пуст -->

## Impact

- Frontend: `src/index.css`, `src/lib/updater.ts` (удаляется), `src/windows/settings/SettingsApp.tsx` (AppUpdateFooter, `?checkUpdate=1`), `src/windows/widget/Widget.tsx` (запуск scheduler), i18n-словари со строками обновлений.
- Rust: `src-tauri/src/lib.rs` (регистрация плагинов), `src-tauri/src/tray.rs` (пункт «Проверить обновления»), `src-tauri/Cargo.toml`.
- Конфиг: `src-tauri/tauri.conf.json`, `src-tauri/capabilities/default.json`, `package.json`.
- CI: `.github/workflows/release.yml`, `scripts/create-updater-latest-json.sh` (удаляется).
- Пользователь больше не получает уведомлений об обновлениях.
