# Design

## Context

Аудит (29.09.2026) по `src/`, `src-tauri/`, `site/`, html: аналитических SDK, `sendBeacon`, `track(`, crash-репортинга нет. Логи пишутся только локально (`src-tauri/src/logger.rs`, `src/lib/logger.ts`). Статистика использования хранится локально (`src/lib/stats.ts`).

Найдены неявные сетевые обращения:

| Источник | Где | Что делаем в этом изменении |
|---|---|---|
| Google Fonts `@import` | `src/index.css:1` | удалить, системный шрифт |
| Автопроверка обновлений (GitHub `SerTimBerrners-Lee/talkis`) | `src/lib/updater.ts`, `Widget.tsx:62,828`, `SettingsApp.tsx:189-294,385,470-474`, `tauri.conf.json:71` | удалить updater полностью |
| Запрос облачного профиля talkis.ru | `SettingsTabs.tsx:2236-2239` | вне скоупа → `remove-talkis-cloud` |
| Манифест STT runtime talkis.ru | `src-tauri/src/local_stt.rs:21,809,849` | вне скоупа → `remove-talkis-cloud` |
| Tailwind CDN / Google Fonts на лендинге | `site/index.html:7,9` | вне скоупа → `site/` удаляется в `repo-cleanup-for-agents` |

## Goals / Non-Goals

**Goals:**
- Ноль фоновых запросов при старте и в простое.
- Автоматическая защита от регрессии (скрипт allowlist).

**Non-Goals:**
- Удаление облака Talkis (отдельное изменение `remove-talkis-cloud`).
- Смена шрифтов/дизайна (отдельное изменение `native-macos-ui`; здесь только замена на системный стек).
- Хранение ключей в Keychain (не просили; можно завести отдельно).

## Decisions

1. **Updater удаляем, а не перенаправляем.** Endpoint указывает на чужой GitHub, собственного канала релизов нет, приложение собирается локально под один Mac. Перенаправление потребовало бы ключей подписи и CI-публикации — избыточно. Если позже понадобится, добавить отдельным изменением с явной кнопкой «Проверить обновления» (без автопроверки).
2. **Шрифты:** `font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif;` для `--font`/`--font-main`, `-apple-system, "SF Pro Display", ...` для `--font-accent`/`--font-brand`. Без локального бандла Inter/Manrope: следующий шаг (`native-macos-ui`) всё равно уходит на SF.
3. **Скрипт `scripts/check-network-hosts.mjs`:**
   - Ищет regex `https?://[^\s"'`)<>]+` в `.ts/.tsx/.js/.mjs/.rs/.css/.html/.json` внутри путей из спеки; исключает `*.test.*`, `node_modules`, `target`.
   - Извлекает hostname через `new URL()`.
   - Allowlist — `scripts/network-allowlist.json`: `{ "hosts": [{ "host": "api.openai.com", "reason": "OpenAI provider preset" }, ...], "hostSuffixes": [...] }`. Всегда разрешены `localhost`, `127.0.0.1`, `0.0.0.0`.
   - Начальный allowlist собрать из текущих провайдеров: `api.openai.com`, `generativelanguage.googleapis.com`, Deepgram, Mistral, ElevenLabs, `streaming.assemblyai.com`, xAI, `huggingface.co` (+ CDN, куда редиректит HF, если есть в коде), `github.com` (sherpa-onnx и python-build-standalone для диаризации). Хосты `talkis.ru`, `proxy.talkis.ru` временно добавить в секцию `"pendingRemoval"` с пометкой `remove-talkis-cloud`: скрипт печатает по ним предупреждение, но не падает. Изменение `remove-talkis-cloud` удаляет эту секцию.
   - Вывод: `file:line host`, exit 1 при нарушениях.
4. **`tauri-plugin-process`:** перед удалением проверить `grep -rn "plugin-process\|relaunch\|process:allow" src src-tauri`. Если используется только updater — удалить крейт, npm-пакет и право `process:allow-restart`.

## Risks / Trade-offs

- Нет уведомлений об обновлениях → приемлемо для приложения, которое собирается локально.
- Визуально шрифт поменяется до `native-macos-ui` → допустимо, это промежуточное состояние.
