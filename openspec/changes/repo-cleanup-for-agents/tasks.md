# Tasks

## 1. Git (выполнить ДО первого изменения `remove-telemetry`; если репозиторий уже создан — только проверить пункты)

- [x] 1.1 Обновить `.gitignore`: `src-tauri/binaries/*` + `!src-tauri/binaries/.gitkeep`, `src-tauri/target/`, `docs/demo/`, удалить Beads/Dolt-правила (`.dolt/`, `*.db`, `.beads-credential-key`), добавить `.nanocoder/`
- [x] 1.2 `git init -b main`; `git add -A`; убедиться через `git status`, что бинарники и GIF не добавлены; первый коммит `chore: initial import of talkee` (репозиторий уже существует на `main`; `git init`/initial import не выполнялись — состояние проверено)
- [x] 1.3 Проверка: `git ls-files | xargs -I{} du -k {} | sort -n | tail -5` — нет файлов > 5 МБ

## 2. Удаление мусора

- [x] 2.1 Удалить `.nanocoder/`, `.agent/`, `compose.yaml`, `compose.cpu.yaml`, `site/`, `public/vite.svg`, `public/tauri.svg` (если `public/` опустел — удалить и его, проверив `vite.config.ts`), все `.DS_Store`
- [x] 2.2 `.env.example`: удалить, если в нём только комментарии
- [x] 2.3 Удалить `docs/demo/`; убрать/заменить ссылки на GIF в `README.md`, `README.ru.md`
- [x] 2.4 `docs/release/`: оставить `review-template.md`, `trust-and-signing.md` и последний `review-v*.md`, остальные удалить
- [x] 2.5 Перенести `testing_plan.md` → `docs/testing/manual-style-test-plan.md`
- [x] 2.6 `docs/business-requirements.md`: удалить, если он описывает только облачный бизнес; иначе очистить от устаревшего (документ общий, не облачный; удалены устаревшие упоминания Windows/Linux)
- [x] 2.7 Коммит `chore: remove junk and stale artifacts`

## 3. Удаление Beads

- [ ] 3.1 Удалить `.agents/skills/beads/`, `.codex/hooks.json`, `.codex/config.toml` (и `.codex/`, если опустел)
- [ ] 3.2 Проверка: `grep -rni "beads\|\bbd \|dolt" --exclude-dir=node_modules --exclude-dir=openspec --exclude-dir=.git .` — совпадений нет, кроме, возможно, CHANGELOG

## 4. Документация для агентов

- [ ] 4.1 Написать `docs/architecture/overview.md` (design.md, решение 4)
- [ ] 4.2 Переписать `AGENTS.md` по структуре из design.md, решение 3 (≤ 200 строк)
- [ ] 4.3 Создать `CLAUDE.md` с содержимым `@AGENTS.md`
- [ ] 4.4 `skills/talkee-product-ui-style/SKILL.md` и `references/*`: удалить дубли токенов/цветов, заменить ссылкой на `rules/style.rule.md`
- [ ] 4.5 Добавить в `AGENTS.md` примечание: `.claude/skills/openspec-*` и `.agents/skills/openspec-*` генерируются `openspec update`, руками не править
- [ ] 4.6 `CHANGELOG.md`: перенести историю версий из `README.md`/`README.ru.md` (design.md, решение 7); в README оставить ссылку
- [ ] 4.7 Коммит `docs: rewrite agent entry point`

## 5. Скрипты проверок

- [ ] 5.1 `scripts/check-agents-docs.mjs` (design.md, решение 5) + тест
- [ ] 5.2 `scripts/check-repo.mjs` (design.md, решение 6) + тест
- [ ] 5.3 `package.json`: `check:agents-docs`, `check:repo`
- [ ] 5.4 Проверка: `bun run check:agents-docs && bun run check:repo && bun test scripts`
- [ ] 5.5 Проверка: `openspec validate repo-cleanup-for-agents --strict`; коммит `chore: add repo hygiene checks`
