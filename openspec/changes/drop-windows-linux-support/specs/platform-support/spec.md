# Spec Delta

## Purpose

Определяет, что talkee поддерживает только macOS на Apple Silicon, и описывает, как ведут себя сборка, CI и пользовательский интерфейс при такой единственной платформе.

## ADDED Requirements

### Requirement: macOS on Apple Silicon only
Приложение SHALL собираться и запускаться только на macOS для архитектуры `aarch64-apple-darwin`. Попытка скомпилировать Rust-часть под другую ОС MUST завершаться ошибкой компиляции с сообщением «talkee supports macOS only».

#### Scenario: Сборка на Linux
- **WHEN** разработчик запускает `cargo check` на Linux
- **THEN** компиляция завершается ошибкой с текстом «talkee supports macOS only»

#### Scenario: Сборка на Mac с Apple Silicon
- **WHEN** разработчик запускает `bun run tauri build` на Mac с Apple Silicon
- **THEN** создаются только `.app` и `.dmg` для `aarch64-apple-darwin`

### Requirement: No platform branches in UI
Пользовательский интерфейс MUST NOT содержать текстов, подсказок, сочетаний клавиш или элементов, предназначенных для Windows или Linux (например, `Ctrl` вместо `⌘` в подсказках, инструкции для PipeWire/X11, кастомный Windows-заголовок окна).

#### Scenario: Подсказка горячей клавиши
- **WHEN** пользователь открывает настройку горячей клавиши
- **THEN** модификаторы показаны в macOS-нотации (⌘, ⌥, ⌃, ⇧), и нет упоминаний Windows/Linux

### Requirement: Call capture uses macOS system audio only
Захват системного звука для записи созвонов SHALL использовать только macOS Core Audio (process/system tap). Сообщения об ошибках захвата MUST ссылаться только на macOS-разрешения.

#### Scenario: Нет разрешения на запись системного звука
- **WHEN** пользователь начинает запись созвона без разрешения на захват системного звука
- **THEN** приложение показывает сообщение с инструкцией для «Системные настройки → Конфиденциальность и безопасность», без упоминаний PipeWire или WASAPI

### Requirement: Single-platform CI
CI SHALL выполнять все проверки только на macOS arm64 runner'е.

#### Scenario: Pull request
- **WHEN** открывается pull request
- **THEN** запускаются задачи только на macOS runner'е, и нет задач Windows или Linux
