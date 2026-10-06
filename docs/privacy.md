# Сетевая политика Talkee

Статус: актуально после изменения `remove-telemetry`.

Этот документ описывает, когда приложение имеет право выходить в сеть, куда именно оно может обращаться и как это правило проверяется автоматически. Он является источником истины для ревью сетевых изменений.

## 1. Главный принцип

Приложение не выполняет фоновых сетевых запросов. Любой исходящий запрос либо инициирован явным действием пользователя, либо адресован endpoint'у, который пользователь настроил сам.

Это означает отсутствие:

- проверок и установки обновлений;
- загрузки шрифтов, стилей или изображений с удалённых CDN;
- аналитики, crash-репортов, «пингов» и запросов профиля;
- любых других «звонков домой».

Исключение — соединения с `127.0.0.1` / `localhost` для управляемых локальных sidecar-процессов (STT, LLM, diarization). Они не покидают компьютер пользователя.

## 2. Допустимые случаи выхода в сеть

Приложение обращается в сеть только в трёх случаях:

1. **Настроенный endpoint.** Запросы к endpoint'ам STT / LLM / Realtime, которые пользователь настроил вручную или выбрал из списка провайдеров (например, OpenAI, Deepgram, Mistral).
2. **Загрузка модели или runtime.** Пользователь явно нажал кнопку загрузки локальной модели или runtime-компонента; приложение скачивает файл только с URL, указанного в каталоге моделей.
3. **Явно открытая ссылка.** Пользователь нажал ссылку, которая открывается во внешнем браузере (GitHub, поддержка, страница конфиденциальности).

Во всех остальных ситуациях сетевой запрос считается нарушением политики.

## 3. Провайдеры и хосты

Разрешённые хосты перечислены в `scripts/network-allowlist.json`. Каждая запись снабжена причиной.

| Хост | Назначение |
| --- | --- |
| `api.openai.com` | Пресет провайдера OpenAI (STT / LLM / embeddings) |
| `generativelanguage.googleapis.com` | Пресет провайдера Google Gemini |
| `api.deepgram.com` | Пресет провайдера Deepgram |
| `api.mistral.ai` | Пресет провайдера Mistral |
| `api.elevenlabs.io` | Пресет провайдера ElevenLabs |
| `streaming.assemblyai.com` | Пресет потокового провайдера AssemblyAI |
| `api.x.ai` | Пресет провайдера xAI |
| `huggingface.co` | Загрузка локальных моделей по явному действию пользователя |
| `github.com` | Загрузка runtime-компонентов (python-build-standalone, sherpa-onnx) и ссылки в браузере |
| `api.example.com` | Зарезервированный примерный домен (RFC 2606) в тексте-подсказке поля endpoint |

Всегда разрешены независимо от allowlist: `localhost`, `127.0.0.1`, `0.0.0.0`, `::1`.

Секция `pendingRemoval` содержит хосты, которые ещё присутствуют в коде, но должны исчезнуть вместе с изменением `remove-talkee-cloud`:

- `talkee.ru`;
- `proxy.talkee.ru`.

Проверка печатает по ним предупреждение, но не завершается ошибкой. Изменение `remove-talkee-cloud` удаляет эту секцию.

## 4. Автоматическая проверка

Репозиторий содержит скрипт `scripts/check-network-hosts.mjs`, который сканирует исходники приложения:

- `src/`;
- `src-tauri/src/`;
- `src-tauri/sidecars/`;
- `index.html`;
- `src/index.css`.

Скрипт находит абсолютные URL, извлекает hostname и сравнивает его с allowlist. Тестовые файлы (`*.test.*`, `*.spec.*`), `node_modules`, `target` и `dist` исключены.

Запуск:

```bash
bun run check:network
```

- код выхода `0` — в коде только разрешённые хосты;
- код выхода `1` — найден запрещённый хост; скрипт печатает `file:line host` для каждого нарушения.

## 5. Как добавить новый хост

