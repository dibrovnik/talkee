# Proposal

## Why

Версия `0.4.8` сейчас хранится вручную в пяти местах:
- `package.json`;
- `src-tauri/Cargo.toml` (`[package]` и `[workspace.package]`);
- `src-tauri/tauri.conf.json`;
- `src-tauri/Cargo.lock` (записи `talkee` и `talkee-llm`).

`rules/release.rule.md` велит править их руками, а `scripts/check-version-sync.mjs` лишь проверяет четыре из них. Нужен один инструмент, который поднимает версию везде одной командой и проверяет синхронность. Пользователь выбрал `@dibrovnik/pvs`.

## What Changes

- Добавить `@dibrovnik/pvs` в `devDependencies` (зафиксированная версия `0.1.1`).
- Добавить `pvs.config.json` с целями:
  - `Cargo.toml`: обе строки `version`;
  - `Cargo.lock`: записи `talkee` и `talkee-llm`;
  - при необходимости другие файлы с версией.
- `src-tauri/tauri.conf.json`: `"version": "../package.json"` — Tauri читает версию из `package.json`, отдельная цель не нужна.
- npm-скрипты:
  - `version:current`;
  - `version:check`;
  - `version:patch`, `version:minor`, `version:major` — используют `--commit --tag`.
- Удалить `scripts/check-version-sync.mjs`, `scripts/check-version-sync.sh` и скрипт `check:versions`. Все места, где он вызывался (`check:release`, CI), перевести на `version:check`.
- Переписать `rules/release.rule.md` под процесс с pvs:
  - обновить `CHANGELOG.md` (`[Unreleased]` → `[X.Y.Z]`);
  - запустить `bun run version:<level>`;
  - собрать приложение.
- Проверка, что в `CHANGELOG.md` есть раздел для текущей версии.

Зависит от: `repo-cleanup-for-agents` (нужен git для `--commit --tag` и CHANGELOG как единая история).

## Capabilities

### New Capabilities
- `release-versioning`: единый источник версии, команды bump/check и связь с CHANGELOG и git-тегами.

### Modified Capabilities
<!-- нет -->

## Impact

- `package.json`, `bun.lock`, новый `pvs.config.json`, `src-tauri/tauri.conf.json`.
- Удаляются `scripts/check-version-sync.{mjs,sh}`.
- `rules/release.rule.md`, `AGENTS.md` (раздел команд), `.github/workflows/*` (шаг проверки версий).
- Поведение приложения не меняется; версия в «О программе» по-прежнему берётся из конфигурации Tauri.
