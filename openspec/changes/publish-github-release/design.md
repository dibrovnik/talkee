# Design

## Context

См. proposal.md. В репозитории уже есть gate, preflight, release, build-release.mjs и postprocess; требуется исправить связку, а не вводить ещё одну систему. Текущая ветка содержит незавершённые изменения пользователя, которые нужно сохранить.

## Goals / Non-Goals

**Goals:** публичный dibrovnik/talkee, настоящие скриншоты, воспроизводимый ARM build, DMG/ZIP и SHA-256 в Releases.

**Non-Goals:** Windows/Linux/Intel, подписка, updater, платная Apple Developer подпись и нотарификация.

## Decisions

- README.md и README.en.md: сохранить подробную документацию, добавить компактную витрину и исправить ссылки.
- docs/screenshots/: GIF демонстрации реального компонента IslandPresentation в мокапе MacBook;  снимать безопасные вкладки текущего нативного приложения; не публиковать историю, ключи и приватные записи.
- .github/workflows/release.yml и release-preflight.yml: macos-14 (Apple Silicon), bun run build:release:macos, точный checkout тега при ручном выпуске, clippy/rustfmt для gate. Preflight остаётся обязательным перед тегом.
- .github/workflows/check.yml: тот же ARM runner и read-only permissions.
- scripts/postprocess-macos-release.sh: bundle identifier из tauri.conf.json, чтобы подпись и bundle совпадали.
- .gitignore и scripts/check-naming.mjs: исключить локальную .tmp-verify; .github/CONTRIBUTING.md и ISSUE_TEMPLATE/: инструкции и формы вместо дополнительного сайта.
- rules/release.rule.md: описать публикацию и отсутствие нотарификации.

## Risks / Trade-offs

- [Gatekeeper блокирует не нотарифицированный app] → честные инструкции установки и ad-hoc подпись в CI.
- [Тестовые sidecar-заглушки попадают в bundle] → существующий release-скрипт обязательно пересобирает их.
- [Расхождение проверенного SHA и релиза] → preflight и checkout точного тега.
- [Публикация секретов/временных файлов] → проверка индекса и истории до push, скриншоты безопасных вкладок.
- [Рабочие изменения ещё не проходили gate] → проверка и необходимые минимальные исправления до релиза.

## CI discovery

На чистом runner отсутствует openspec: добавить @fission-ai/openspec 1.14.0 в devDependencies и bun.lock. В scripts/prepare-stt-sidecar.mjs убрать только target-cpu из RUSTFLAGS процесса сборки LLM: llama-cpp-sys ошибочно преобразует apple-m1 в неподдерживаемый Clang -march. Остальные флаги сохраняются; LLM остаётся на переносимой ARM-базе. Проверка — настоящая release-сборка.
