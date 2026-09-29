# Proposal

## Why

talkee — независимый форк без облачной инфраструктуры. Сейчас приложение завязано на сервисы Talkis: вход по device-code, подписка и баланс (`talkis.ru`), облачный режим распознавания и обработки текста (`proxy.talkis.ru`), облачные realtime-credentials, deep link `talkis://`, скачивание STT runtime по манифесту с `talkis.ru`, ссылки в трее на сайт/GitHub/почту автора. Эти сервисы нам не принадлежат, и любое обращение к ним — утечка данных и точка отказа.

## What Changes

- **BREAKING** Удалить режим «Облако». Остаются два режима: «API» (свои ключи/endpoint'ы) и «Локально» (управляемые sidecar'ы на localhost).
- **BREAKING** Удалить аккаунт, подписку, баланс, device-code вход и всю связанную UI: `src/lib/cloudAuth.ts`, `src/lib/cloudTextProcessing.ts`, `src/lib/cloudTokenFormat.ts` (+тест), `src/components/UserPanel.tsx`, `CloudSubscriptionAccountCard` и блоки баланса/авторизации в `SettingsTabs.tsx`.
- Удалить облачные ветки в распознавании диктовки, файлов, живого перевода, потоковой диктовки и в Rust (`ai.rs` proxy-функции, `live_dictation.rs`/`live_translation.rs` cloud resolve, `TalkisCloudRealtimeAdapter` в `realtime.rs`).
- **BREAKING** Удалить deep link (`tauri-plugin-deep-link`, схема `talkis://`, `CFBundleURLTypes` в `Info.plist`, право `deep-link:default`) — он использовался только для входа в облако.
- Удалить загрузку STT runtime по манифесту `talkis.ru`: управляемый STT runtime берётся только из встроенного sidecar'а.
- Удалить из трея и настроек ссылки на talkis.ru, GitHub автора, privacy-страницу и почту поддержки; окно «О программе» без внешних ссылок.
- Миграция настроек: пользователи с `useOwnKey=false` переводятся в режим API/Локально без потери остальных настроек, `deviceToken` стирается из хранилища.
- Удалить секцию `pendingRemoval` из `scripts/network-allowlist.json` (добавлена в `remove-telemetry`).

Зависит от: `remove-telemetry`.

## Capabilities

### New Capabilities
- `processing-modes`: какие режимы обработки существуют, как определяется активный режим, поведение при отсутствии конфигурации, миграция со старого облачного режима.

### Modified Capabilities
- `network-privacy`: allowlist больше не содержит хостов Talkis (изменение требования о проверке хостов).

## Impact

- Frontend (≈25 файлов): `src/lib/{cloudAuth,cloudTextProcessing,cloudTokenFormat,modelMode,summarize,fileTranscription,realtimeModels,store,onboarding,historyEmbeddings}.ts`, `src/components/UserPanel.tsx`, `src/windows/settings/{SettingsApp.tsx,tabs/SettingsTabs.tsx,tabs/SettingsTab.tsx,tabs/FileTranscriptionTab.tsx,tabs/TranslationTab.tsx}`, `src/windows/widget/{hooks/useWidgetRecording.ts,services/transcriptionPipeline.ts,services/liveTranslation.ts,services/dictationStreamOverlay.ts,services/transcriptionReconciliation.ts}` и их тесты, i18n-словари.
- Rust: `src-tauri/src/{ai.rs,live_dictation.rs,live_translation.rs,realtime.rs,local_stt.rs,lib.rs,tray.rs}`, `Cargo.toml`.
- Конфиг: `tauri.conf.json`, `Info.plist`, `capabilities/default.json`, `package.json`.
- Документация: `docs/architecture/processing-modes.md`, `docs/business-requirements.md`, README.
- Пользователи облака после обновления должны настроить API-ключ или скачать локальную модель.
