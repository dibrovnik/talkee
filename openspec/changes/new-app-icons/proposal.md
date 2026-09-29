# Proposal

## Why

Текущий логотип — кремово-янтарный squircle с эквалайзером — принадлежит бренду Talkis. Его нужно заменить на собственный знак talkee. Отдельная проблема — трей: там сейчас показывается полноцветная иконка приложения (`tray.rs` использует `app.default_window_icon()`), без template-режима. В строке меню macOS она выглядит чужеродно и не подстраивается под светлую и тёмную тему.

## What Changes

- **Новая иконка приложения для Dock и Finder.** Squircle по сетке иконок macOS: градиент от системного оранжевого к розовому, белое «облачко речи» с пятью полосами звуковой волны. Эталон — `reference/app-icon.svg`, превью — `reference/preview-app-icon.png`.
- **Новая иконка трея.** Круглый знак с тремя полосами волны, вырезанными насквозь. Эталон — `reference/tray-icon.svg`. Иконка работает как template image: на тёмной строке меню она белая, на светлой — чёрная (превью `reference/preview-tray.png`).
- **Вариант иконки трея для записи** — кольцо с полосами (`reference/tray-icon-recording.svg`). Трей переключается на него во время записи.
- **Исходники знаков** хранятся в `assets/brand/` (SVG). Все растровые размеры и `.icns` генерирует скрипт `bun run icons`.
- **Удаляется старый набор.** `app-icon-source.png` и растровые файлы Talkis в `src-tauri/icons/` заменяются сгенерированными.
- **Фавикон WebView** (`index.html`) строится из того же знака.

Зависит от: `optimize-apple-silicon`. Жёсткой технической зависимости нет, порядок нужен, чтобы не конфликтовать по `tauri.conf.json`.

## Capabilities

### New Capabilities
- `app-icons`: иконки приложения и трея, их поведение (template, состояние записи) и воспроизводимая генерация из исходников.

### Modified Capabilities
<!-- нет -->

## Impact

- Новые файлы: `assets/brand/{app-icon,tray-icon,tray-icon-recording}.svg`, `scripts/generate-icons.mjs`.
- `src-tauri/icons/*` генерируются заново; `src-tauri/icons/tray/*.png` — новые.
- `src-tauri/src/tray.rs`: отдельная template-иконка и смена иконки при записи.
- Команда Tauri для смены состояния трея вызывается из frontend (пайплайн записи).
- `src-tauri/tauri.conf.json`: список `bundle.icon`.
- `index.html`: фавикон.
