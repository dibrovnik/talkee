# Tasks

## 1. Модель режимов и миграция настроек

- [x] 1.1 `src/lib/modelMode.ts`: удалить `TALKIS_CLOUD_STT_MODEL`, `talkisCloudModeSettingsPatch`; добавить чистую функцию `resolveProcessingMode(settings): "api" | "local"` (localhost/127.0.0.1 в STT endpoint → `"local"`)
- [x] 1.2 `src/lib/modelMode.test.ts`: тесты на `resolveProcessingMode` (localhost, 127.0.0.1, удалённый URL, пустой endpoint)
- [x] 1.3 `src/lib/store.ts`: удалить `useOwnKey`, `deviceToken` из интерфейса настроек и дефолтов (строки ~258-261, 788-789, 1325-1327, 1360, 1619); добавить миграцию из design.md, решение 2
- [x] 1.4 Тесты миграции (сценарии из spec `processing-modes` → «Migration from legacy cloud mode»): облако+локальная модель, облако без модели, `deviceToken` удалён, прочие поля сохранены
- [x] 1.5 Проверка: `bun test src/lib/modelMode.test.ts src/lib/store` зелёный

## 2. Удаление аккаунта и подписки (UI)

- [x] 2.1 Удалить файлы `src/lib/cloudAuth.ts`, `src/lib/cloudTokenFormat.ts`, `src/lib/cloudTokenFormat.test.ts`, `src/components/UserPanel.tsx`
- [x] 2.2 `src/windows/settings/SettingsApp.tsx`: удалить импорт и рендер `UserPanel` (~47, ~614), ссылку на GitHub (~183)
- [x] 2.3 `src/windows/settings/tabs/SettingsTabs.tsx`: удалить `CloudSubscriptionAccountCard` (~877), блок баланса (~1080-1280), состояние auth-flow и polling (~2004-2506, 2236-2239, 2321, 2357), импорт `@tauri-apps/plugin-deep-link`; `type ModelMode` → `"api" | "local"`; удалить вкладку/сегмент «Облако»
- [x] 2.4 `src/windows/settings/tabs/SettingsTab.tsx:399`: убрать `isCloudMode` и зависящие ветки
- [x] 2.5 Проверка: `bunx tsc --noEmit`

## 3. Удаление облачных веток в сценариях (frontend)

- [x] 3.1 `src/windows/widget/services/transcriptionPipeline.ts`: удалить `transcribeViaProxy` и ветку «Subscription mode» (~413-537)
- [x] 3.2 `src/windows/widget/hooks/useWidgetRecording.ts:291-294`: заменить проверку `deviceToken` на проверку «режим настроен» (есть ключ/endpoint для API или установлена модель для Локально); при ненастроенном режиме — сообщение из спеки «Диктовка без модели»
- [x] 3.3 `src/windows/widget/services/dictationStreamOverlay.ts`: удалить `isCloudSttStreamingEnabled` и облачный streaming
- [x] 3.4 `src/lib/fileTranscription.ts`: удалить `/api/capabilities`, `/api/transcribe-only`, облачную диаризацию
- [x] 3.5 `src/lib/cloudTextProcessing.ts` удалить; `src/lib/summarize.ts`: `SummaryBackendKind = "custom" | "local"`, убрать cloud-ветку в `resolveSummaryBackend`
- [x] 3.6 `src/lib/realtimeModels.ts`: удалить `TALKIS_CLOUD_REALTIME_ENDPOINT`; `src/windows/widget/services/liveTranslation.ts`: удалить провайдер `"talkis-cloud"`
- [x] 3.7 Остальные файлы из `grep -rln "useOwnKey\|deviceToken\|talkis-cloud\|proxy.talkis" src` — исправить по одному (`onboarding.ts`, `historyEmbeddings.ts`, `transcriptionReconciliation.ts`, `FileTranscriptionTab.tsx`, `TranslationTab.tsx`)
- [x] 3.8 Обновить тесты, которые проверяли облачные ветки: удалить облачные кейсы, не удаляя остальные (`summarize.test.ts`, `onboarding.test.ts`, `fileTranscription.test.ts`, `dictationStreamOverlay.test.ts`, `liveTranslation.test.ts`, `transcriptionReconciliation.test.ts`)
- [x] 3.9 Отображение старых записей истории с `provider: "cloud"`/`"talkis-cloud"` — нейтральная подпись (spec «Legacy history compatibility»)
- [ ] 3.10 Проверка: `bunx tsc --noEmit && bun test`; `grep -rn "useOwnKey\|deviceToken\|talkis.ru" src` пуст

