# Качество кода (quality gates)

В проекте есть один вход для всех обязательных проверок — `bun run gate`. Он
запускает проверки по возрастанию стоимости и завершается с кодом 0 только если
прошли все. Те же проверки запускаются в git-хуках и в CI, поэтому «зелёный gate
локально» означает «зелёный CI».

## Как запускать

```bash
bun run gate                 # все группы проверок
bun run gate --only format   # только одна группа
bun run gate --keep-going    # не останавливаться на первой ошибке
bun run format               # применить Biome + rustfmt
bun run lint                 # только линт Biome
```

Группы запускаются по порядку `static → format → types-lint → tests`. Без
`--keep-going` команда останавливается на первой упавшей группе и помечает
остальные как пропущенные; в конце печатается сводка `✓/✗ имя время`.

## Что проверяется

| Группа | Проверка | Команда |
| --- | --- | --- |
| static | синхронность версий | `bun run version:check` |
| static | запись в CHANGELOG | `bun run check:changelog` |
| static | сетевой allowlist | `bun run check:network` |
| static | отсутствие старого имени | `bun run check:naming` |
| static | пути в `AGENTS.md` | `bun run check:agents-docs` |
| static | гигиена git-индекса | `bun run check:repo` |
| static | валидность OpenSpec | `openspec validate --all --strict` |
| format | формат и линт TS/JS/JSON | `bunx biome ci .` |
| format | формат Rust | `cargo fmt --all --check` |
| types-lint | типы приложения | `bunx tsc --noEmit -p tsconfig.json` |
| types-lint | типы тестов | `bunx tsc --noEmit -p tsconfig.test.json` |
| types-lint | предупреждения Rust | `cargo clippy --workspace --all-targets -- -D warnings` |
| tests | TS-тесты | `bun test` |
| tests | Rust-тесты | `cargo test --workspace` |

Перед запуском `cargo` gate создаёт пустые placeholder'ы в
`src-tauri/binaries/talkee-*-<target-triple>`, если их нет: `tauri-build`
требует эти файлы, а реальные sidecar'ы собираются отдельно.

## Где что настроено

- `biome.jsonc` — форматтер и линтер TS/JS/JSON (закреплённая версия Biome).
- `tsconfig.test.json` — проверка типов тестов, расширяет `tsconfig.json`.
- `src-tauri/rustfmt.toml` и `[workspace.lints]` в `src-tauri/Cargo.toml` — Rust.
- `scripts/gate.mjs` — список групп и раннер, `scripts/gate.test.mjs` — тесты.
- `lefthook.yml` — git-хуки: `pre-commit` (быстрый, по изменённым файлам) и
  `pre-push` (полный `bun run gate`). Ставятся через `bun install`
  (`prepare` → `lefthook install`).
- `.github/workflows/check.yml` — один job на `macos-latest`: `bun run gate` +
  сборка фронтенда.

В экстренном случае хуки можно обойти: `git commit --no-verify` /
`git push --no-verify`.

## Как добавить проверку

1. Добавьте `{ name, cmd }` в нужную группу в `GATE_GROUPS` (`scripts/gate.mjs`).
2. Если проверка дорогая — ставьте её в конец группы, чтобы дешёвые падали раньше.
3. Обновите таблицу в этом файле и, при необходимости, тесты в
   `scripts/gate.test.mjs`.

## Отложенное

Правила, отключённые в `biome.jsonc` (порог: правило срабатывало больше 20 раз,
поэтому его вынесли в отдельную задачу, а не чинили здесь):

- `lint/correctness/useExhaustiveDependencies` — 66 срабатываний. Хуки виджета
  намеренно не перечисляют часть зависимостей, чтобы не перезапускать
  императивные рантаймы; разбирать это нужно отдельно и аккуратно.
- `lint/a11y/useButtonType` — 25 срабатываний. Кнопки наследуют `type` из
  контекста; массовая простановка `type="button"` — отдельная чистка.

## Подавления

Подавления должны быть точечными и с причиной:

```ts
// biome-ignore lint/a11y/useSemanticElements: <почему это допустимо>
```

Глобальное отключение правила допускается только в `biome.jsonc` с комментарием
и записью в разделе «Отложенное» выше.
