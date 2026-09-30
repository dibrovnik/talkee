# Spec Delta

## Purpose

Делает `package.json` единственным источником версии talkee и даёт одну команду для повышения версии во всех манифестах с последующей проверкой синхронности через `@dibrovnik/pvs`.

## ADDED Requirements

### Requirement: Single version source
Версия приложения SHALL задаваться полем `version` в `package.json`. Все остальные места, где хранится версия (`src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, конфигурация Tauri), MUST либо ссылаться на `package.json`, либо обновляться инструментом `pvs` по `pvs.config.json`.

#### Scenario: Версия в «О программе»
- **WHEN** в `package.json` версия `0.5.0` и приложение собрано
- **THEN** окно «О программе» показывает `0.5.0`

### Requirement: One-command bump
Команда `bun run version:patch|minor|major` SHALL повысить версию во всех целевых файлах, создать git-коммит `chore: release vX.Y.Z` и тег `vX.Y.Z`. Если рабочее дерево не чистое, команда MUST завершиться ошибкой без изменений файлов.

#### Scenario: Patch-релиз
- **WHEN** текущая версия `0.4.8`, дерево чистое, и выполняется `bun run version:patch`
- **THEN** `package.json`, обе строки `version` в `src-tauri/Cargo.toml` и записи `talkee`/`talkee-llm` в `src-tauri/Cargo.lock` содержат `0.4.9`, создан коммит и тег `v0.4.9`

#### Scenario: Грязное дерево
- **WHEN** есть незакоммиченные изменения и выполняется `bun run version:minor`
- **THEN** команда завершается с ошибкой, файлы не изменены, тег не создан

### Requirement: Version sync check
Команда `bun run version:check` SHALL завершаться с кодом 0, только если все цели из `pvs.config.json` соответствуют версии из `package.json`, и печатать список рассинхронизированных файлов в противном случае.

#### Scenario: Ручная правка Cargo.toml
- **WHEN** разработчик вручную меняет версию в `src-tauri/Cargo.toml` на `9.9.9`
- **THEN** `bun run version:check` завершается с ненулевым кодом и указывает `src-tauri/Cargo.toml`

### Requirement: Changelog entry per version
`CHANGELOG.md` SHALL содержать раздел `## [X.Y.Z]` для текущей версии из `package.json`, и проверка `bun run check:changelog` MUST завершаться ошибкой, если такого раздела нет.

#### Scenario: Забыли обновить CHANGELOG
- **WHEN** версия поднята до `0.4.9`, а в `CHANGELOG.md` нет раздела `## [0.4.9]`
- **THEN** `bun run check:changelog` завершается с ошибкой с подсказкой перенести `[Unreleased]` в `[0.4.9]`
