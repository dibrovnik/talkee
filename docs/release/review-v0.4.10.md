# Release review — v0.4.10

## Scope

Первый публичный выпуск в dibrovnik/talkee. Текущие исходники пользователя сохранены; добавлены README/GIF/скриншоты и исправлена сборка настоящих sidecar-процессов. Поддерживается macOS 14+ на Apple Silicon.

## Validation

- До повышения версии `bun run check:release` прошёл: 551 тест Bun, 231 тест Rust, один пропуск в каждом наборе, frontend build.
- `actionlint`, `bash -n scripts/postprocess-macos-release.sh`, проверка локальных README-ссылок прошли.
- Gitleaks: 118 коммитов и подготовленные изменения без обнаруженных секретов.
- Обязательные проверки перед тегом: полный gate на релизной версии, локальная release-сборка и зелёный Preflight macos на точном SHA; результаты сохраняются в GitHub Actions.

## Distribution

DMG и ZIP приложения публикуются вместе с SHA256SUMS. Сборка в CI имеет ad-hoc подпись без нотарификации Apple; первый запуск может потребовать Open Anyway. Ручной полный прогон всех сценариев записи/перевода на разных моделях не выполнен.