1. Убедитесь, что запрос подпадает под один из трёх допустимых случаев из раздела 2.
2. Откройте `scripts/network-allowlist.json`.
3. Добавьте запись в `hosts` с обязательным полем `reason`, объясняющим назначение хоста.
4. Для группы поддоменов используйте `hostSuffixes` вместо перечисления.
5. Запустите `bun run check:network` и убедитесь, что проверка проходит.

Если хост добавляется временно (например, до удаления связанной возможности), добавляйте его в `pendingRemoval` с пометкой изменения, которое его уберёт.

### Call recording retention

The tray's call action starts the same local capture as the widget; it does not
silently start a recording at launch. Microphone and system-audio permissions
remain required. Call tracks are saved locally even when dictation audio saving
is off, including after transcription failures. Explicit deletion and existing
history limits still apply; this is not indefinite storage. Live translation has
its own unchanged retention policy.

### Usage statistics

The statistics tab is computed entirely on the machine from local aggregates in the
shared store file under the `stats` key, kept separate from the `history` key and
from transcript text. Nothing in the statistics pipeline performs a network request:
there is no analytics endpoint, no account and no telemetry, so
`bun run check:network` stays green with its audit unchanged.

Statistics record only word counts, the number of successful recordings, audio
seconds, measured processing seconds, the source (dictation, file, call, live
translation) and the recognition model id captured when that recording completed.
They never contain transcript text, prompts, API keys, endpoints, file paths or
application names. A recording without a model lands in the "Неизвестно" bucket, and
a measurement that was never taken stays missing instead of being written as zero.

Clearing the history removes transcripts and audio files but does not delete the
aggregates, so the statistics remain comparable over time. The typing speed the user
enters or measures is a local setting, and the saving estimate is derived from it in
memory. Source and model breakdowns start at the update that introduced them: older
recordings are counted only in the totals and are not re-analysed from stored
history.

### Personal vocabulary

The personal vocabulary lives only on this computer, under its own
`personalVocabularyV1` key in the shared `talkee.json` store, separate from
`settings`, `history` and `stats`. It holds approved spellings, replacement
rules, domains, the analysis schedule and consent records, and later derived
suggestions with short source quotes. Consent records keep a local hash of the
backend kind, endpoint and model plus a sanitized endpoint label; API keys are
never stored there. Application and schedule are off on a clean install and
after an update; opening the vocabulary section performs no network request.

If the key cannot be read (damaged file, unknown or newer version), the app keeps
the original data untouched, disables vocabulary application and analysis, and
ordinary dictation continues without it. Nothing is deleted to recover; a reset
happens only through an explicit user action. Diagnostic logs record mutation
names, revisions, counts and error codes, never terms, aliases or quotes.

Export writes a local JSON file (`talkee-personal-vocabulary`, version 1) chosen
in the system save dialog. It contains only spellings, language, category,
domain, the hint setting and replacement rules with their context words and
approval flag. It never contains history, audio, correction examples,
suggestions, dismissals, the schedule, the backend, API keys, consent records,
internal IDs or provenance. Import reads one file of at most 1 MiB chosen in the
system open dialog, validates it completely and shows a preview before anything
is saved. Only rows the user selects are added, existing terms and rules are not
overwritten, and import never turns on application, the schedule, an API consent
or the correction hotkey. Neither action makes a network request.

### Local diagnostic logs

Application diagnostics stay on this computer in `~/.talkee/talkee.log` and up to
three rotated archives (5 MiB each, 20 MiB total with a single app writer). They
contain operation/entry identifiers, trigger and configuration choices, model
and prompt identifiers, sanitized endpoint host/path, durations, HTTP statuses,
error categories, text lengths and token usage when supplied by the provider.
They do not contain API keys, Authorization values, request/response bodies,
full transcripts or system prompts. Endpoint userinfo, query and fragment are
removed; control characters cannot create fake log records.

Older application versions may have logged transcript content; updating does
not retroactively redact the retained old tail. The user can clear active and
all archives through the existing application action, or run `bun run logs:clear`
while the application is stopped. Transcript history is separate from diagnostic
logs and retains its existing access/deletion rules. No logs are uploaded.
