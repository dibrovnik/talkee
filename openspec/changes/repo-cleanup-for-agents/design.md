# Design

## Context

Инвентаризация (29.09.2026):

| Путь | Вердикт |
|---|---|
| `.agent/workflows/update-prompts.md` | удалить (синхронизация с облачным Go-прокси, пути `/Volumes/KINGSTON`) |
| `.agents/skills/openspec-*` | оставить (генерирует `openspec init --tools codex`) |
| `.agents/skills/beads/` | удалить |
| `.claude/` | оставить (OpenSpec для Claude Code) |
| `.codex/hooks.json`, `.codex/config.toml` | удалить (только Beads-хуки) |
| `.nanocoder/tasks.json` (`[]`) | удалить |
| `.vscode/extensions.json` | оставить |
| `.github/workflows/*` | оставить (к этому моменту уже только macOS) |
| `.DS_Store` | удалить |
| `docs/demo/*.gif` (278 МБ) | удалить из репозитория; если нужны для README — загрузить в GitHub Release и ссылаться по URL |
| `docs/release/review-v0.*.md` (≈45) | удалить все, кроме `review-template.md`, `trust-and-signing.md` и последнего review |
| `docs/architecture/processing-modes.md`, `docs/audio-pipeline-principles.md`, `docs/local-stt-runtime.md` | оставить (уже обновлены предыдущими изменениями) |
| `docs/business-requirements.md` | проверить; облачная часть уже удалена в `remove-talkis-cloud`; если документ устарел целиком — удалить |
| `rules/style.rule.md`, `rules/release.rule.md` | оставить; release перепишет `versioning-with-pvs` |
| `skills/talkee-product-ui-style/` | оставить, убрать дубли (ссылка на rules) |
| `site/index.html` | удалить (лендинг, не часть приложения) |
| `testing_plan.md` | перенести в `docs/testing/manual-style-test-plan.md` |
| `compose.yaml`, `compose.cpu.yaml` | удалить (speaches из чужого проекта, ссылаются на несуществующий Dockerfile) |
| `CHANGELOG.md` | сделать единственной историей версий |
| `README.md` / `README.ru.md` | оставить оба, убрать историю версий |
| `public/vite.svg`, `public/tauri.svg` | удалить (шаблон Vite; ссылок нет — проверено grep) |
| `index.html` | оставить |
| `.env.example` | удалить, если содержит только комментарии |
| `LICENSE` | оставить (AGPL-3.0 — форк обязан сохранить) |

## Goals / Non-Goals

**Goals:**
- Чистое дерево, git с первого шага.
- Короткий точный `AGENTS.md`, автоматическая проверка его путей.

**Non-Goals:**
- Линтеры и CI-гейты (изменение `quality-gates`; здесь только скрипты `check:agents-docs` и `check:repo`, которые `quality-gates` подключит).
- Рефакторинг кода.

## Decisions

1. **git init — до всех изменений** (см. `openspec/config.yaml`), группа задач 1 этого изменения выполняется самой первой. Сначала коммит «как есть» (с `.gitignore`, исключающим бинарники и GIF, чтобы они не попали в историю), затем чистка отдельными коммитами. Ветка `main`. Remote не настраиваем (не задан пользователем).
2. **Beads удаляем.** `bd` и `dolt` на машине не установлены, `.beads` не существует; второй трекер рядом с OpenSpec создаёт конфликтующие инструкции.
3. **Структура нового `AGENTS.md`** (порядок разделов):
   1. «Что это» — 3 строки: talkee, macOS/Apple Silicon, Tauri v2 + React, режимы API/Локально, без облака и телеметрии.
   2. «Карта репозитория» — дерево до 2 уровней с одной строкой на каталог; подробности — `docs/architecture/overview.md`.
   3. «Команды» — dev, build, test, gate, logs, version bump (последние два появятся в следующих изменениях — добавить их туда).
   4. «Правила кода» — существующий раздел Code Style + Modularity, сжатый.
   5. «Предметные правила» — ссылки: аудио → `docs/audio-pipeline-principles.md`, режимы → `docs/architecture/processing-modes.md`, UI → `rules/style.rule.md`, релиз → `rules/release.rule.md`, приватность → `docs/privacy.md`.
   6. «Workflow» — OpenSpec: `/opsx:propose` → `/opsx:apply` → `/opsx:archive`; порядок изменений в `openspec/config.yaml`.
   7. «Key conventions» — UI на русском, код на английском, bun, лог `~/.talkee/talkee.log`, dev-only фичи за `import.meta.env.DEV`.
4. **`docs/architecture/overview.md`:** таблица «файл/модуль → ответственность → ключевые команды/экспорты» для `src-tauri/src/*` и `src/{lib,windows,components}/*`. Генерировать вручную (агентом) один раз.
5. **Скрипт `scripts/check-agents-docs.mjs`:** извлечь из `AGENTS.md` все подстроки в обратных кавычках, похожие на пути (содержат `/` или заканчиваются на известное расширение), проверить `fs.existsSync`; вывести отсутствующие; exit 1. Исключения: шаблоны с `<`, `*`, `~`.
6. **Скрипт `scripts/check-repo.mjs`:** `git ls-files -z` → размер каждого файла; ошибка при > 5 МБ; ошибка, если в индексе есть `.DS_Store`, `src-tauri/binaries/*` (кроме `.gitkeep`), `target/`, `dist/`.
7. **CHANGELOG:** формат Keep a Changelog; разделы `## [Unreleased]`, `## [0.4.8] - <дата>` … перенести из README (RU-версию считать основной; язык CHANGELOG — русский). Старые записи 0.1.x из текущего CHANGELOG сохранить.

## Risks / Trade-offs

- Удаление GIF ломает картинки в README → заменить ссылками или убрать из README.
- Удаление review-файлов теряет историю ревью → она сохранится в первом git-коммите.
