# Proposal

## Why

В репозитории много мусора и устаревших инструкций, которые сбивают ИИ-агентов:
- 278 МБ демо-GIF;
- 251 МБ собранных sidecar-бинарников без правила в `.gitignore`;
- `compose*.yaml` от стороннего проекта;
- пустой `.nanocoder/`;
- workflow для чужого Go-прокси с путями `/Volumes/KINGSTON/...`;
- лендинг `site/`;
- 46 старых review-файлов релизов;
- устаревший `CHANGELOG.md`.

`AGENTS.md` (458 строк) описывает несуществующий `talkis-web/`, неверные пути (`media.rs`, `tauri-plugin-global-shortcut`, виджет 50×18) и требует Beads (`bd`), который не установлен. Кроме того, каталог не является git-репозиторием. Агенту нужен короткий точный вход и чистое дерево.

## What Changes

- Инициализировать git-репозиторий, первый коммит — текущее состояние после предыдущих изменений (до чистки), чтобы все удаления были видимы в истории.
- Удалить мусор:
  - `.nanocoder/`, `.agent/`, `compose.yaml`, `compose.cpu.yaml`, `site/`, `public/vite.svg`, `public/tauri.svg`;
  - `.env.example`, если он без полезного содержимого;
  - все `.DS_Store`;
  - `docs/demo/*.gif` (перенести в GitHub Releases/внешнее хранилище или удалить);
  - `docs/release/review-v0.*.md`: оставить шаблон и последний review, остальные удалить;
  - `testing_plan.md`: перенести в `docs/testing/manual-style-test-plan.md` или удалить.
- **BREAKING (для процесса)** Отказаться от Beads как трекера задач: удалить Beads-секции из `AGENTS.md`, `.codex/hooks.json`, `.codex/config.toml` (если в них только Beads), `.agents/skills/beads/`. Планирование ведётся через OpenSpec (`openspec/changes/`).
- Переписать `AGENTS.md` как короткий актуальный вход (≤ 200 строк):
  - что это за приложение;
  - карта каталогов;
  - команды;
  - правила кода;
  - ссылки на `docs/` и `rules/`;
  - workflow OpenSpec.
  Длинные разделы (дизайн-система, аудио-пайплайн) — ссылками на существующие документы.
- Добавить `CLAUDE.md` с единственной строкой-импортом `@AGENTS.md`, чтобы Claude Code и Codex читали один источник.
- Добавить `docs/architecture/overview.md`: карта модулей Rust и frontend с ответственностью каждого файла верхнего уровня.
- Свести историю версий: перенести разделы «### vX.Y.Z» из `README.md`/`README.ru.md` в `CHANGELOG.md` (формат Keep a Changelog), README ссылается на CHANGELOG.
- Устранить дублирование `rules/style.rule.md` ↔ `skills/talkee-product-ui-style/` ↔ раздел «Design System» в `AGENTS.md`: источник истины — `rules/style.rule.md`, скилл ссылается на него, `AGENTS.md` — одна ссылка.
- Дублирование OpenSpec-скиллов в `.claude/skills/` и `.agents/skills/` оставить (генерирует `openspec init` для двух инструментов), но задокументировать, что их обновляет `openspec update`, а не руками.
- Обновить `.gitignore`: `src-tauri/binaries/*` кроме `.gitkeep`, `src-tauri/target/`, `*.gif` в `docs/`, `.DS_Store` (уже есть), удалить Beads/Dolt-правила.

Зависит от: `drop-windows-linux-support`.

## Capabilities

### New Capabilities
- `agent-workspace`: контракт репозитория для разработчиков и ИИ-агентов — точка входа, актуальность документации, что хранится в git.

### Modified Capabilities
<!-- нет -->

## Impact

- Файлы и каталоги в корне, `docs/`, `.agent/`, `.agents/skills/beads/`, `.codex/`, `.nanocoder/`, `site/`, `public/`, `rules/`, `skills/`.
- Поведение приложения не меняется.
- Размер рабочего дерева: минус ~530 МБ (GIF + бинарники вне git).
