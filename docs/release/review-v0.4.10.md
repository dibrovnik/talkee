# Release review — v0.4.10

## Scope

Первый публичный выпуск в dibrovnik/talkee. Текущие исходники пользователя сохранены; добавлены README/GIF/скриншоты и исправлена сборка настоящих sidecar-процессов. Поддерживается macOS 14+ на Apple Silicon.

## Validation

- `bun run check:release` и `bun run gate` прошли на релизных исходниках: 551 тест Bun, 231 тест Rust, один пропуск в каждом наборе, frontend build.
- `actionlint`, `bash -n scripts/postprocess-macos-release.sh`, проверка локальных README-ссылок прошли.
- Gitleaks: 123 коммита без обнаруженных секретов до отправки исправления инструментария.
- Локальная release-сборка прошла: codesign --verify --deep --strict, hdiutil verify и четыре настоящих Mach-O ARM64 sidecar-бинарника; приложение укладывается в бюджет размера.
- Тег `v0.4.10` указывает на `412a6486302d2c570d499fdc6cb43f7e70f8f5ca`. До его отправки прошёл [Preflight macos](https://github.com/dibrovnik/talkee/actions/runs/38252600583) на этом точном SHA.
- После тега закреплён Bun 1.3.14: Bun 1.2.13 исчерпывал лимит файловых дескрипторов при поиске тестов в восстановленном Rust-кэше. Опубликованный тег сохранён без перезаписи; исправленный Release workflow делает checkout этого тега.
- [CI с закреплённым Bun](https://github.com/dibrovnik/talkee/actions/runs/38258200952) зелёный. Push-триггеры при первом выпуске не создали запусков, workflow запущены вручную через workflow_dispatch.

## Distribution

[Release workflow](https://github.com/dibrovnik/talkee/actions/runs/38258195575) прошёл; [v0.4.10](https://github.com/dibrovnik/talkee/releases/tag/v0.4.10) опубликован без draft. Стабильная ссылка DMG доступна без авторизации (HTTP 200). Скачанные из Releases DMG и ZIP прошли SHA256SUMS; проверены целостность DMG, подпись распакованного приложения, версия 0.4.10, все ARM64-бинарники и отсутствие зависимостей от Homebrew или других внешних библиотек.

DMG и ZIP приложения публикуются вместе с SHA256SUMS. Сборка в CI имеет ad-hoc подпись без нотарификации Apple; первый запуск может потребовать Open Anyway. Ручной полный прогон всех сценариев записи/перевода на разных моделях не выполнен.
