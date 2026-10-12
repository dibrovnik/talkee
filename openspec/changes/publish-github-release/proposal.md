# Proposal

## Why

Talkee нужно опубликовать в GitHub пользователя dibrovnik: сейчас remote отсутствует, README ведёт на другой аккаунт, а CI пропускает подготовку настоящих sidecar-бинарников. Нужны понятная витрина и проверенная скачиваемая сборка macOS.

## What Changes

- Оформить README на английском и русском: ссылки, значки состояния, настоящие скриншоты без личных записей, возможности и установка.
- Исправить существующие release/preflight workflow: ARM runner, штатная сборка sidecar и frontend, checkout точного тега, безопасные имена артефактов и контрольные суммы.
- Добавить инструкции участникам и шаблоны issues, исключить временные файлы.
- Опубликовать текущие исходники в публичный dibrovnik/talkee; выполнить preflight и первый выпуск с DMG и ZIP.

## Capabilities

### New Capabilities

Нет: документация и инфраструктура публикации, skip_specs: true.

### Modified Capabilities

Нет: поведение приложения не меняется.

## Impact

README.md, README.en.md, docs/screenshots/, .github/, .gitignore, scripts/postprocess-macos-release.sh, rules/release.rule.md и GitHub metadata. Существующие изменения приложения сохраняются; локальные временные файлы и настройки не публикуются. Зависимостей приложения не добавляется. Depends on: отсутствуют.
