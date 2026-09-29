# Tasks

## 1. Удаление Google Fonts

- [x] 1.1 Удалить строку `@import url("https://fonts.googleapis.com/...")` в `src/index.css:1`
- [x] 1.2 В `src/index.css` заменить значения `--font`, `--font-main`, `--font-accent`, `--font-brand` на системный стек (см. design.md, решение 2); `grep -rn "Inter\|Manrope" src` — заменить прямые упоминания в inline-стилях на `var(--font)`/`var(--font-accent)`
- [x] 1.3 Проверка: `bunx tsc --noEmit` и `grep -rn "googleapis\|gstatic" src index.html` ничего не находит

## 2. Удаление автообновления (frontend)

- [x] 2.1 Удалить `src/lib/updater.ts` и его тесты, если есть (`ls src/lib/updater*`)
- [x] 2.2 `src/windows/widget/Widget.tsx`: удалить импорт и запуск scheduler обновлений (около строк 62 и 828)
- [x] 2.3 `src/windows/settings/SettingsApp.tsx`: удалить компонент `AppUpdateFooter` (около 189-294), его рендер, обработку query `?checkUpdate=1` (около 385, 470-474)
- [x] 2.4 Удалить из i18n-словарей (`src/i18n/**`) ключи, которые использовались только updater'ом (`grep -rn "update" src/i18n` и сверить с удалённым кодом)
- [x] 2.5 `package.json`: удалить `@tauri-apps/plugin-updater`; если `grep -rn "plugin-process" src` пуст — удалить `@tauri-apps/plugin-process`; `bun install`
- [x] 2.6 Проверка: `bunx tsc --noEmit && bun test`

## 3. Удаление автообновления (Rust и конфиг)

- [x] 3.1 `src-tauri/src/lib.rs`: удалить `.plugin(tauri_plugin_updater::Builder::new().build())`; удалить `tauri_plugin_process`, если он больше не нужен
- [x] 3.2 `src-tauri/src/tray.rs`: удалить пункт меню «Проверить обновления» и его обработчик (он открывает настройки с `?checkUpdate=1`)
- [x] 3.3 `src-tauri/Cargo.toml`: удалить `tauri-plugin-updater` (и `tauri-plugin-process`, если удалён в 3.1)
- [x] 3.4 `src-tauri/tauri.conf.json`: удалить `plugins.updater`, `bundle.createUpdaterArtifacts`
- [x] 3.5 `src-tauri/capabilities/default.json`: удалить `updater:allow-check`, `updater:allow-download-and-install` (и `process:allow-restart`, если процесс-плагин удалён)
- [x] 3.6 Удалить `scripts/create-updater-latest-json.sh`; в `.github/workflows/release.yml` удалить шаги подписи updater (`TAURI_SIGNING_PRIVATE_KEY*`) и генерации `latest.json`
- [x] 3.7 Проверка: `cargo check --manifest-path src-tauri/Cargo.toml` и `grep -rn "updater" src src-tauri/src src-tauri/tauri.conf.json src-tauri/capabilities` пуст

## 4. Проверка allowlist хостов

- [x] 4.1 Создать `scripts/network-allowlist.json` (структура — design.md, решение 3), заполнить хостами, найденными в `src/`, `src-tauri/src/`, `src-tauri/sidecars/`; для `talkis.ru` и `proxy.talkis.ru` использовать секцию `pendingRemoval`
- [x] 4.2 Создать `scripts/check-network-hosts.mjs` (без внешних зависимостей, Node/Bun API): поиск URL, извлечение hostname, сравнение с allowlist, вывод `file:line host`, exit 1 при нарушении
- [x] 4.3 Добавить тест `scripts/check-network-hosts.test.mjs`: разрешённый хост проходит, запрещённый падает, `localhost` проходит, `pendingRemoval` даёт предупреждение без ошибки
- [x] 4.4 `package.json`: скрипт `"check:network": "bun scripts/check-network-hosts.mjs"`
- [x] 4.5 Проверка: `bun run check:network` → exit 0; `bun test scripts/check-network-hosts.test.mjs` зелёный

## 5. Документация

- [x] 5.1 Создать `docs/privacy.md`: сетевая политика (три допустимых случая из спеки), список провайдеров из allowlist, как добавить новый хост
- [x] 5.2 Удалить из `README.md`/`README.ru.md` упоминания автообновления
- [x] 5.3 Проверка: `openspec validate remove-telemetry --strict`
