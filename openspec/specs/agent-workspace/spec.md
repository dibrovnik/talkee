# agent-workspace Specification

## Purpose
Задаёт контракт репозитория talkee для людей и ИИ-агентов: единая точная точка входа, отсутствие мусора и build-артефактов в git, один источник истины для каждого правила.

## Requirements

### Requirement: Single accurate entry point
Репозиторий SHALL содержать `AGENTS.md` длиной не более 200 строк и `CLAUDE.md`, который только импортирует `AGENTS.md`. Каждый путь к файлу или каталогу и каждая команда, упомянутые в `AGENTS.md`, MUST существовать и работать.

#### Scenario: Проверка путей в AGENTS.md
- **WHEN** запускается `bun run check:agents-docs`
- **THEN** скрипт проверяет, что все пути в обратных кавычках из `AGENTS.md` существуют, и завершается с ошибкой, если какой-то путь отсутствует

#### Scenario: Claude Code и Codex
- **WHEN** агент открывает репозиторий в Claude Code или Codex
- **THEN** оба получают одинаковые инструкции из `AGENTS.md`

### Requirement: Planning via OpenSpec only
Планирование изменений SHALL вестись только через OpenSpec (`openspec/changes/`). Репозиторий MUST NOT содержать инструкций, хуков или скиллов других трекеров задач (Beads и т.п.).

#### Scenario: Поиск упоминаний Beads
- **WHEN** выполняется `grep -rni "beads\|bd ready\|bd create" --exclude-dir=node_modules --exclude-dir=openspec .`
- **THEN** совпадений нет

### Requirement: No build artifacts or large binaries in git
Git-репозиторий MUST NOT содержать build-артефакты (sidecar-бинарники, `target/`, `dist/`), файлы больше 5 МБ и системный мусор (`.DS_Store`).

#### Scenario: Попытка закоммитить бинарник
- **WHEN** разработчик собирает sidecar'ы и выполняет `git status`
- **THEN** файлы в `src-tauri/binaries/`, кроме `.gitkeep`, не показываются как неотслеживаемые

#### Scenario: Проверка размера
- **WHEN** запускается `bun run check:repo`
- **THEN** скрипт завершается с ошибкой, если в индексе git есть файл больше 5 МБ

### Requirement: Single source of truth per topic
Каждое правило (UI-стиль, релизный процесс, аудио-пайплайн, режимы обработки) SHALL быть описано ровно в одном документе. Остальные документы MUST ссылаться на него, а не копировать содержимое.

#### Scenario: Стиль интерфейса
- **WHEN** агент ищет правила UI-стиля
- **THEN** `AGENTS.md` и `skills/talkee-product-ui-style/SKILL.md` ссылаются на `rules/style.rule.md` и не дублируют токены и цвета

### Requirement: Changelog as version history
История версий SHALL храниться только в `CHANGELOG.md` в формате Keep a Changelog. README MUST NOT содержать разделов истории версий.

#### Scenario: Поиск истории
- **WHEN** пользователь ищет, что изменилось в версии 0.4.8
- **THEN** он находит раздел `## [0.4.8]` в `CHANGELOG.md`, а README содержит только ссылку на CHANGELOG
