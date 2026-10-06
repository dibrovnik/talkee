# Tasks

## 1. Предусловия и границы реализации

- [x] 1.1 Проверить зависимость в `proposal.md` и main spec `openspec/specs/text-cleanup/spec.md`: `fix-developer-dictation-cleanup` архивирован, `Unavailable cleanup is visible` присутствует; до этого apply не начинать. Проверка: `openspec list --json` и `openspec validate add-personal-dictation-vocabulary --strict` без сообщения о недостающем requirement.
- [x] 1.2 Сверить текущие `docs/audio-pipeline-principles.md`, `docs/architecture/processing-modes.md`, `docs/privacy.md`, `rules/style.rule.md` с дизайном; подготовить ветку `change/add-personal-dictation-vocabulary` по `openspec/config.yaml`, сохранив несвязанные изменения. Проверка: `git status --short`, `git branch --show-current`; исходная dirty-работа не потеряна.
- [x] 1.3 Проверить исходное состояние командами `bunx tsc --noEmit` и `cargo check --manifest-path src-tauri/Cargo.toml`; существующие ошибки зафиксировать отдельно от изменений фичи, не маскировать ими её acceptance.

## 2. Договоры, локальное хранение и миграция

- [x] 2.1 Добавить модели v1 в `src/lib/vocabulary.ts` и `src-tauri/src/vocabulary/model.rs`: terms/variants/scopes/provenance/evidence/suggestions/dismissals/coverage/config/job, лимиты и revision/epoch. Проверка: контрактный fixture даёт одинаковый JS/Rust round trip; defaults application/schedule off.
- [x] 2.2 В `src-tauri/src/vocabulary/model.rs` реализовать проверку полей, Unicode-ключей, scope/language коллизий, каскадов, лимитов и case-only explicit rules. Проверка: Rust vocabulary tests отвергают global/domain collision, auto-language collision, управляющие символы, URL alias, превышение лимитов и сохраняют допустимый caseSensitive вариант.
- [x] 2.3 Реализовать root key reader и preserve-on-corruption в `src-tauri/src/vocabulary/store.rs`; добавить только пустой `vocabularyCorrectionHotkey` к default/normalize settings в `src/lib/store.ts`. Проверка: старый store загружается без массовой перезаписи; corrupt/future-version ключ сохраняется, обычная диктовка доступна.
- [x] 2.4 В `src-tauri/src/vocabulary/store.rs`, `mod.rs`, `src-tauri/src/lib.rs` добавить CAS-мутаторы manual CRUD/config, save rollback и update event; в `src/lib/vocabulary.ts` — typed IPC и warm snapshot cache. Проверка: два конкурентных expectedRevision не теряют данные, injected save failure не вызывает successful event и оставляет прежний снимок.
- [x] 2.5 Описать key ownership, revision и corruption/reset договор в `docs/architecture/overview.md`, `docs/privacy.md`; добавить необходимые store/interop tests рядом с модулем. Проверка: restart round trip, unknown version и сохранение несвязанных настроек покрыты runnable checks.
- [x] 2.6 Выполнить `bun test src/lib/vocabulary.test.ts`, `cargo test --manifest-path src-tauri/Cargo.toml -p talkee --lib vocabulary`, `bunx tsc --noEmit`; группа считается завершённой только после успешных результатов.

## 3. Нормализатор и безопасные снимки

