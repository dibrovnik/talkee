# Tasks

## 1. Витрина

- [x] 1.1 Оформить README.md и README.ru.md, добавить в начало GIF виджета в чёлке MacBook в мокапе и сохранить безопасные нативные кадры в docs/screenshots/; проверить изображения визуально и локальные ссылки скриптом.
- [x] 1.2 Добавить .github/CONTRIBUTING.md и ISSUE_TEMPLATE/, исключить .tmp-verify в .gitignore и check-naming; проверить bun test scripts/check-naming.test.mjs и bun run check:repo.

## 2. Выпуск

- [x] 2.1 Исправить release.yml, release-preflight.yml и check.yml, postprocess-macos-release.sh; документировать выпуск в rules/release.rule.md, проверить actionlint и bash -n.
- [ ] 2.2 Проверить текущие исходники bun run check:release и собрать bun run build:release:macos; проверить codesign, DMG и четыре настоящих sidecar-бинарника.

## 3. Публикация

- [ ] 3.1 Проверить отсутствие секретов и временных файлов, создать публичный dibrovnik/talkee, push исходников и metadata; проверить gh repo view и git ls-remote.
- [ ] 3.2 Подготовить changelog и review, версию, release branch; получить зелёный Preflight macos на точном SHA и только затем push тега; проверить GitHub Release, DMG, ZIP и SHA256SUMS.
- [ ] 3.3 Выполнить итоговый bun run gate.
