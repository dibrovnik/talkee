# Design

## Context

Количество вхождений `talkis` (без учёта регистра) по данным аудита: `src/` 169 (39 файлов), `src-tauri/` 252 (34 файла), `scripts/` 64, `.github/` 28, `docs/` 275, `README.md` 61, `README.ru.md` 59, `AGENTS.md` 24, `skills/` 27, `rules/` 11. К этому моменту облачный код уже удалён (`remove-talkis-cloud`), и часть вхождений исчезла.

Каталог данных Tauri выводится из identifier: `app.path().app_data_dir()` → `~/Library/Application Support/<identifier>/`. Там лежат `talkis.json` (settings + stats, `store.ts:1374`, `stats.ts:22`), история (`history_storage.rs:45-52`), модели (могут весить гигабайты), маркер `.talkis-app-data-layout-v3`. WebView localStorage (`talkis.uiLanguage`, `src/i18n/index.tsx:17`) тоже привязан к identifier. `bin/talkis-stt.rs:323` отдельно хардкодит `com.trixter.talkis`.

В `history_storage.rs:111-116, 600-620` уже есть шаблоны legacy-миграции (`copy_dir_contents_if_missing`) — переиспользовать.

## Goals / Non-Goals

**Goals:**
- Полное переименование + безопасная миграция данных.
- Защита от регрессии (`check:naming`).

**Non-Goals:**
- Новый логотип (изменение `new-app-icons`).
- Удаление Windows/Linux кода (изменение `drop-windows-linux-support`); если попадается Windows/Linux-файл с «talkis» (например, `src-tauri/windows/installer-hooks.nsh`), его можно не переименовывать — он будет удалён следующим изменением. Добавить такие файлы во временный exclude `check:naming` с комментарием `drop-windows-linux-support`.

## Decisions

1. **Identifier `com.talkee.app`.** Задаётся в одном месте — `tauri.conf.json`; остальные места (`commands/accessibility.rs` `APP_BUNDLE_ID`, `call_capture.rs:1888`, `bin/talkee-stt.rs`, `scripts/postprocess-macos-release.sh`, `scripts/run-macos-dev-app.sh`) должны получать его из одной константы/конфига, а не дублировать строку, где это возможно. Для `bin/talkee-stt.rs` — передавать `--data-dir` из основного процесса вместо хардкода (аргумент уже передаётся в `local_stt.rs`; хардкод оставить только как fallback и сделать его `com.talkee.app`).
2. **Миграция — в Rust, до инициализации store и окон**, новый модуль `src-tauri/src/legacy_migration.rs`:
   - вход: `old_dir = home/Library/Application Support/com.trixter.talkis`, `new_dir = app_data_dir()`;
   - если `new_dir/.talkee-migrated-from-talkis` есть → выход;
   - если `old_dir` нет → записать маркер, выход;
   - рекурсивно копировать `old_dir` → `new_dir` с правилом «не перезаписывать существующее» (переиспользовать `copy_dir_contents_if_missing`); переименовать `talkis.json` → `talkee.json` (если `talkee.json` нет); маркер слоя `.talkis-app-data-layout-v3` → `.talkee-app-data-layout-v3`;
   - копирование через `std::fs::copy`/`clonefile` (на APFS `std::fs::copy` на macOS использует `fclonefileat`, поэтому гигабайты моделей копируются мгновенно и без удвоения места);
   - в настройках переписать строковые значения путей с префиксом `old_dir` на `new_dir` (поля каталогов моделей/транскрипций — точные имена взять из `store.ts`);
   - при успехе записать маркер; старый каталог НЕ удалять (решение: оставляем пользователю, логируем путь);
   - при ошибке: лог + событие в UI (widget-notice) «Не удалось перенести данные Talkis: <причина>», маркер не пишется;
   - unit-тесты на временных каталогах: пустой старый, полный старый, частично заполненный новый, повторный запуск.
3. **Язык интерфейса.** localStorage WebView привязан к identifier, и новый WebView не видит старое значение `talkis.uiLanguage`. Решение: источник истины языка — поле в настройках (`talkee.json`). Сначала проверить `src/lib/store.ts`: если поле языка интерфейса там уже есть (оно видно в `SettingsTab.tsx` как «язык интерфейса»), то `src/i18n/index.tsx` читает язык из настроек, а localStorage (`talkee.uiLanguage`) служит только синхронным кешем для первого рендера. Если поля нет — добавить `uiLanguage` в настройки. Настройки переносятся миграцией, значит язык переносится автоматически. Читать WebKit-хранилище старого identifier НЕ нужно.
4. **Sidecar'ы:** переименовать файлы-источники (`src/bin/talkis-*.rs` → `talkee-*.rs`, `sidecars/talkis-llm` → `sidecars/talkee-llm`), `[[bin]]`/workspace members, строковые литералы имён в `local_stt.rs`, `llm_runtime.rs`, `media/ffmpeg.rs`, `shutdown.rs`, `scripts/prepare-*-sidecar.mjs`. Старые бинарники в `src-tauri/binaries/talkis-*` удалить (они build-артефакты). `shutdown.rs`/`cleanup_orphaned_sidecars` должен уметь убивать и процессы со старыми именами `talkis-*` (один релиз), чтобы не оставить висящий старый sidecar — добавить оба имени в список с комментарием.
5. **Скрипт `scripts/check-naming.mjs`:** `grep -ri talkis` по репозиторию, исключая `node_modules`, `target`, `.git`, `openspec/changes/archive`, `src-tauri/Cargo.lock`, и список из `scripts/naming-allowlist.json` (файлы миграции, их тесты, `CHANGELOG.md`, `openspec/changes/rename-to-talkee/**`). Выход 1 с выводом `file:line`.
6. **Env-переменные:** механическая замена `TALKIS_` → `TALKEE_` во всех файлах; в CI проверить secrets-имена (если используются `secrets.TALKIS_*` — переименовать и отметить в README, что секреты надо переименовать в настройках репозитория).

## Risks / Trade-offs

- Повторная выдача разрешений macOS — неизбежно при смене identifier. Онбординг разрешений уже есть; проверить, что он запускается, если разрешений нет.
- Старый каталог продолжает занимать место (модели) — осознанно, безопаснее. Можно добавить в настройки кнопку «Удалить данные Talkis» отдельным изменением.
- Массовая замена строк может задеть идентификаторы в тестах/снапшотах — прогонять тесты после каждой группы задач.