- [ ] 3.1 Реализовать в `src/lib/vocabularyNormalization.ts` compiled index активных global/выбранной области правил, case/language/context фильтры и immutable snapshot. Проверка: изменение store после capture не меняет результат текущего снимка.
- [ ] 3.2 Добавить protected spans, Unicode whole-word/phrase matching, longest-leftmost и single-pass сборку в том же модуле. Проверка: fixtures «пи ай эм», «прод/продажа/продукт», emoji/диакритика, overlap, code/URL/email/path/PIMService не меняют незатронутый текст.
- [ ] 3.3 Добавить text/match/time аварийные пределы и безопасный результат до нормализации в `vocabularyNormalization.ts`; вернуть counts/rule IDs/status без слов в логах. Проверка: injected clock/large input вызывает целый fallback, без частичных замен.
- [ ] 3.4 Добавить meaningful table tests и benchmark mode в `src/lib/vocabularyNormalization.test.ts`; документировать порядок и scope в `docs/audio-pipeline-principles.md`. Проверка: идемпотентность, контекст в одном предложении, отсутствие каскада и выключенный словарь.
- [ ] 3.5 Выполнить `bun test src/lib/vocabularyNormalization.test.ts` и `bunx tsc --noEmit`; отдельный реальный p95 замер остаётся в группе 13.

## 4. Раздел словаря и ручное управление

- [ ] 4.1 Добавить вкладку `vocabulary` в `src/windows/settings/settingsNavigation.ts`, `SettingsApp.tsx`, `src/lib/hotkeyEvents.ts`, `src-tauri/src/commands/settings_window.rs`; русские строки — `src/lib/i18n/dict/vocabulary.ts`, `settingsRest.ts`, `messages.ts`. Проверка: opening-by-tab не возвращает main, production build содержит раздел.
- [ ] 4.2 Создать `src/windows/settings/tabs/vocabulary/VocabularyTab.tsx`: empty state, три представления, application toggle, active domain, поиск/категории и состояние capability. Проверка: открытие раздела не пишет starter и не запускает LLM/network.
- [ ] 4.3 Создать `VocabularyEditor.tsx` с CRUD canonical и раздельным утверждением variants/context/case, deactivate/delete; переиспользовать `src/ui`. Проверка: term-only PIM не заменяет «пин», form error сохраняет введённое, deletion не переписывает историю.
- [ ] 4.4 Подключить cross-window updates/CAS errors к этим компонентам и `src/lib/vocabulary.ts`. Проверка: параллельное редактирование не перезаписывает свежие правила, устаревший preview требует нового подтверждения.
- [ ] 4.5 В `docs/testing/manual-style-test-plan.md` добавить ручные сценарии empty/manual/edit/off/domain, keyboard/VoiceOver/light/dark/возврат фокуса. Проверка: выполнить их в macOS-приложении; сохранить только результаты без пользовательского текста.
- [ ] 4.6 Выполнить `bun test src/lib/vocabulary.test.ts`, `bunx tsc --noEmit`, `bun run build`; проверить production-вкладку через `bun run tauri dev` и встроенный браузер/нативное окно.

## 5. Starter, импорт и экспорт

- [ ] 5.1 Добавить opt-in starter данные/preview в `src/lib/vocabulary.ts`, `VocabularyTab.tsx`, `VocabularyEditor.tsx`: PIM/Dev/Prod, отдельные aliases и контексты. Проверка: открытие/отмена не меняют store, repeated starter не перезаписывает ручной PIM, enabled не предвыбран.
- [ ] 5.2 Реализовать переносимый формат/validation/merge preview в `src/lib/vocabulary.ts` и `src-tauri/src/vocabulary/model.rs`; файловые действия через существующий dialog и reviewed save в `store.rs`. Проверка: version/unknown fields/1 МиБ/конфликты отвергаются до мутации.
- [ ] 5.3 Подключить выбор строк и atomic import к `VocabularyTab.tsx`, `store.rs`; экспортировать только portable terms/rules. Проверка: selected import, idempotent reimport и export→empty-install import дают эквивалентные правила без включения расписания/API/application.
- [ ] 5.4 Добавить import/export privacy/round-trip tests в `src/lib/vocabulary.test.ts` и Rust vocabulary tests; описать формат и первый запуск в `docs/testing/manual-style-test-plan.md`, переносимость — в `docs/privacy.md`. Проверка: экспорт не содержит ни одной evidence/consent/history/key field.
- [ ] 5.5 Выполнить `bun test src/lib/vocabulary.test.ts`, `cargo test --manifest-path src-tauri/Cargo.toml -p talkee --lib vocabulary`, `bunx tsc --noEmit`; вручную выбрать, импортировать и экспортировать локальный файл.