## 4. Rust: облачные вызовы

- [x] 4.1 `src-tauri/src/ai.rs`: удалить поле `device_token` (~192), `transcribe_file_chunk_via_proxy` (~1140), `transcribe_file_via_proxy_diarized` (~1191) и их вызовы (~1583-1712), строку «Разделяем говорящих в Talkis Cloud»
- [x] 4.2 `src-tauri/src/live_dictation.rs`: удалить `resolve_cloud_live_dictation_connection` и константы (~19-20, 43, 377-520) и тест (~803)
- [x] 4.3 `src-tauri/src/live_translation.rs`: удалить облачное подключение (~31-32, 60, 501-591) и тест (~882)
- [x] 4.4 `src-tauri/src/realtime.rs`: удалить `TalkisCloudRealtimeAdapter` (~380-391) и тест (~2106)
- [x] 4.5 Синхронизировать сигнатуры Tauri-команд с frontend (убрать аргументы `deviceToken` в `invoke(...)`)
- [x] 4.6 Проверка: `cargo check --manifest-path src-tauri/Cargo.toml && cargo test --manifest-path src-tauri/Cargo.toml`

## 5. Rust: STT runtime download

- [x] 5.1 `src-tauri/src/local_stt.rs`: удалить `DEFAULT_RUNTIME_MANIFEST_URL`, `runtime_manifest_url`, `platform_asset`, `RuntimeManifest`/`RuntimeAsset`, `download_runtime`, `start_downloaded_runtime` и env `TALKIS_STT_RUNTIME_MANIFEST`; запуск только встроенного sidecar'а; ошибка из спеки при отсутствии
- [ ] 5.2 Проверка: `cargo check` + ручной запуск `bun run tauri dev` → локальная диктовка работает

## 6. Deep link

- [x] 6.1 `src-tauri/src/lib.rs`: удалить регистрацию deep-link плагина (~84), обработчик `deep-link-auth` (~136-151), парсер токена (~270-272)
- [x] 6.2 `src-tauri/Cargo.toml`: удалить `tauri-plugin-deep-link`; убрать feature `deep-link` у `tauri-plugin-single-instance` (если крейт ещё не удалён)
- [x] 6.3 `tauri.conf.json`: удалить `plugins.deep-link`; `Info.plist`: удалить `CFBundleURLTypes` (~13-23); `capabilities/default.json`: удалить `deep-link:default`; `package.json`: удалить `@tauri-apps/plugin-deep-link`, `bun install`
- [x] 6.4 Проверка: `cargo check` и `bunx tsc --noEmit`

## 7. Ссылки и трей

- [x] 7.1 `src-tauri/src/tray.rs`: удалить константы `TALKIS_WEBSITE_URL`, GitHub, privacy, mailto (~29-32), пункты меню «Поддержка», «GitHub», «Приватность» и их обработчики; `AboutMetadata` без website
- [x] 7.2 Удалить из i18n-словарей все ключи про облако/подписку/баланс/вход (`grep -rni "cloud\|облак\|подпис\|баланс\|subscription" src/i18n`), которые больше не используются
- [x] 7.3 Проверка: `cargo check`, `bunx tsc --noEmit`

## 8. Allowlist и документация

- [ ] 8.1 `scripts/network-allowlist.json`: удалить секцию `pendingRemoval`; `scripts/check-network-hosts.mjs`: удалить поддержку `pendingRemoval`, обновить тест
- [ ] 8.2 `docs/architecture/processing-modes.md`: переписать под два режима (удалить столбец «Облако» из матрицы, раздел 2 — новое правило)
- [ ] 8.3 `docs/business-requirements.md`, `README.md`, `README.ru.md`: удалить описание облака, подписки, 390₽/мес
- [ ] 8.4 Проверка: `bun run check:network`, `bun test`, `openspec validate remove-talkis-cloud --strict`
