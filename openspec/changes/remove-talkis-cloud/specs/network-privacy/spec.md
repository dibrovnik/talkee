# Spec Delta

## MODIFIED Requirements

### Requirement: Automated host allowlist check
Репозиторий SHALL содержать проверку, которая сканирует исходники приложения (`src/`, `src-tauri/src/`, `src-tauri/sidecars/`, `index.html`, `src/index.css`) на абсолютные URL и завершается с ненулевым кодом, если найден хост вне allowlist. Allowlist хранится в одном файле в репозитории, и каждая запись в нём снабжена комментарием с причиной. Allowlist MUST NOT содержать хостов `talkis.ru` и его поддоменов, а также секции отложенного удаления.

#### Scenario: Добавлен запрещённый хост
- **WHEN** разработчик добавляет в код `https://fonts.googleapis.com/...`
- **THEN** `bun run check:network` завершается с ошибкой и печатает файл, строку и хост

#### Scenario: Чистое дерево
- **WHEN** в коде есть только хосты из allowlist
- **THEN** `bun run check:network` завершается с кодом 0

#### Scenario: Возврат облачного хоста
- **WHEN** в коде появляется `https://proxy.talkis.ru/api/transcribe`
- **THEN** `bun run check:network` завершается с ошибкой