## 6. Общий pipeline и история происхождения

- [ ] 6.1 Передать capture snapshot через `src/windows/widget/hooks/useWidgetRecording.ts`, `services/recordingRuntime.ts`, `dictationStreamOverlay.ts` и параметры `transcriptionPipeline.ts`. Проверка: record-start snapshot используется batch/stream/reconciliation, retry захватывает новую версию.
- [ ] 6.2 В `transcriptionPipeline.ts` добавить один final normalization после cleanup перед translation/history/paste, включая fallback/retry и final overlay. Проверка: одинаковый raw+snapshot даёт одинаковый итог во всех путях, cleanup off не вызывает LLM.
- [ ] 6.3 Добавить optional personalization/preVocabularyText/cleanupApplied к `src/lib/store.ts`, сохранить normalize/compact backward compatibility. Проверка: raw остаётся настоящим исходником после словарной замены, старые compacted записи открываются.
- [ ] 6.4 В `src/windows/settings/tabs/MainTab.tsx` показать исходник/итог/происхождение и текст до словаря по необходимости; fallback notices собрать в общем pipeline. Проверка: различаются cleanup fail без замен и fail с PIM-заменой, copy-original не копирует нормализованный итог.
- [ ] 6.5 Расширить `src/windows/widget/services/transcriptionPipeline.test.ts`, добавить `src/lib/store.vocabularyHistory.test.ts` и обновить `docs/audio-pipeline-principles.md`. Проверка: snapshot race, streaming-final, batch fallback, retry, translation-source и изоляция file/call/liveTranslation покрыты, auto-loop evidence отсутствует.
- [ ] 6.6 Выполнить `bun test src/windows/widget/services/transcriptionPipeline.test.ts src/lib/store.vocabularyHistory.test.ts`, `bunx tsc --noEmit`; вручную проверить dictation cleanup off/on и перевод до/после нормализованного источника.

## 7. STT-подсказки и один существующий запрос очистки

- [ ] 7.1 В `src/lib/vocabulary.ts`, `src-tauri/src/ai.rs` добавить capability whitelist и deterministic compact canonical hints с byte/count бюджетами; параметры — optional для backward compatibility. Проверка: inactive/неутверждённые слова не попадают в payload, неизвестный adapter и Nemotron/GigaAM не получают hints.
- [ ] 7.2 В `src-tauri/src/bin/talkee-stt.rs` связать prompt с `WhisperRunOptions.initial_prompt`; no-speech/no-context guardrails сохранить. Проверка: run-options fixture содержит PIM в actual Whisper options, Nemotron options его не используют; тест тишины не начинает галлюцинировать.
- [ ] 7.3 В `src-tauri/src/ai.rs` передавать словарь Groq/OpenAI batch через документированный `prompt`, исправить GPT-4o ветку `instructions`. Проверка: multipart fixture содержит верные поля/модель/язык/format, без слов в логах.
- [ ] 7.4 Передать optional hints через `src-tauri/src/live_dictation.rs`, `realtime.rs`, `src/windows/widget/services/dictationStreamOverlay.ts`; применить только поддерживаемой OpenAI transcription session. Проверка: session payload/reconciliation используют один snapshot, realtime translation payload не меняется, нет полного STT ради словаря.
- [ ] 7.5 В `src/lib/textCleanup.ts`, `summarize.ts` добавить bounded glossary data block к одному существующему preset/custom request. Проверка: сохранённый custom prompt не переписывается, стиль/cleanup toggle не меняется, число запросов остаётся один.
- [ ] 7.6 Добавить adapter payload/guard/parity tests, обновить `docs/local-stt-runtime.md` и `docs/architecture/processing-modes.md` таблицей фактических возможностей. Проверка: UI честно показывает normalizer-only для Nemotron и included hint count при переполнении.
- [ ] 7.7 Выполнить `cargo test --manifest-path src-tauri/Cargo.toml -p talkee --lib`, `cargo test --manifest-path src-tauri/Cargo.toml --bin talkee-stt`, `bun test src/lib/textCleanup.test.ts src/lib/summarize.test.ts src/windows/widget/services/transcriptionPipeline.test.ts`, `bunx tsc --noEmit`.

