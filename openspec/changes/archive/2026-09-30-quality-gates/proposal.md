# Proposal

## Why

Сейчас в проекте есть только `tsc --noEmit` и `cargo check`. Нет ни линтера, ни форматтера (ни для TS, ни для Rust), тестовые файлы исключены из проверки типов, а CI не запускает ни `cargo test` (≈134 теста), ни полный `bun test` (≈277 тестов). Код будет писать «простая» модель, поэтому нужны автоматические ворота: они не дадут закоммитить или отправить сломанный, неотформатированный или нарушающий правила проекта код.

## What Changes

- **Форматирование и линт TS/JS:** Biome — один быстрый инструмент вместо eslint+prettier. Конфиг `biome.json` с рекомендованными правилами.
- **Rust:**
  - `rustfmt.toml`;
  - `cargo clippy` с `-D warnings`;
  - `[lints]` в `Cargo.toml`;
  - `cargo test` для всего workspace.
- **Проверка типов в тестах:** отдельный `tsconfig.test.json`, `@types/bun`.
- **Единая команда `bun run gate`** последовательно запускает:
  1. `version:check`, `check:changelog`, `check:network`, `check:naming`, `check:agents-docs`, `check:repo`, `openspec validate --all --strict`;
  2. `biome ci`, `cargo fmt --check`;
  3. `tsc` (код и тесты), `cargo clippy`;
  4. `bun test`, `cargo test`.
- **Git-хуки через lefthook:**
  - `pre-commit` — быстрые проверки по изменённым файлам: Biome, rustfmt, `version:check`, `check:naming`;
  - `pre-push` — полный `bun run gate`.
- **CI:** один job на `macos-latest`, запускающий `bun run gate` и сборку фронтенда.
- **Разовая нормализация кодовой базы:** механический коммит форматирования (`biome format --write`, `cargo fmt`) и исправление или точечное подавление существующих предупреждений.
- **Удалить устаревшее:** скрипт `smoke:hotkey` (покрывается `bun test`), а `check:release` сделать алиасом `gate` + `build`.

Зависит от: `versioning-with-pvs`.

## Capabilities

### New Capabilities
- `quality-gates`: какие проверки обязательны, где они запускаются (локально, в хуках, в CI) и что считается прохождением.

### Modified Capabilities
<!-- нет -->

## Impact

- **Новые файлы:** `biome.json`, `rustfmt.toml`, `lefthook.yml`, `tsconfig.test.json`, `scripts/gate.mjs`.
- **Изменяемые файлы:** `package.json` (devDeps `@biomejs/biome`, `lefthook`, `@types/bun`), `src-tauri/Cargo.toml` (`[lints]`), `.github/workflows/check.yml`, `AGENTS.md`.
- **Масштаб:** массовое переформатирование почти всех файлов `src/` и `src-tauri/src/` — отдельным коммитом, без изменения поведения.
