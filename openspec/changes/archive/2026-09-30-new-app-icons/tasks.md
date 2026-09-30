# Tasks

## 1. Исходники и генерация

- [x] 1.1 Скопировать `openspec/changes/new-app-icons/reference/{app-icon,tray-icon,tray-icon-recording}.svg` в `assets/brand/`
- [x] 1.2 `bun add -d --exact @resvg/resvg-js`
- [x] 1.3 Создать `scripts/generate-icons.mjs` (design.md, решение 2); `package.json`: `"icons"`
- [x] 1.4 `bun run icons`; удалить `src-tauri/icons/app-icon-source.png` и нецелевые файлы (`.ico`, Square*, android, ios)
- [x] 1.5 `src-tauri/tauri.conf.json`: `bundle.icon` — только файлы, созданные генератором (`32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.icns`)
- [x] 1.6 `index.html`: фавикон
- [x] 1.7 Проверка: повторный `bun run icons` → `git status` без изменений; `sips -g pixelWidth src-tauri/icons/tray/tray@2x.png` → 36

## 2. Трей

- [x] 2.1 `src-tauri/src/tray.rs`: template-иконка (design.md, решение 3)
- [x] 2.2 Команда `set_tray_recording`; регистрация в `lib.rs`; право в `capabilities/default.json` не нужно (своя команда) — проверить, что команда доступна окну `widget`
- [x] 2.3 Frontend: вызовы при входе и выходе из записи (design.md, решение 4), включая ошибку и отмену
- [x] 2.4 Проверка: `cargo check`, `bunx tsc --noEmit`; вручную — трей белый на тёмной теме и чёрный на светлой; при диктовке иконка меняется и возвращается; при ошибке (отключить микрофон) возвращается

## 3. Финал

- [x] 3.1 Собрать `.app`, проверить иконку в Dock, Finder (список 16 pt), Cmd+Tab
- [x] 3.2 README: скриншот новой иконки, заметка про кеш иконок (`killall Dock`)
- [x] 3.3 Проверка: `bun run gate`; `openspec validate new-app-icons --strict`