## 8. Подтверждённые исправления и горячая клавиша

- [ ] 8.1 Добавить `vocabularyCorrection` target в `src/lib/hotkeyEvents.ts`, `src/windows/widget/services/hotkeyTransaction.ts`, `hooks/useWidgetHotkey.ts`; reuse validate/normalize/register/rollback. Проверка: конфликты со всеми четырьмя существующими hotkeys и rollback registration error, пустой default не регистрируется.
- [ ] 8.2 Создать `src/windows/widget/services/vocabularyCorrection.ts`: чтение `copy_selected_text` до focus, ephemeral pending capture и предложение recent successful paste ≤10 мин. Проверка: порядок capture-before-show, отсутствие выделения/permissions и отмена не создают durable evidence.
- [ ] 8.3 Добавить `CorrectionDialog.tsx` и действие истории в `MainTab.tsx`: выбор исходной записи/ошибочного span/правильной пары, ручное уточнение rewrites. Проверка: чужое выделение не связывается молча с последней записью.
- [ ] 8.4 В `src-tauri/src/vocabulary/store.rs`, `src/lib/vocabulary.ts` добавить atomic human-evidence+ready suggestion и separately-confirmed save-and-rule. Проверка: один human example создаёт предложение без LLM, простой save не включает alias.
- [ ] 8.5 Добавить tests к hotkey transaction/capture и обновить `docs/testing/manual-style-test-plan.md`, `docs/privacy.md`. Проверка: внешнее исправление PIM, нет наблюдения после обычной правки редактора, clipboard restoration, selection cancellation.
- [ ] 8.6 Выполнить `bun test src/windows/widget/hooks/useWidgetHotkey.test.ts src/windows/widget/services/hotkeyTransaction.test.ts src/windows/widget/services/vocabularyCorrection.test.ts src/lib/vocabulary.test.ts`, `bunx tsc --noEmit`; пройти capture flow в реальном редакторе.

## 9. Адресная отмена текстового анализа

- [ ] 9.1 В `src/lib/summarize.ts` добавить operation `vocabulary-analysis`, request ID, AbortSignal→native cancel; в `src-tauri/src/ai.rs`, `ai/text_requests.rs`, `lib.rs` — registry/deadline/select и thin cancel command. Проверка: timeout/abort прекращает HTTP future, late result не возвращается как успех, handles очищаются.
- [ ] 9.2 Для analysis operation запретить hidden retries/runtime restart в existing text runner; сохранённый cleanup 8/12 с договор оставить. Проверка: loopback timeout/transport failure даёт ровно один completion request.
- [ ] 9.3 Разделить acceptor и single model-owner worker в `src-tauri/sidecars/talkee-llm/src/main.rs`, выделить `request_control.rs` для bounded queue/registry/AtomicBool. Проверка: health/cancel отвечает во время inference, queue overflow — busy, backend/model инициализируются в worker без model cloning.
- [ ] 9.4 Добавить managed-only request_id, cancel route и checks перед/после prefill chunks/между токенами в этих файлах. Проверка: queued/active cancellation idempotent, ответ отмены не partial success, повторная completion работает на той же загруженной модели.
- [ ] 9.5 В `src-tauri/src/llm_runtime.rs` валидировать health contract/context; capability для custom local backend отразить в `src/lib/vocabulary.ts`. Проверка: старый sidecar/custom без cancel не допускает periodic, manual предупреждает, произвольный API не получает guessed cancel.
- [ ] 9.6 Добавить loopback cancellation tests и sidecar request-control tests; описать operation/capability в `docs/architecture/overview.md`, `docs/architecture/processing-modes.md`. Проверка: закрытие клиента/ошибка не оставляет lease/registry; отсутствие runtime stop подтверждается проверкой команды.
- [ ] 9.7 Выполнить `bun test src/lib/summarize.test.ts`, `cargo test --manifest-path src-tauri/Cargo.toml -p talkee --lib`, `cargo test --manifest-path src-tauri/Cargo.toml -p talkee-llm`, `cargo check --manifest-path src-tauri/Cargo.toml --workspace`; отдельной реальной managed-LLM сессией подтвердить cancel во время prefill/generation и следующий cleanup без restart.

