# Design

## Context

Текущее состояние (аудит 29.09.2026):

- `tsconfig.json`: `strict`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`; `*.test.ts(x)` исключены.
- Нет eslint/biome/prettier/.editorconfig/rustfmt.toml/clippy.toml/lefthook/husky.
- Тесты: 37 TS-файлов (≈277 тестов, `bun test`), 24 Rust-файла с `#[cfg(test)]` (≈134 теста).
- CI (`.github/workflows/check.yml`): `cargo check` + frontend-check (`tsc`, `smoke:hotkey`); к этому моменту уже только macOS (после `drop-windows-linux-support`). Есть шаг «sidecar placeholders» для `tauri-build` — нужен и `cargo clippy`/`cargo test`.

Скрипты `check:*` созданы предыдущими изменениями: `check:network` (remove-telemetry), `check:naming` (rename-to-talkee), `check:agents-docs`, `check:repo` (repo-cleanup-for-agents), `version:check`, `check:changelog` (versioning-with-pvs).

## Goals / Non-Goals

**Goals:** одна команда, хуки, CI, чистая база.

**Non-Goals:**
- Порог покрытия тестами (преждевременно).
- Аудит зависимостей (`cargo audit`/`cargo deny`) — можно добавить позже.
- e2e-тесты UI.

## Decisions

1. **Biome** (`@biomejs/biome`, закрепить точную версию, на 29.09.2026 — 2.5.x):
   - `biome.json`: `formatter.indentStyle: "space"`, `indentWidth: 2`, `lineWidth: 100`; `javascript.formatter.quoteStyle: "double"`, `semicolons: "always"` (так написан текущий код — проверить по 3-4 файлам перед фиксацией, чтобы диф форматирования был минимальным);
   - `linter.rules.recommended: true`;
   - `files.includes`: `src/**`, `scripts/**`, `*.json`, `*.ts`; исключить `src-tauri/**`, `openspec/**`, `.claude/**`, `.agents/**`, `dist/**`, `CHANGELOG.md`;
   - процедура нормализации: `bunx biome check --write` (только safe fixes) → оставшиеся ошибки: если правило срабатывает > 20 раз, отключить его в `biome.json` с полем-комментарием (использовать `biome.jsonc`, чтобы были комментарии) и завести пункт в разделе «Отложенное» в `docs/quality.md`; иначе исправить вручную;
   - `--unsafe` фиксы НЕ применять автоматически.
2. **tsconfig для тестов:** `tsconfig.test.json` extends `tsconfig.json`, `include: ["src"]`, `exclude: []`, `compilerOptions.types: ["bun"]`; `bun add -d @types/bun`. В gate: `tsc --noEmit -p tsconfig.json && tsc --noEmit -p tsconfig.test.json`. Ошибки типов в тестах исправлять в тестах, не в коде.
3. **Rust:**
   - `src-tauri/rustfmt.toml`: `edition = "2021"`, остальное по умолчанию;
   - `src-tauri/Cargo.toml`: `[workspace.lints.rust] unsafe_op_in_unsafe_fn = "warn"`; `[workspace.lints.clippy] all = { level = "warn", priority = -1 }`; в пакетах `[lints] workspace = true`;
   - gate: `cargo fmt --all --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace` (manifest `src-tauri/Cargo.toml`);
   - нормализация: `cargo fmt --all`, `cargo clippy --fix --allow-dirty --workspace --all-targets`; остаток: если lint срабатывает > 20 раз — `allow` на уровне workspace с комментарием и записью в `docs/quality.md`; иначе исправить.
   - Для `tauri-build` нужны файлы sidecar'ов: gate перед `cargo` проверяет наличие `src-tauri/binaries/talkee-*-aarch64-apple-darwin`; если нет — создаёт пустые placeholder'ы (как в текущем CI) и печатает предупреждение. Реальные sidecar'ы не собирает (долго).
4. **`scripts/gate.mjs`** (Bun, без зависимостей):
   - список групп: `static` → `format` → `types-lint` → `tests`; каждая группа — массив `{ name, cmd }`;
   - запуск через `Bun.spawn` с наследованием stdout/stderr; замер времени;
   - итоговая таблица `✓/✗ name time`;
   - флаг `--keep-going`, флаг `--only <group>`;
   - `package.json`: `"gate": "bun scripts/gate.mjs"`, `"format": "biome format --write . && cargo fmt --all --manifest-path src-tauri/Cargo.toml"`, `"lint": "biome lint ."`.
   - `check:release` → `"bun run gate && bun run build"`; удалить `smoke:hotkey`.
5. **lefthook** (`lefthook.yml`, `bun add -d lefthook`, `"prepare": "lefthook install"` в package.json — установка хуков при `bun install`):
   ```yaml
   pre-commit:
     parallel: true
     commands:
       biome:
         glob: "*.{ts,tsx,js,mjs,json,jsonc}"
         run: bunx biome check --no-errors-on-unmatched {staged_files}
       rustfmt:
         glob: "*.rs"
         run: cargo fmt --manifest-path src-tauri/Cargo.toml --all --check
       versions:
         run: bun run version:check
       naming:
         run: bun run check:naming
   pre-push:
     commands:
       gate:
         run: bun run gate
   ```
6. **CI** (`.github/workflows/check.yml`): один job `gate` на `macos-latest`: checkout → `oven-sh/setup-bun` (версия из `packageManager`) → `dtolnay/rust-toolchain@stable` с компонентами `rustfmt, clippy` → cache (`~/.cargo`, `src-tauri/target`) → `bun install --frozen-lockfile` → `bun run gate` → `bun run build`. Удалить старые jobs.
7. **`docs/quality.md`:** какие проверки есть, как запустить одну группу, как добавить проверку, список отложенных (отключённых) правил с причинами.

## Risks / Trade-offs

- Массовый коммит форматирования мешает `git blame` → добавить его хеш в `.git-blame-ignore-revs`.
- clippy на большой кодовой базе может дать сотни предупреждений → стратегия «>20 — allow с записью, иначе исправить» ограничивает объём работы.
- pre-push с полным gate долгий (cargo test/clippy) — приемлемо для одного разработчика; обход в экстренных случаях `git push --no-verify` (задокументировать).
