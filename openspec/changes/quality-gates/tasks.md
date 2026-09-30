# Tasks

## 1. Инструменты

- [x] 1.1 `bun add -d --exact @biomejs/biome lefthook @types/bun`
- [x] 1.2 Создать `biome.jsonc` (design.md, решение 1), сверив стиль кавычек/точек с запятой/ширины строки с текущим кодом
- [x] 1.3 Создать `tsconfig.test.json` (design.md, решение 2)
- [x] 1.4 Создать `src-tauri/rustfmt.toml`; добавить `[workspace.lints.*]` и `[lints] workspace = true` в `src-tauri/Cargo.toml` и `src-tauri/sidecars/talkee-llm/Cargo.toml` (design.md, решение 3)
- [x] 1.5 Проверка: `bunx biome --version`, `cargo fmt --version`, `cargo clippy --version`

## 2. Нормализация кодовой базы (каждый пункт — отдельный коммит)

- [x] 2.1 `bunx biome format --write .` → коммит `style: apply biome formatting`
- [x] 2.2 `cargo fmt --all --manifest-path src-tauri/Cargo.toml` → коммит `style: apply rustfmt`
- [x] 2.3 Создать `.git-blame-ignore-revs` с хешами коммитов 2.1 и 2.2
- [x] 2.4 `bunx biome check --write .` (safe fixes); оставшиеся ошибки — по правилу из design.md, решение 1; `bun test` после исправлений → коммит `refactor: fix biome lint findings`
- [x] 2.5 `bunx tsc --noEmit -p tsconfig.test.json`; исправить ошибки типов в тестах → коммит
- [x] 2.6 `cargo clippy --fix` + ручные исправления по правилу из design.md, решение 3; `cargo test --workspace` после → коммит `refactor: fix clippy findings`
- [x] 2.7 Проверка: `bunx biome ci .`, `cargo fmt --check`, `cargo clippy ... -D warnings`, `bun test`, `cargo test --workspace` — все зелёные

## 3. Команда gate

- [ ] 3.1 Создать `scripts/gate.mjs` (design.md, решение 4), включая создание sidecar placeholder'ов
- [ ] 3.2 Тест `scripts/gate.test.mjs`: порядок групп, остановка на первой ошибке, `--keep-going` (команды подменить на `true`/`false`)
- [ ] 3.3 `package.json`: `gate`, `format`, `lint`; `check:release` = `bun run gate && bun run build`; удалить `smoke:hotkey`, `check` (заменён gate)
- [ ] 3.4 Проверка: `bun run gate` → exit 0; намеренно сломать форматирование одного файла → gate падает на группе `format`; откатить

## 4. Хуки и CI

- [ ] 4.1 Создать `lefthook.yml` (design.md, решение 5); `package.json`: `"prepare": "lefthook install"`; `bun install`
- [ ] 4.2 Проверка хука: закоммитить неотформатированный `.rs` → коммит отклонён; откатить
- [ ] 4.3 Переписать `.github/workflows/check.yml` (design.md, решение 6); удалить из `release-preflight.yml` дублирующие проверки, заменив на `bun run gate`
- [ ] 4.4 Проверка: `act` недоступен → проверить YAML `bunx yaml-lint`/визуально; после первого push убедиться, что job зелёный

## 5. Документация

- [ ] 5.1 Создать `docs/quality.md` (design.md, решение 7)
- [ ] 5.2 `AGENTS.md`: раздел «Команды» — `bun run gate`, `bun run format`; правило «перед завершением любой задачи запусти `bun run gate`»
- [ ] 5.3 `openspec/config.yaml`: в `rules.tasks` добавить «последняя задача каждого изменения — `bun run gate`»
- [ ] 5.4 Проверка: `bun run gate`; `openspec validate quality-gates --strict`