## 10. Извлечение предложений и доказательств

- [ ] 10.1 Создать `src/lib/vocabularyAnalysis.ts`: eligibility/normalized legacy history, raw/pre-vocabulary origins и full/new/resume source plan. Проверка: file/call/liveTranslation/translated/empty/errors исключены, compact raw восстановлен, own rules не повышают human evidence.
- [ ] 10.2 В этом модуле реализовать UTF-8 bounded chunking/overlap/fingerprints/ranges и API/local prompt budgets. Проверка: длинная последняя запись/кириллица/JSON escaping не теряют хвост, unchanged coverage не отправляется снова, changed fingerprint reprocess.
- [ ] 10.3 Реализовать dedicated structured extraction instruction и strict schema/citation validation в `vocabularyAnalysis.ts`. Проверка: unknown source/false quote/prompt injection/oversize/truncated/non-JSON не создают доказанного правила и не коммитят ошибочный пакет.
- [ ] 10.4 В `vocabularyAnalysis.ts`, `src-tauri/src/vocabulary/store.rs` реализовать cross-batch aggregation, unique source counts, collecting→ready, human-first ranking, approved/rejected suppression. Проверка: 3 разных записи дают ready, 10 повторов в одной — нет; новый model source не возрождает rejected pair.
- [ ] 10.5 Добавить atomic checked-batch commit вместе с coverage/lease/generation validation в `store.rs`. Проверка: concurrency retry только локальный, restart до commit повторяет пакет без дублей, deleted/changed sources и stale epoch запрещают commit.
- [ ] 10.6 Добавить `src/lib/vocabularyAnalysis.test.ts` и Rust aggregation/commit checks, описать origin/threshold/checkpoint в `docs/architecture/overview.md`. Проверка: human без backend, legacy diff не human, limit overflow не отмечает потерянные предложения как обработанные.
- [ ] 10.7 Выполнить `bun test src/lib/vocabularyAnalysis.test.ts src/lib/vocabulary.test.ts`, `cargo test --manifest-path src-tauri/Cargo.toml -p talkee --lib vocabulary`, `bunx tsc --noEmit`.

## 11. Coordinator, API-согласия и periodic analysis

