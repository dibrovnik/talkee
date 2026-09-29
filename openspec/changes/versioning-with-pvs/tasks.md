# Tasks

## 1. Установка и конфигурация

- [ ] 1.1 `bun add -d @dibrovnik/pvs@0.1.1 --exact`
- [ ] 1.2 `src-tauri/tauri.conf.json`: `"version": "../package.json"` (design.md, решение 1)
- [ ] 1.3 Проверить `grep -c '^version = ' src-tauri/Cargo.toml` = 2; создать `pvs.config.json` (design.md, решение 2)
- [ ] 1.4 Проверка: `bunx pvs check` → exit 0; `bunx pvs bump patch --dry-run` показывает `package.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`; `bunx pvs bump minor --dry-run` не должен показывать один файл дважды

## 2. Скрипты

- [ ] 2.1 `package.json`: скрипты `version:current`, `version:check`, `version:patch`, `version:minor`, `version:major`, `check:changelog` (design.md, решение 3)
- [ ] 2.2 Создать `scripts/check-changelog.mjs` (design.md, решение 4) и тест `scripts/check-changelog.test.mjs` (раздел есть / раздела нет)
- [ ] 2.3 Удалить `scripts/check-version-sync.mjs`, `scripts/check-version-sync.sh`, скрипт `check:versions`; в `check:release` заменить на `version:check`
- [ ] 2.4 `.github/workflows/*`: заменить `check:versions` на `version:check`
- [ ] 2.5 Проверка: `bun run version:check && bun run check:changelog && bun test scripts`

## 3. Проверка bump на практике (в отдельной ветке)

- [ ] 3.1 `git switch -c test/pvs-bump`; `bun run version:patch`; убедиться, что изменились все цели, создан коммит и тег `v0.4.9`; `cargo metadata --locked --manifest-path src-tauri/Cargo.toml >/dev/null` проходит; `bun run tauri build` → в `Talkee.app/Contents/Info.plist` версия `0.4.9`
- [ ] 3.2 Откатить эксперимент: `git switch main && git branch -D test/pvs-bump && git tag -d v0.4.9`
- [ ] 3.3 Проверка грязного дерева: изменить любой файл, `bun run version:patch` → ошибка, файлы не изменены

## 4. Документация

- [ ] 4.1 Переписать `rules/release.rule.md` (design.md, решение 5)
- [ ] 4.2 `AGENTS.md`: в «Команды» добавить `version:*`, `check:changelog`; убрать `check:versions`
- [ ] 4.3 `CHANGELOG.md`: убедиться, что есть `## [Unreleased]` и `## [0.4.8]`
- [ ] 4.4 Проверка: `bun run check:agents-docs`; `openspec validate versioning-with-pvs --strict`
