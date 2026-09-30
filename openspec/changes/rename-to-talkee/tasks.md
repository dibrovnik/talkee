# Tasks

## 1. Миграция данных (сначала, пока старые пути ещё известны коду)

- [x] 1.1 Создать `src-tauri/src/legacy_migration.rs` по design.md, решение 2 (функция `migrate_from_talkis(old_dir: &Path, new_dir: &Path) -> Result<MigrationReport, String>` без зависимости от `AppHandle`, чтобы её можно было тестировать)
- [x] 1.2 Unit-тесты в том же модуле на `tempdir`: пустой старый каталог; полный старый; новый уже содержит `talkee.json` (не перезаписывается); повторный запуск с маркером; переписывание путей в настройках
- [x] 1.3 Вызвать миграцию в `src-tauri/src/lib.rs` в `setup` до инициализации store, истории и окон; при ошибке — лог и событие для показа сообщения в виджете
- [x] 1.4 Источник истины языка интерфейса — настройки (design.md, решение 3); обновить `src/i18n/index.tsx`
- [x] 1.5 Проверка: `cargo test --manifest-path src-tauri/Cargo.toml legacy_migration`

## 2. Идентичность приложения (конфиг)

- [x] 2.1 `src-tauri/tauri.conf.json`: `productName: "Talkee"`, `mainBinaryName: "talkee"` (или удалить, если не нужен), `identifier: "com.talkee.app"`, заголовки окон, `externalBin` → `binaries/talkee-*`
- [x] 2.2 `src-tauri/Info.plist`: имя бандла
- [x] 2.3 `src-tauri/Cargo.toml`: `name = "talkee"`, `description`, `default-run = "talkee"`, `[lib] name = "talkee_lib"`, workspace member `sidecars/talkee-llm`; обновить `src-tauri/src/main.rs` (`talkis_lib::run()` → `talkee_lib::run()`)
- [x] 2.4 Переименовать каталог `src-tauri/sidecars/talkis-llm` → `talkee-llm` и имя пакета в его `Cargo.toml`
- [x] 2.5 Переименовать `src-tauri/src/bin/talkis-stt.rs` → `talkee-stt.rs`, `talkis-diarize.rs` → `talkee-diarize.rs`; хардкод identifier в `talkee-stt.rs` → `com.talkee.app` (design.md, решение 1)
- [x] 2.6 `package.json`: `name: "talkee"`, скрипты `logs`, `logs:clear`; `index.html`: `<title>Talkee</title>`
- [x] 2.7 Удалить старые артефакты `src-tauri/binaries/talkis-*`; пересобрать sidecar'ы `bun run prepare:sidecars`
- [x] 2.8 Проверка: `cargo check --manifest-path src-tauri/Cargo.toml` и `bun run tauri dev` стартует

## 3. Rust: строки и пути

- [x] 3.1 `logger.rs`: `~/.talkee/talkee.log`
- [x] 3.2 `history_storage.rs`: маркер `.talkee-app-data-layout-v3` (учесть старый маркер при чтении слоя)
- [x] 3.3 Имена sidecar'ов в `local_stt.rs`, `llm_runtime.rs`, `media/ffmpeg.rs`, `shutdown.rs`; в `cleanup_orphaned_sidecars` убивать и `talkee-*`, и `talkis-*` (design.md, решение 4)
- [x] 3.4 `commands/accessibility.rs` `APP_BUNDLE_ID`, `call_capture.rs:1888`, `paste.rs:600` sentinel, `lib.rs:241` сообщение ошибки, `tray.rs` подписи
- [x] 3.5 Env: `TALKIS_*` → `TALKEE_*` во всех `.rs`
- [x] 3.6 Проверка: `cargo check && cargo test` (manifest `src-tauri/Cargo.toml`)

## 4. Frontend

- [x] 4.1 `src/lib/store.ts:1374`, `src/lib/stats.ts:22`: `talkee.json`
- [x] 4.2 `src/lib/logger.ts:34`: путь лога
- [x] 4.3 i18n-словари: «Talkis» → «Talkee» (~73 вхождения), проверить склонения в русских строках («в Talkee», «Talkee не может…»)
- [x] 4.4 Остальные вхождения `grep -rni talkis src`
- [x] 4.5 Проверка: `bunx tsc --noEmit && bun test`

## 5. Скрипты, CI, документация

- [ ] 5.1 `scripts/*`: имена, env, `--talkee-check-dev-port`, identifier в `postprocess-macos-release.sh` и `run-macos-dev-app.sh`, `APP_NAME=Talkee`
- [ ] 5.2 `.github/workflows/*`: имена релизов, артефактов, env
- [ ] 5.3 `AGENTS.md`, `README.md`, `README.ru.md`, `docs/**`, `rules/**`: замена имени; переименовать `skills/talkis-product-ui-style` → `skills/talkee-product-ui-style` и `references/talkis-product-ui.md` → `talkee-product-ui.md`, обновить ссылки в `AGENTS.md`
- [ ] 5.4 README: раздел «Переход с Talkis» — что переносится автоматически, что нужно заново выдать разрешения, где лежит старый каталог и как удалить его вручную
- [ ] 5.5 Проверка: `bun run check:versions` (или `pvs check`, если уже настроен)

## 6. Защита от регрессии

- [ ] 6.1 Создать `scripts/naming-allowlist.json` и `scripts/check-naming.mjs` (design.md, решение 5) + тест `scripts/check-naming.test.mjs`
- [ ] 6.2 `package.json`: `"check:naming": "bun scripts/check-naming.mjs"`
- [ ] 6.3 Проверка: `bun run check:naming` → exit 0
- [ ] 6.4 Ручная проверка миграции: скопировать реальный `~/Library/Application Support/com.trixter.talkis` в резерв, запустить собранный talkee, убедиться, что история, настройки и модели на месте
- [ ] 6.5 Проверка: `openspec validate rename-to-talkee --strict`