- [ ] 11.1 Создать Widget-owned `src/windows/widget/services/vocabularyAnalysisCoordinator.ts`, подключить `hooks/useWidgetController.ts`; request/cancel/progress events и single Rust lease. Проверка: закрытые Settings не обрывают job, два запроса из разных окон дают один проход.
- [ ] 11.2 Подключить existing backend resolver и consent fingerprint checks в coordinator/`src/lib/vocabulary.ts`; approval/revoke state — `src-tauri/src/vocabulary/store.rs`. Проверка: API без отдельного manual/periodic согласия получает ноль запросов, смена endpoint/model/revoke отменяет job до commit.
- [ ] 11.3 Реализовать bounded sequential requests/checkpoint/progress/cancel/resume и paused-after-restart в coordinator. Проверка: automatic ≤3, manual ≤20, request 30/60 с, run 3/15 мин, late response не меняет coverage; неизвестный сетевой исход не повторяется.
- [ ] 11.4 Реализовать one-shot daily/weekly timer, due+10 new либо backlog, 30 с idle, startup due-check и off/no-immediate-restart. Проверка: fake-clock schedule tests покрывают закрытие/открытие, небольшой объём, остаток, ручную отмену и следующий период.
- [ ] 11.5 Подключить foreground priority/preemption ко всем processing states в `useWidgetController.ts`, `useWidgetRecording.ts`, coordinator. Проверка: диктовка/другая foreground LLM останавливают анализ, capture не ждёт cancel ack, shared model не остановлена.
- [ ] 11.6 Создать `VocabularyAnalysisPanel.tsx`, подключить к `VocabularyTab.tsx`: full/new/resume, backend/capability/consent, limits/progress/errors, schedule/revoke/stop. Проверка: нет backend → manual terms работают; periodic не открывает окно и не создаёт уведомления каждого пакета.
- [ ] 11.7 Добавить `vocabularyAnalysisCoordinator.test.ts`, обновить `docs/privacy.md`, `docs/testing/manual-style-test-plan.md` для отдельных разрешений и priority. Проверка: configured DeepSeek при local Nemotron использует отдельный consent, endpoint change/timeout/cancel соблюдают договоры.
- [ ] 11.8 Выполнить `bun test src/windows/widget/services/vocabularyAnalysisCoordinator.test.ts src/lib/vocabularyAnalysis.test.ts src/lib/summarize.test.ts`, `bunx tsc --noEmit`; в реальном managed local runtime начать диктовку во время analysis и подтвердить рабочую последующую очистку.

## 12. Review, retention и окончательное управление данными

- [ ] 12.1 Создать `VocabularySuggestions.tsx`: origin/count/≤3 quotes, collecting/ready filters, edit canonical/domain, отдельные aliases/context, accept-term-only/reject/restore. Проверка: одна гипотеза не выглядит готовой заменой, выбранная категория не меняет active domain.
- [ ] 12.2 Реализовать idempotent atomic approve/reject/restore в `src-tauri/src/vocabulary/store.rs`, `src/lib/vocabulary.ts`. Проверка: double click создаёт один term/rule, partial alias approval не включает остальные, новое human evidence явно возвращает rejected pair на review.
- [ ] 12.3 В `src/lib/store.ts` подключить source invalidation ко всем delete/clear/pruning/retention путям, в `store.rs` — удаление evidence/quotes/coverage и startup reconciliation. Проверка: delete во время request не восстанавливает цитату, aggregate count падает, approved rules остаются с отсоединёнными source refs.
- [ ] 12.4 В `VocabularyAnalysisPanel.tsx`, `store.rs` реализовать separate clear-learning/full-reset, epoch cancellation и high-water mark для старой истории. Проверка: clear-learning оставляет rules и требует manual full для старых записей; full-reset удаляет consent и выключает application/schedule, history/stats остаются.
- [ ] 12.5 Проверить logging в `vocabularyAnalysis.ts`, coordinator, `vocabulary/mod.rs`, `ai.rs` и обновить `docs/privacy.md`. Проверка: тестовый уникальный термин/цитата/API-key не встречаются в диагностике; transfer/export/event payload содержит только предусмотренные данные.
- [ ] 12.6 Дополнить `src/lib/vocabulary.test.ts`, `vocabularyAnalysis.test.ts`, `store.vocabularyHistory.test.ts`, `src/windows/widget/services/vocabularyAnalysisCoordinator.test.ts` и `docs/testing/manual-style-test-plan.md` сценариями удаления/сбоя/reset. Проверка: лимиты terms/candidates/evidence/dismissals, corruption recovery и data-retention race покрыты runnable checks.
- [ ] 12.7 Выполнить `bun test src/lib/vocabulary.test.ts src/lib/vocabularyAnalysis.test.ts src/lib/store.vocabularyHistory.test.ts src/windows/widget/services/vocabularyAnalysisCoordinator.test.ts`, `cargo test --manifest-path src-tauri/Cargo.toml -p talkee --lib vocabulary`, `bunx tsc --noEmit`; вручную restart после review/delete/reset.

