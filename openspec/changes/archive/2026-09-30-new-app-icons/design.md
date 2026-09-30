# Design

## Context

Текущие иконки лежат в `src-tauri/icons/`: `app-icon-source.png` (1024²), `icon.png`, `icon.icns`, 32/64/128/128@2x. После `drop-windows-linux-support` в каталоге не остаётся `.ico`, Square*Logo, ios и android. В бандл входят 32, 128, 128@2x и icns (`tauri.conf.json:47-53`).

Трей настраивается в `src-tauri/src/tray.rs:251-253` через `app.default_window_icon()`. Template-режима (`icon_as_template`) нет, меню открывается по левому клику (`:226`).

Эталонные SVG подготовлены и отрендерены на этапе спецификации:
- `reference/app-icon.svg`, превью `reference/preview-app-icon.png`;
- `reference/tray-icon.svg` и `reference/tray-icon-recording.svg`, превью на тёмном и светлом фоне — `reference/preview-tray.png`.

Их нужно перенести в `assets/brand/` без изменений. Правки дизайна возможны позже, но механика от них не зависит.

## Goals / Non-Goals

**Goals:** новый знак, нативный трей, воспроизводимая генерация.

**Non-Goals:**
- Liquid Glass-иконка через Icon Composer (`.icon`) для macOS 26+. Tauri её пока не поддерживает; вернуться к этому, когда появится поддержка.
- Анимированная иконка трея.
- Логотип в интерфейсе настроек. Боковая панель меняется в изменении `native-macos-ui`, там можно использовать тот же знак.

## Decisions

1. **Палитра** — системные цвета Apple: верх `#FFA41B` (близко к systemOrange), низ `#FF2D55` (systemPink). Глиф белый, с тенью `#8A1030` при 30% прозрачности. Полосы волны закрашены тем же градиентом в координатах холста (`gradientUnits="userSpaceOnUse"`), поэтому выглядят вырезанными.
2. **Генерация** (`scripts/generate-icons.mjs`):
   - Растеризация SVG → PNG. В репозитории нет растеризатора, поэтому нужна dev-зависимость без нативной сборки: `@resvg/resvg-js` (prebuilt для darwin-arm64). `qlmanage` не подходит — он даёт неточный размер и фон.
   - Иконка приложения: 1024×1024 PNG → `bunx tauri icon assets/brand/app-icon.png -o src-tauri/icons`. Tauri CLI v2 сам создаст `icon.icns` и PNG. Сразу после удалить сгенерированные `.ico`, Square*, `android/`, `ios/` — они не нужны.
   - Трей: `tray-icon.svg` → `src-tauri/icons/tray/tray.png` (18×18) и `tray@2x.png` (36×36); то же для `tray-recording*.png`. Цвет — чёрный с альфа-каналом: для template image важна только альфа.
   - Фавикон: `public/favicon.png` 64×64 из app-icon + `<link rel="icon" href="/favicon.png">` в `index.html`. Если `public/` удалён в `repo-cleanup-for-agents`, создать его заново.
   - `package.json`: `"icons": "bun scripts/generate-icons.mjs"`. Результаты генерации коммитятся — они нужны для сборки.
3. **Трей в Rust** (`tray.rs`):
   - иконки подключаются через `include_bytes!("../icons/tray/tray@2x.png")` и `Image::from_bytes`;
   - `TrayIconBuilder::icon(normal).icon_as_template(true)`;
   - новая команда `set_tray_recording(recording: bool)` вызывает `tray.set_icon(Some(img))` и следом `tray.set_icon_as_template(true)` (после `set_icon` флаг template нужно выставлять заново — проверить по API Tauri 2);
   - хэндл трея берётся через `app.tray_by_id(TRAY_ID)`.
4. **Вызов состояния записи.** Frontend вызывает `set_tray_recording(true)` при переходе виджета в `recording` (`widgetMachine`/`useWidgetController`) и `false` при выходе из `recording`/`processing` в `idle`, в том числе по ошибке и отмене. Для записи созвонов — то же в сервисе call capture (`src/lib/callCapture.ts`).
5. **Удаление старого:** `src-tauri/icons/app-icon-source.png` и прочие файлы Talkis. Каталог `src-tauri/icons/` целиком перезаписывается генератором.

## Risks / Trade-offs

- `@resvg/resvg-js` — лишняя dev-зависимость. Альтернатива — установить `librsvg` через Homebrew, но это внешний инструмент без фиксации версии. Выбран пакет.
- Кеш иконок macOS может показывать старую иконку. Лечится `killall Dock` или перерегистрацией приложения (`lsregister -f`) — задокументировать в README.
