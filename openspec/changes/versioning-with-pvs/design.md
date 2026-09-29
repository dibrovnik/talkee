# Design

## Context

`@dibrovnik/pvs@0.1.1` — CLI без зависимостей: `pvs bump <patch|minor|major|prerelease|X.Y.Z>`, `sync`, `check`, `current`, `init`. Источник версии — `package.json`. Сам обновляет `package.json` и npm lockfile'ы (`package-lock.json`, `npm-shrinkwrap.json`); `bun.lock` и `Cargo.lock` НЕ трогает. Типы целей: `marker`, `replace` (JS `RegExp(match, "g")`; по умолчанию ровно одно совпадение, иначе `"multiple": true`), `json` (dot-ключи), `generated`. Флаги bump: `--commit`, `--tag`, `--tag-prefix` (по умолчанию `v`), `--message` (по умолчанию `chore: release v$version`), `--dry-run`, `--allow-dirty`. `pvs check` сравнивает результат применения целей с текущими файлами.

Где живёт версия сейчас (после `rename-to-talkee`):
- `package.json:4`
- `src-tauri/Cargo.toml` — `[package] version` и `[workspace.package] version` (sidecar `talkee-llm` использует `version.workspace = true`)
- `src-tauri/tauri.conf.json:5`
- `src-tauri/Cargo.lock` — записи `name = "talkee"` и `name = "talkee-llm"`

## Goals / Non-Goals

**Goals:** одна команда bump, одна команда check, CHANGELOG-гейт.

**Non-Goals:** автогенерация CHANGELOG из коммитов; публикация релизов (нет канала обновлений — удалён в `remove-telemetry`).

## Decisions

1. **Tauri читает версию из package.json:** в `tauri.conf.json` `"version": "../package.json"` (поддерживается Tauri v2 — путь к `package.json` относительно `tauri.conf.json`). Проверить после изменения: `bun run tauri build` → `Info.plist` в `.app` содержит правильную `CFBundleShortVersionString`.
2. **`pvs.config.json`** (проверено 29.09.2026 на копии реальных `Cargo.toml`/`Cargo.lock` с pvs 0.1.1: `check`, `sync`, `bump` работают):
   ```json
   {
     "schemaVersion": 1,
     "targets": [
       {
         "file": "src-tauri/Cargo.toml",
         "type": "replace",
         "match": "\\nversion = \"[^\"]+\"",
         "replace": "\nversion = \"$version\"",
         "multiple": true
       },
       {
         "file": "src-tauri/Cargo.lock",
         "type": "replace",
         "match": "(?<=\\nname = \"talkee(?:-llm)?\"\\n)version = \"[^\"]+\"",
         "replace": "version = \"$version\"",
         "multiple": true
       }
     ]
   }
   ```
   - Первая цель: в `Cargo.toml` строка `version = "..."` в начале строки встречается только в `[package]` и `[workspace.package]` (зависимости — inline-таблицы). Перед фиксацией: `grep -c '^version = ' src-tauri/Cargo.toml` → `2`.
   - **Нельзя** заводить две отдельные цели на один файл: pvs применяет каждую к исходному содержимому, и вторая перезаписывает результат первой (проверено — одна из записей `Cargo.lock` остаётся старой). Поэтому обе записи lock'а обновляются одной целью с lookbehind.
3. **npm-скрипты:**
   - `"version:current": "pvs current"`
   - `"version:check": "pvs check"`
   - `"version:patch": "pvs bump patch --commit --tag"` (аналогично `minor`, `major`)
   - `"check:changelog": "bun scripts/check-changelog.mjs"`
4. **`scripts/check-changelog.mjs`:** прочитать версию из `package.json`, найти `^## \[<version>\]` в `CHANGELOG.md`; exit 1 с подсказкой при отсутствии.
5. **Порядок релиза** (`rules/release.rule.md`, переписать целиком, ≤ 60 строк):
   1. Все изменения закоммичены; `bun run gate` зелёный (до изменения `quality-gates` — `bun run check:release`).
   2. `bunx pvs bump <level> --dry-run` — узнать новую версию X.Y.Z.
   3. В `CHANGELOG.md` переименовать `## [Unreleased]` в `## [X.Y.Z] - YYYY-MM-DD`, добавить сверху пустой `## [Unreleased]`; закоммитить `docs: changelog for vX.Y.Z`.
   4. `bun run version:<level>` — bump + коммит + тег.
   5. `bun run check:changelog` — должен пройти.
   6. `bun run build:release:macos`.
6. **Удаление старого механизма:** `scripts/check-version-sync.{mjs,sh}`, скрипт `check:versions`; заменить вызовы в `check:release`, `.github/workflows/check.yml`, `release-preflight.yml`, а также в `rules/release.rule.md` и `AGENTS.md`.
7. **Cargo.lock после bump:** цели pvs обновляют lock напрямую, поэтому `cargo` не нужен. Дополнительно в задачах — проверка `cargo metadata --locked --manifest-path src-tauri/Cargo.toml >/dev/null` (упадёт, если lock рассинхронизирован).

## Risks / Trade-offs

- pvs 0.1.x — молодой пакет; зафиксировать точную версию (`"@dibrovnik/pvs": "0.1.1"`), обновлять осознанно.
- Regex-цели хрупкие при переформатировании `Cargo.toml` — `pvs check` сразу это покажет (ошибка «No matches»).