## 13. Инструмент оценки и доказательство точности

- [ ] 13.1 Создать `scripts/evaluate-vocabulary.mjs`, `scripts/evaluate-vocabulary.test.mjs`, команду `evaluate:vocabulary` в `package.json`: manifest/dictionary/STT JSONL, проверка audio/config hashes, S/N/H term error/false change/protected spans и safe report. Проверка: fixture с известными ошибками даёт ожидаемые абсолютные показатели, несовпадающее audio и cleanup-on результаты отвергаются.
- [ ] 13.2 Добавить benchmark режим evaluator с warm 1000-term snapshot/2000-symbol text/≥50 iterations и p50/p95; переиспользовать настоящий `vocabularyNormalization.ts`. Проверка: `bun run evaluate:vocabulary --benchmark` выводит фактические timing и размер без внешнего endpoint.
- [ ] 13.3 В `docs/testing/manual-style-test-plan.md` записать точные команды/JSONL формат, фиксирование словаря до held-out записи, способ реального STT capture через existing native путь, критерии и ограничения. Проверка: команды `bun run evaluate:vocabulary --help` соответствуют документации; временный QA driver, если нужен, gated DEV и не попадает в production UI.
- [ ] 13.4 Собрать отдельный реальный пользовательский набор вне tracked repo: ≥50 новых фраз, ≥30 target occurrences, ≥20 controls. На одинаковом audio получить baseline S и hints H для поддерживаемых adapters, cleanup off; N вычислить из S. Проверка: hashes совпадают, датасет не использован для подбора правил, нет TTS/fixtures вместо реального baseline.
- [ ] 13.5 Выполнить `bun run evaluate:vocabulary --manifest .tmp-verify/vocabulary/manifest.json --dictionary .tmp-verify/vocabulary/dictionary.json --transcripts .tmp-verify/vocabulary/stt.jsonl --output .tmp-verify/vocabulary/report.json`. Проверка: baseline ≥10 ошибок, относительное снижение ≥30%, 0 false changes в controls, protected identifiers сохранены; иначе расширить набор/исправить правила и получить новый независимый набор, не отмечать acceptance выполненной.
- [ ] 13.6 Выполнить `bun test scripts/evaluate-vocabulary.test.mjs` и `bun run evaluate:vocabulary --benchmark`; на Apple M5 p95 ≤10 мс. В acceptance записи `docs/testing/manual-style-test-plan.md` сохранить только агрегированные метрики/конфигурацию, без пользовательского audio/text/секретов.

## 14. Сквозная проверка завершённой фичи

- [ ] 14.1 По `docs/testing/manual-style-test-plan.md` выполнить весь production flow: empty → starter/manual/import → внешнее исправление → отдельное утверждение → следующая диктовка без cleanup → full/new/periodic analysis → cancel/revoke/delete → restart/export/reset. Проверка: реальные macOS Settings/widget, light/dark/keyboard/VoiceOver; PIM/Dev/Prod и защищённые идентификаторы соответствуют specs.
- [ ] 14.2 Проверить регрессии обычного dictation toggle/hold, отдельной cleanup hotkey, stream/reconciliation/retry и независимых file/call/liveTranslation путей в `transcriptionPipeline.test.ts`, `useWidgetHotkey.test.ts` и ручном плане. Проверка: `bun test src/windows/widget/services/transcriptionPipeline.test.ts src/windows/widget/hooks/useWidgetHotkey.test.ts`.
- [ ] 14.3 Сверить `proposal.md`, `design.md`, все delta-specs и `tasks.md` с фактической реализацией/документами; незавершённую реальную accuracy acceptance не скрывать за успешными unit tests. Проверка: `openspec validate add-personal-dictation-vocabulary --strict`, `bun run build`.
- [ ] 14.4 Выполнить заключительный `bun run gate`; отметить задачу только после всех успешных проверок. Архивирование change/merge выполняются отдельным последующим действием.
