# Design

## Context

Облачный режим не является отдельным enum — он закодирован как `useOwnKey: false` + `deviceToken` в `src/lib/store.ts:258-261`. `useOwnKey` читается в 23 файлах `src/`. UI-тип `ModelMode = "cloud" | "api" | "local"` живёт в `SettingsTabs.tsx:180`. Активный режим вычисляется так (docs/architecture/processing-modes.md §2):

```
useOwnKey=false                         -> Облако
useOwnKey=true + STT endpoint localhost -> Локально
useOwnKey=true + иначе                  -> API
```

Полная карта облачного кода (из аудита):

| Область | Файлы/строки |
|---|---|
| Аккаунт/подписка | `src/lib/cloudAuth.ts` (весь), `src/components/UserPanel.tsx` (весь; рендер `SettingsApp.tsx:47,614`), `SettingsTabs.tsx:877` `CloudSubscriptionAccountCard`, `:1080-1280` баланс, `:2004-2506` auth-flow, `:2236-2239` фоновой fetch профиля, `:2321,2357` polling |
| Формат токена | `src/lib/cloudTokenFormat.ts` + тест |
| Режим | `src/lib/modelMode.ts` (`TALKIS_CLOUD_STT_MODEL`, `talkisCloudModeSettingsPatch`), `SettingsTab.tsx:399` `isCloudMode` |
| Диктовка | `transcriptionPipeline.ts:413-537` `transcribeViaProxy`; `useWidgetRecording.ts:291-294`; `dictationStreamOverlay.ts:195` `isCloudSttStreamingEnabled` |
| Файлы | `fileTranscription.ts:13,289,598,643` |
| Текст | `cloudTextProcessing.ts`; `summarize.ts:4,136,270-273` (`SummaryBackendKind` содержит `"cloud"`) |
| Realtime/перевод | `realtimeModels.ts:3`, `liveTranslation.ts:14,35-39` (`"talkis-cloud"`), Rust: `live_dictation.rs:19-20,43,377-520,803`, `live_translation.rs:31-32,60,501-591,882`, `realtime.rs:380-391,2106` |
| Rust STT proxy | `ai.rs:192` поле `device_token`, `:1140` `transcribe_file_chunk_via_proxy`, `:1191` `transcribe_file_via_proxy_diarized`, вызовы `:1583-1712`, строка UI `:1590` |
| Deep link | `Cargo.toml` `tauri-plugin-deep-link`; `lib.rs:27,84,136-151,270-272`; `tauri.conf.json` `plugins.deep-link`; `Info.plist:13-23`; `capabilities/default.json` `deep-link:default`; npm `@tauri-apps/plugin-deep-link` |
| STT runtime download | `local_stt.rs:21` URL, `:808-900` манифест/загрузка, `:1339-1350` `start_downloaded_runtime` |
| Ссылки | `tray.rs:29-32` (сайт, GitHub, privacy, mailto), `:178` about, `SettingsApp.tsx:183` |
| i18n | словари `settingsModels`(20), `widget`(22), `libMessages`(14), `settingsTabsMisc`(5), `components`(4), `settingsGeneral`(3), `settingsRest`(2), `summary`(2) — ключи с cloud/подпиской/«облак» |

## Goals / Non-Goals

**Goals:**
- Ноль кода, UI-текста и конфигурации, относящихся к облаку Talkis.
- Упрощение модели режимов до двух.
- Безопасная миграция существующих настроек.

**Non-Goals:**
- Переименование в talkee (отдельное изменение `rename-to-talkee`; здесь новые строки UI пишем нейтрально, без бренда).
- Возврат ИИ-очистки в API/локальный режим (изменение `quick-ai-cleanup-toggle`). После этого изменения автоматической очистки диктовки не будет ни в одном режиме — это ожидаемо.

## Decisions

1. **Поле `useOwnKey` удалить совсем**, а не зафиксировать в `true`. Иначе останется мёртвая ветка в 23 файлах. Режим вычисляется одной чистой функцией `resolveProcessingMode(settings): "api" | "local"` в `src/lib/modelMode.ts` (по STT endpoint). Все места, где было `settings.useOwnKey`/`!settings.useOwnKey`, переписать на эту функцию или удалить ветку.
2. **Миграция** в нормализации настроек `src/lib/store.ts` (рядом со строками 695, 1325-1360, 1619, где уже есть legacy-нормализация):
   - если в сыром объекте `useOwnKey === false` → если есть установленная локальная STT-модель (`localSttModelId`/аналог — проверить имя поля в store.ts), выставить локальный endpoint; иначе оставить endpoint пустым (режим API);
   - удалить ключи `useOwnKey`, `deviceToken` и сохранить store сразу (правило AGENTS: «save immediately on change»);
   - покрыть unit-тестами в `src/lib/store.test.ts` (или существующем тесте нормализации).
3. **`SummaryBackendKind`** → `"custom" | "local"`; `resolveSummaryBackend` теряет шаг 1 (cloud). Тип `DictationTranslationMetadata.provider` в `store.ts:158` оставить широким для чтения (`"cloud" | "custom" | "local"`), но новые записи пишут только `"custom" | "local"`; отображение `"cloud"`/`"talkis-cloud"` — нейтральная подпись.
4. **Realtime-адаптеры:** удалить `TalkisCloudRealtimeAdapter` и id `"talkis-cloud"`; если сохранённая настройка указывает на него — при нормализации сбросить на «не выбрано».
5. **Диаризация файлов:** облачная диаризация удаляется; остаётся локальная (STT + `talkis-diarize`). В API-режиме speaker mode доступен только если установлен локальный diarize-компонент — как сейчас описано в матрице возможностей.
6. **STT runtime:** удалить `download_runtime`, `runtime_manifest_url`, `platform_asset`, `RuntimeManifest`, env `TALKIS_STT_RUNTIME_MANIFEST`, `start_downloaded_runtime`; путь запуска — только встроенный sidecar (`externalBin`). Если логика `runtime_executable_path` указывает на скачанный бинарник в app data — удалить и её, а оставшийся скачанный файл при старте не трогать (или удалить best-effort с логом).
7. **Трей «О программе»:** `AboutMetadata` без `website`, `website_label`; пункты «Поддержка», «GitHub», «Приватность» удалить.

## Risks / Trade-offs

- Большой diff в `SettingsTabs.tsx` (5500+ строк). Снизить риск: сначала удалить компоненты целиком, затем чинить ошибки `tsc` по одной; не рефакторить соседний код.
- Пользователи облака потеряют автоматическую очистку до `quick-ai-cleanup-toggle`.
- Нельзя проверить облачные сценарии вручную после удаления — полагаемся на tsc/тесты и grep.
