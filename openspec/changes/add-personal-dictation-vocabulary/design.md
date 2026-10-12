# Design

## Context

Мотивация и продуктовые границы — в [proposal.md](proposal.md). Проверяемые договоры — в пяти delta-specs этого change. Дизайн ниже фиксирует данные, точки интеграции и бюджеты, чтобы реализация не требовала нового продуктового проектирования.

Сегодня `HistoryEntry` хранит исходный STT и итог очистки, но не человеческие исправления или происхождение словарных замен. Одинаковые raw/cleaned компактно сохраняются, при чтении исходник восстанавливается; новую функциональность нельзя строить только на физически записанном поле raw. История ограничена, аудио обычной диктовки по умолчанию не сохраняется. Анализ работает с доступным текстом и не требует включения аудио.

Редактор, куда Talkee вставляет текст, не возвращает изменения. Уже есть `copy_selected_text` с восстановлением временного буфера обмена: его достаточно для явного захвата исправления. Нет основания вводить наблюдение за Accessibility, клавиатурой или чужими документами.

Batch и принятый streaming-final сходятся в `transcriptionPipeline.ts`; после опциональной очистки выполняются перевод, запись истории и вставка. Словарь нужно интегрировать в этот общий финальный путь и передавать снимок в отдельные STT-запросы. Сейчас sidecar локального STT принимает prompt, но не подключает его к `WhisperRunOptions.initial_prompt`.

Текстовый backend выбирается независимо от STT. Существующие JS AbortSignal и deadlines сами по себе не гарантируют остановку локальной генерации: LLM-sidecar синхронно обслуживает HTTP и не может принять команду отмены во время inference. Поэтому адресная остановка входит в объём этой фичи, а остановка всего общего runtime не используется.

**Зависимость:** до apply необходимо архивировать `fix-developer-dictation-cleanup`. В этом change изменяется его требование `Unavailable cleanup is visible`, которого пока нет в main spec. Проверка структуры текущего delta проходит, но проверка будущего архива предупреждает об отсутствующем заголовке до архивирования зависимости.

## Goals / Non-Goals

**Goals:**

- Одна локальная модель данных, один владелец мутаций и один общий нормализатор финала диктовки.
- Полный рабочий цикл: заполнить → получить доказательные предложения → утвердить → применить → проверить → исправить или удалить.
- Работоспособность ручного словаря без LLM; bounded-анализ через существующий текстовый backend.
- Измеримая польза и отсутствие незаметного изменения кодовых идентификаторов.

**Non-Goals:**

- Обучение весов STT, отдельный classifier-сервис, embeddings, векторная база, новая подписка или SDK.
- Автоматическое чтение внешних редакторов, автоматическое включение правил, неявное переключение области.
- Новая инфраструктура расписаний ОС: анализ выполняется только внутри открытого Talkee.

## Decisions

### 1. Снимок словаря и порядок обработки

Последовательность обычной диктовки:

```text
начало записи → неизменяемый снимок словаря
    → STT с поддерживаемой подсказкой → существующая проверка результата
    → существующая опциональная ИИ-очистка
    → один проход точных словарных замен
    → опциональный перевод → история / финальный overlay / вставка
```

Снимок содержит включение, `lexiconRevision`, активную область, язык из настроек диктовки, скомпилированные правила и список подсказок. Он создаётся до запуска STT и передаётся через контекст записи, batch fallback, принятие финала stream и reconciliation. Retry создаёт новый снимок. Промежуточный streaming-текст остаётся черновым; финальное представление получает результат общего pipeline.

Глоссарий для включённой ИИ-очистки добавляется к **существующему одному** запросу. Локальные замены всё равно идут после него: иначе очистка могла бы заново испортить написание. При недоступной очистке нормализуется настоящий raw, а уведомление учитывает фактический результат: «Очистка не удалась — применён словарь» только при выполненных заменах.

Опциональные новые поля истории:

| Поле | Содержание |
| --- | --- |
| `personalization` | версия, область, возможность подсказок, IDs включённых подсказок/правил, число замен, статус применения |
| `preVocabularyText` | текст непосредственно перед нормализацией, только если он отличается и от raw, и от итогового текста |
| `cleanupApplied` | факт успешного изменения текста очисткой; не выводится из наличия персонализации |

Raw остаётся настоящим STT. При отсутствии очистки источник нормализатора восстанавливается из raw; при очистке с заменами сохраняется промежуточный текст. Новые поля проходят existing normalize/compact-history round trip. Старые записи не получают выдуманный факт человеческого исправления. Просмотр истории различает исходник, итог и словарные изменения; переводные записи по-прежнему используют существующие поля перевода.

**Альтернатива:** нормализовать только batch или до очистки — меньше изменений в одном файле, но разные результаты stream/retry и повторная порча терминов.

### 2. Хранение и атомарные операции

Использовать уже установленный `tauri-plugin-store` и отдельный корневой ключ `personalVocabularyV1` в `talkee.json`. Не добавлять БД и второй механизм хранения. Rust владеет всеми словарными мутациями; JS получает состояние и отправляет типизированные команды.

В `AppSettings` добавить только `vocabularyCorrectionHotkey: ""`, чтобы использовать существующую транзакцию глобальных клавиш. Остальные параметры фичи хранить вместе со словарём:

| Раздел состояния | Поля и назначение |
| --- | --- |
| Заголовок | `schemaVersion: 1`, `revision`, `lexiconRevision`, `dataEpoch` |
| `config` | `enabled: false`, `activeDomain: null`, `analysisSchedule: "off"`, сроки, согласия |
| `terms` | утверждённые термины и их утверждённые варианты |
| `suggestions` | собираемые и готовые кандидаты, независимо выбранные варианты |
| `evidence` | происхождение, source ID/fingerprint, проверенная цитата, конкретная пара |
| `dismissals` | ключи отклонённых пар для подавления повторных предложений |
| `coverage` | обработанные диапазоны версии каждой доступной записи |
| `lastJob` | режим, backend fingerprint, статус, счётчики, даты, безопасная причина |

Каждая мутация включает `expectedRevision`. Короткий Rust Mutex защищает read/validate/set/save, без удержания во время LLM или IPC ожиданий. Кандидат состояния проверяется целиком до записи; ошибка save восстанавливает предыдущее значение в памяти и возвращает ошибку форме. Событие `vocabulary:updated` отправляется только после успешного сохранения.

`revision` меняется при любой durable-мутации, `lexiconRevision` — только при изменении применяемых терминов/области/включения. Каждый WebView держит прогретый кэш скомпилированного снимка; обновление прогресса анализа не вызывает перекомпиляцию. Контекст записи не меняется после захвата снимка.

Команды: чтение состояния; сохранение/удаление термина; изменение config; атомарный reviewed-import; подтверждение исправления; review предложения; получение job lease; commit проверенного пакета; инвалидирование источников; очистка обучения/полный сброс. Lease допускает один проход, сбрасывается после перезапуска. Внешний клиент никогда не присылает произвольный готовый store без проверки.

Для неизвестной версии/повреждения сохранить исходный ключ без перезаписи. Отдельно предоставить экспорт исходных данных для восстановления; обычный переносимый экспорт остаётся без evidence. Словарь/анализ отключаются, диктовка продолжает работать. Сброс возможен только явным действием.

**Альтернатива:** JS serial queue и `setSettings` проще локально, но не защищают два WebView и вложенные конкурентные изменения.

### 3. Договор термина, правила и переносимого JSON

| Сущность | Поля / ограничения |
| --- | --- |
| Термин | UUID, canonical 1–64 Unicode-символа, language `any` или код поддерживаемого языка, category, scope, enabled, useAsHint, createdAt/updatedAt |
| Категория | acronym / service / environment / tool / product / person / other; только группировка UI |
| Область | `global` либо одно имя 1–64 символа; активна одна область плюс global |
| Вариант | UUID, source 2–64 символа с минимум одной буквой, target = canonical, enabled, caseSensitive, contextWords до 5 |
| Контекст | целые слова, хотя бы одно в пределах 5 токенов от совпадения в том же предложении; пустой список — без ограничения |
| Происхождение | manual / starter / import / human-correction / history-analysis; не означает разрешение применения |

Имена областей и canonical сохраняют регистр; ключи сравнения используют NFC и согласованный lowercase. В JS использовать встроенный normalize, на границе Rust — macOS Foundation через уже установленный objc2-foundation; не добавлять Unicode-библиотеку и не доверять присланному ключу без пересчёта. Не нормализовать весь исходный текст: его незаменённые байты должны сохраниться. Управляющие символы, переносы, пустые поля, `<|...|>`-служебные токены и правила на URL/пути/кодовые фрагменты отклоняются. Canonical со знаками допустим для настоящих названий, но не вводит произвольных инструкций в prompt.

Проверять совместимость областей и языка: global может конфликтовать с любой областью; две разные явно выбираемые области могут иметь разные значения. В режиме auto language правила всех языков выбранной области одновременно доступны, поэтому коллизия в auto тоже считается конфликтом. Одинаковый исходник с несовместимыми целями отклоняется даже при разных контекстах: не нужен скрытый приоритет контекстных правил. Запрещается результат одного совместно активного правила как исходник другого. Полностью идентичный canonical вариант не создаётся; явно утверждённое изменение только регистра допустимо с caseSensitive, не считается собственной каскадной петлёй и должно быть идемпотентно.

Лимиты v1: 1000 терминов, 20 вариантов на термин, 500 кандидатов включая собираемые, 1000 evidence, 2000 ключей отказов, до 3 цитат по 300 символов на карточку, сериализованное состояние ≤5 МиБ. Подтверждённые термины и ledger отказов не вытесняются. Достижение лимита останавливает соответствующую мутацию/commit пакета, оставляет остаток и предлагает удалить/экспортировать данные. Прогресс не объявляется завершённым после потерянного кандидата.

Переносимый JSON:

```json
{
  "format": "talkee-personal-vocabulary",
  "version": 1,
  "terms": [{
    "canonical": "PIM",
    "language": "any",
    "category": "service",
    "scope": { "domain": "Разработка" },
    "enabled": true,
    "useAsHint": true,
    "variants": [{
      "source": "пи ай эм",
      "caseSensitive": false,
      "contextWords": [],
      "enabled": true
    }]
  }]
}
```

Scope общего термина — `{"global": true}`, строго одно из двух полей. Target производен от canonical и не импортируется отдельно. Файл ≤1 МиБ, неизвестные версии/поля отклоняются. Локальные IDs создаются/переиспользуются при reviewed-merge по ключу canonical/language/scope. Preview показывает новые, одинаковые, добавляемые и конфликтующие строки; одинаковые — no-op. Выбранные изменения применяются одной CAS-операцией без замены несвязанных пользовательских правил.

### 4. Точный нормализатор и защищённые фрагменты

Скомпилированный индекс по первому токену содержит literal-варианты в порядке убывания длины. Matcher работает по original spans и выбирает самое длинное совпадение в текущей левой позиции. Межсловный пробел может быть любым непустым горизонтальным whitespace, но не переходом строки/предложения. Границы слова учитывают Unicode letters/numbers/underscore, поэтому «прод» не совпадает с «продажа».

До поиска отметить защищённые spans: fenced/inline code, URL/email, slash/backslash paths, составные идентификаторы с underscore/цифрами/смешанными частями. Любое пересечение запрещает замену. Canonical/варианты только букв не делают `dev` и `prod` автоматическими правилами: ASCII-вариант разрешается лишь отдельно введённым утверждённым правилом вне защищённых spans.

Результат собирается один раз из незатронутых оригинальных срезов и canonical. После вставки replacement повторно не анализируется; изменение регистра делается только ровно в утверждённом фрагменте. Нет fuzzy matching, фонетического расстояния, автоматического склонения или исправления каждого похожего слова.

Аварийные пределы: вход >50 000 Unicode-символов, >1000 найденных замен или превышение общего вычислительного бюджета 50 мс дают исходный текст до нормализации и статус ошибки словаря. Для обычных 2000 символов обязательна отдельная проверка p95 ≤10 мс с прогретым 1000-term индексом. Во время прохода нет чтения истории/записи store/LLM. Проверка бюджета выполняется внутри цикла, а не только после завершения.

**Альтернатива:** глобальные regex replace или фонетический поиск короче, но меняют идентификаторы, дают каскады и сложный непроверяемый порядок.

### 5. Наполнение и UI

Добавить «Словарь» в группу настроек рядом с моделью и стилем. Использовать существующие `src/ui`, inline styles, semantic CSS variables и русские строки. Три внутренние вкладки — «Термины», «Предложения», «Анализ»; не создавать отдельное окно или новый UI kit.

- «Термины»: переключатель применения, выбор одной области/«Только общий словарь», поиск, категории, список с canonical/областью/числом правил, editor и импорт/экспорт.
- Starter-preview: PIM, Dev, Prod с редактируемыми написаниями; «пи ай эм», «пим», «дев», «прод» выбираются отдельно. Dev/Prod предлагают контекст «деплой», «окружение», «среда» с возможностью правки; никакого молчаливого разрешения ASCII dev/prod. Переключатель включения не предвыбран.
- Editor: canonical отдельно от списка вариантов; каждый изменённый вариант требует подтверждения, показывает область, регистр и контекст. Отключение правила не удаляет evidence.
- «Предложения»: human-origin выше модельных, затем число независимых записей и стабильный canonical; до трёх цитат. Можно принять только термин, отдельно выбранные варианты или отклонить. Готовое правило никогда не включается из-за одной LLM-догадки.
- «Анализ»: выбранный backend и возможность hints, ручные режимы, расписание off/daily/weekly, состояние/остаток/отмена, отдельные API-согласия, очистка обучения и полный reset.

Все destructive-действия описывают фактический объём удаления. Form errors сохраняют введённый текст; CAS-конфликт требует обновить preview и заново подтвердить, не автосохраняет устаревшую форму. Таблицы/кнопки имеют keyboard/VoiceOver labels; возврат фокуса, dark/light и стандартные размеры соответствуют `rules/style.rule.md`.

### 6. Явное исправление из редактора

Глобальная клавиша сначала вызывает существующий `copy_selected_text`, затем показывает раздел и correction-dialog. Не делать focus/show-window до чтения. Если выделение отсутствует, никаких durable-данных; можно открыть ручную форму по отдельному выбору.

Кандидат источника — последняя успешно вставленная обычная диктовка за последние 10 минут, из существующего недавнего кэша истории. Это удобная подсказка, не доказательство соответствия. Пользователь всегда видит исходную запись, ошибочный фрагмент и новое написание. Для произвольного переписывания предложить ручной выбор узкого исходного span и пары, а не автоматическое обучение whole-sentence rewrite.

Из истории действие уже знает entry ID, но также требует подтверждения пары. Источник пары может быть raw или сохранённым текстом до словаря; словарный результат не считается человеческим evidence. Исправленный текст живёт в памяти формы до подтверждения, отмена уничтожает его.

«Сохранить пример» атомарно создаёт human-evidence и готовое предложение. «Сохранить и добавить правило» сначала показывает полный scope/context/case и по одному подтверждает варианты, затем сохраняет term/rule/evidence одной операцией. Исходную историю не переписывать.

Hotkey — новый target существующих `hotkeyEvents` / `hotkeyTransaction` / `useWidgetHotkey`, с existing normalize/validate/register/rollback и проверкой всех четырёх текущих клавиш. Регистрировать незаполненную клавишу не нужно.

### 7. Формирование и проверка LLM-пакетов

Backend разрешается существующим `resolveSummaryBackend`; добавить operation `vocabulary-analysis` к существующему text runner, без отдельного API-клиента. Для этой operation отключить автоматические retries/перезапуск shared local runtime. API deadline 30 с, local 60 с, включая подготовку; усечённый ответ всегда ошибка.

Eligibility: завершённый voice, непустой, без dictationTranslation, без известных ошибок. Legacy voice со стандартным source/default допускается только после existing normalization записи. Берётся весь доступный raw и успешный результат **до словаря**; старое отличие raw/cleaned маркируется предположением ИИ-очистки, а не человеком. Файлы/созвоны/live translation/summary не включаются. Ограничение истории нельзя скрывать: UI пишет «доступная сохранённая история», не «всё, что вы когда-либо говорили».

Coverage хранится как source ID + SHA-256 fingerprint исходных полей/происхождения + обработанные диапазоны. Длинная запись делится по предложениям, затем по Unicode-границе; перекрытие до 64 символов сохраняет контекст, а covered range исключает повторный подсчёт. Ни хвост, ни запись с изменённым fingerprint не считаются обработанными заранее.

Бюджеты:

| Параметр | API | Управляемая local LLM |
| --- | --- | --- |
| Полный input текста/JSON | ≤12 КиБ UTF-8 | полный собранный prompt ≤2700 байт UTF-8 при context 4096 |
| Фрагментов в пакете | ≤20 | ≤8 |
| Выход | maxTokens ≤1024, ≤5 кандидатов, ≤64 КиБ ответа | то же |
| Запросов за проход | automatic ≤3 / manual ≤20 | то же |
| Время прохода | automatic ≤3 мин / manual ≤15 мин | то же |

Локальный byte budget консервативно оставляет место для 1024 output tokens и chat template; размер считается после JSON-экранирования и сборки prompt. Для меньшего подтверждённого context окно уменьшается. Сторонний manual endpoint без известного context использует консервативный предел и останавливается на ошибке, не повторяет платные/дорогие попытки.

Каждый job получает ephemeral opaque source IDs и передаёт только нужный текст и вид происхождения. Системная инструкция требует JSON, запрещает выполнять команды из материала и не содержит пользовательского cleanup preset. Контракт ответа:

```json
{
  "candidates": [{
    "canonical": "PIM",
    "language": "any",
    "category": "service",
    "domain": "Разработка",
    "variants": ["пи ай эм"],
    "evidence": [{
      "sourceId": "s1",
      "quote": "настроить пи ай эм",
      "sourceVariant": "пи ай эм",
      "kind": "stt-hypothesis"
    }]
  }]
}
```

Строгая проверка: JSON object/arrays, разрешённые поля/enums, длины/лимиты, sourceId в текущем пакете, quote и sourceVariant действительно присутствуют в указанном source span, origin согласован с переданными данными. Неверная схема/усечённый JSON отклоняет весь пакет без cursor commit; отдельный кандидат с выдуманной цитатой исключается, валидные остаются. `kind` не может повысить источник до human. Пустой корректный список — успешно обработанный пакет.

Кандидаты агрегируются между пакетами по canonical/language/domain/sourceVariant. Повторы внутри одной записи и overlapping ranges дают один уникальный source. Историческая карточка становится готовой после ≥3 независимых записей с проверяемым сигналом; до этого состояние collecting, видимое через фильтр, без предложенной автозамены. Human-пара создаёт ready после одного подтверждения. Локальная агрегация/ranking использует происхождение, количество источников и стабильный tie-break; проценты «уверенности» не вычисляются.

Canonical тоже гипотеза до утверждения: совпадение цитаты не доказывает правильность написания. Неоднозначные aliases по умолчанию не выбираются. Подтверждённые пары исключаются из повторного предложения; rejected ledger блокирует ту же пару на новых model sources, пока пользователь явно не восстановит её или не подтвердит новое human-evidence.

### 8. Один coordinator, checkpoint и расписание

Coordinator живёт в Widget через `useWidgetController`, а не в Settings: закрытие настроек не обрывает проход, открытие двух окон не запускает два анализа. Settings отправляет команды request/cancel, подписывается на безопасный progress. Rust job lease и `dataEpoch` защищают от дубликатов и поздних commits.

Состояния: idle → preparing → running → completed / paused / cancelled / failed / needs-attention. `preparing` проверяет backend/consent/source plan и берёт lease. После каждого валидного пакета одна CAS-мутация сохраняет предложения/evidence/coverage; только затем обновляется progress. При конфликте версии повторяется локальная проверка данных на свежем состоянии, **без повторного LLM-запроса**. Удалённый/изменённый источник или иной epoch делают пакет непригодным.

Расписание off по умолчанию. Daily = 24 часа, weekly = 7 суток от последней попытки, время хранится epoch UTC и отображается локально. Запуск только после due, ≥10 новых eligible записей **или** существующего незавершённого остатка и 30 секунд простоя. Использовать одноразовый timer и existing events изменений истории/processing state; при выключенном расписании нет фонового сетевого опроса.

Любой захват аудио, файловая обработка, созвон, live translation, выделение с текстовой моделью или другая foreground LLM-операция препятствует запуску и останавливает текущую генерацию анализа. Диктовка начинает захват сразу; она не ждёт ack отмены. Coordinator не запускает следующий пакет и инвалидирует текущий generation до cancel IPC. Локальная модель освобождается к следующей очистке.

После exhausted budget остаток ждёт «Продолжить» или следующего периода. Ошибка/ручная отмена/отмена ради диктовки не вызывает немедленный автоматический restart; следующий automatic срок считается от начатой попытки. Если приложение было закрыто, при открытии выполняется один due-check, не серия «пропущенных» запусков. Старый running-job становится paused с объяснением.

**Альтернатива:** внешний cron или анализ при каждом сохранении проще инициировать, но создаёт непредсказуемые обращения API и конкурирует с записью.

### 9. Реальная отмена запросов и управляемого sidecar

Для `vocabulary-analysis` Rust регистрирует request ID и cancellation handle. Команда `cancel_text_request` адресно снимает reqwest future через select/deadline; JS onAbort вызывает её, а late result отсекается и в JS, и на commit. Cleanup сохраняет отдельный существующий договор 8/12 с и не получает новые retries.

Managed LLM HTTP требует минимальной перестройки, потому что текущий последовательный accept loop не принимает cancel во время generation:

1. Один network acceptor с bounded parsing/read timeout обслуживает health/models/cancel сразу и отправляет completion в bounded queue ёмкости 1 через try_send. Переполненная очередь возвращает busy.
2. Один inference worker инициализирует и владеет LlamaBackend/model/context и обрабатывает очередь последовательно; никаких отдельных model copies, перемещения non-Send model между потоками или произвольного thread pool.
3. Managed-only completion включает `request_id`. Коротко блокируемый registry ID → AtomicBool включает queued/active запросы. `POST /v1/cancel` с точным ID ставит flag; worker проверяет его до/после каждого существующего prefill chunk и между токенами. Размер chunks при необходимости уменьшается для ограниченной задержки отмены. Отмена не возвращает partial JSON как успешный анализ, удаляет registry entry и сохраняет загруженную модель.
4. Health объявляет `analysis_control_version: 1`, адресную отмену и context size. Runtime проверяет этот договор без генерации. Старый sidecar не допускается к periodic analysis; обновление использует обычный путь сборки/упаковки sidecar.

Cancel перед стартом/во время sampling/deadline должен освобождать worker; cancel неизвестного ID — безопасный idempotent no-op. Переходящие cancellation handles удаляются на всех exit paths. Для custom local server periodic доступен только с подтверждённым совместимым контрактом; manual явно предупреждает о best effort остановке транспорта. Не посылать guessed cancel endpoint произвольному API.

Для удалённого API прекращается ожидание/передача; провайдер уже мог начать вычисления/списать запрос. Поэтому запрещён скрытый retry неизвестного исхода. Не обещать пользователю отмену начисления.

### 10. Подсказки STT и cleanup по фактическим возможностям

| Адаптер | Передача / поддержка |
| --- | --- |
| Managed local Whisper | HTTP prompt → `WhisperRunOptions.initial_prompt`, actual inference; existing no_context/no_speech safeguards сохранены |
| Groq Whisper | документированный multipart `prompt` |
| OpenAI GPT-4o Transcribe | multipart `prompt`, existing model/language/format; убрать ветку с недокументированным `instructions` |
| OpenAI Realtime transcription | `session.audio.input.transcription.prompt` только для поддерживаемой transcription model/purpose |
| Managed Nemotron/GigaAM | только local text replacements; не передавать неиспользуемый prompt |
| Неизвестный custom endpoint | normalizer; hints только при известном выбранном совместимом adapter, без угадывания |

Документация: [OpenAI STT prompting](https://developers.openai.com/api/docs/guides/speech-to-text#prompting), [transcriptions API](https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create), [Realtime client events](https://developers.openai.com/api/reference/resources/realtime/client-events), [Groq STT](https://console.groq.com/docs/speech-to-text), [Whisper native options](https://github.com/handy-computer/transcribe.cpp/blob/main/include/transcribe/whisper.h). Текущий [Nemotron runtime](https://github.com/handy-computer/transcribe.cpp/blob/main/docs/models/nemotron-3.5-asr-streaming-0.6b.md) не предоставляет персональный лексикон через используемый RunOptions. Возможности закрепляются whitelist адаптера, а не проверкой строки «prompt» в payload.

Подсказки строятся из approved active canonical с `useAsHint`, в стабильном порядке происхождения human/manual → остальные, затем canonical/ID. Максимум 32 термина. Для Whisper словарная часть prompt ≤200 UTF-8 bytes (консервативный byte upper bound вместо новой tokenizer dependency при лимите 224 tokens) и дописывается в конец существующей подсказки языка: сама русская подсказка уже 291 byte, а Whisper учитывает последние 224 tokens, поэтому при переполнении теряется начало подсказки языка, а не словарь. Без словарных подсказок prompt не меняется. Для GPT-4o/Realtime весь prompt ≤1024 UTF-8 bytes. Длинный canonical пропускается целиком, не обрезается до другого слова; UI показывает число реально включённых терминов. Исходные промпты сохраняют смысл, но резервируют место для canonical. Не добавлять прозу evidence/LLM-инструкции.

Очистка использует тот же ограниченный список canonical как отдельный безопасный data block к существующему preset/custom prompt; пользовательский стиль не переписывается. Realtime и batch reconciliation получают один снимок, переводные purpose — без него. Не переносить словарь в URL query или диагностические логи.

### 11. API-согласие, удаление источников и приватность

Manual API-анализ требует отдельного подтверждения текущего запуска или сохранённого разрешения; periodic API требует явно включённого continuous-разрешения. Экран показывает нормализованный получатель/модель, количество записей и bounded объём отправки. Согласие на STT/очистку не заменяет согласие на исторический текст.

Consent fingerprint включает backend kind, нормализованный endpoint и model; API-key не входит. Полный endpoint fingerprint хешируется локально, в UI/logs показывается только очищенный адрес без userinfo/секретных query-полей. Изменение получателя/модели требует нового согласия, ротация отдельно хранимого API-key — нет. Снимок backend фиксируется на job; изменение backend/revoke инвалидирует job до нового запроса и до commit.

Отправлять текстовые фрагменты и opaque source IDs; не audio, app names, file paths, API-ключи, stats или весь store. Диктовка сама может содержать чувствительный текст: согласие относится именно к выбранному историческому содержимому. Логи ограничить operation/request-ID без слов, backend kind, elapsed, counts, safe reason code.

Все удаления истории и retention/pruning проходят source-invalidation **до** доступности позднего commit. Evidence/citations/coverage удалённых IDs удаляются, counts пересчитываются, collecting/ready без достаточных источников пересматриваются. Уже утверждённые term/rules остаются как явный выбор; source reference от них отсоединяется. Прерывание очистки после сбоя завершается на startup reconcile с реально доступными IDs.

«Удалить примеры и предложения» повышает epoch, останавливает job, удаляет evidence/suggestions/dismissals/coverage и сохраняет границу текущих существующих IDs: periodic не переанализирует их молча. Старые данные доступны только новому явному full-history запуску. «Сбросить словарь» дополнительно очищает terms/config/consents и выключает application/schedule; существующий hotkey preference можно сохранить, но пустой словарь ничего не меняет.

**Альтернатива:** хранить только число повторов без source references проще, но нельзя проверить доказательства и корректно выполнить удаление.

### 12. Приёмка точности и завершённость

Сделать локальный evaluator `scripts/evaluate-vocabulary.mjs` с manifest реального удержанного пользовательского аудио, ожидаемыми canonical occurrences, контрольными фразами и защищёнными фрагментами. Он принимает manifest, экспортированный словарь и JSONL результатов реальных STT-прогонов; сам не создаёт новый сетевой клиент. Результат содержит audio hash, модель/config fingerprint, отсутствие cleanup, режим baseline/hints и raw; пары с разным audio hash не сравниваются. Fixtures проверяют matcher/форматы; они не доказывают повышение распознавания.

Три измерения на одном audio:

- S: baseline STT без hints и без замен, cleanup off.
- N: тот же baseline STT + точные правила; показывает пользу нормализации.
- H: повторный STT с hints + те же правила, только поддерживаемые адаптеры; показывает дополнительный эффект подсказок.

Словарь фиксируется **до** записи приёмочного набора; нельзя подбирать правила по ошибкам held-out набора и продолжать считать его независимым. Минимум 50 новых реальных фраз, ≥30 целевых вхождений, ≥20 контрольных фраз; ≥10 ошибок baseline для осмысленного относительного сравнения. Acceptance: ≥30% относительного снижения ошибок терминов, 0 ложных замен в контроле, все защищённые identifiers сохранены. Показать абсолютные числители/знаменатели, S/N/H и неподдерживаемые режимы; не заменять это общей WER, где редкие названия теряются.

Если baseline слишком хорош — расширить набор; если данных нет — зафиксировать «точность не проверена», не закрывать задачу приёмки как выполненную. Аудио/тексты пользователя не коммитить. Реальные прогоны выполняются существующим native transcribe-путём с тем же аудио и соответствующим снимком в локальной QA-сессии; временный driver допустим только в DEV. API-прогон запускается только с явно выбранным backend/получателем, ключи и транскрипты не выводить в диагностику.

Отдельный локальный benchmark прогретого normalizer: 1000 terms, текст до 2000 символов, прогрев и ≥50 замеров, отчёт p50/p95 и критерий p95 ≤10 мс на Apple M5. Inference latency hint-enabled STT показывается отдельно. Manual end-to-end: ручное PIM → внешнее исправление → proposal review → dictation без cleanup → API/local analysis → cancellation/deletion → restart/import/export.

## File Map

Пути относительно корня репозитория. Новые файлы добавлять по указанным устойчивым границам; это не отдельные сервисы или новая framework-архитектура.

| Файлы | Изменение |
| --- | --- |
| `src/lib/vocabulary.ts`, `src-tauri/src/vocabulary/mod.rs`, `src-tauri/src/vocabulary/model.rs`, `src-tauri/src/vocabulary/store.rs` | договоры, IPC, bounded state, validation, CAS, import/export, source invalidation |
| `src/lib/vocabularyNormalization.ts` | pure protected-spans matcher и compiled snapshots |
| `src/lib/vocabularyAnalysis.ts` | eligibility, chunking, structured response validation, provenance/aggregation |
| `src/windows/widget/services/vocabularyAnalysisCoordinator.ts` | single lease, progress, timers, budgets, cancellation/preemption |
| `src/windows/widget/services/vocabularyCorrection.ts` | ephemeral selection capture и pairing формы |
| `src/windows/settings/tabs/vocabulary/VocabularyTab.tsx`, `src/windows/settings/tabs/vocabulary/VocabularyEditor.tsx`, `src/windows/settings/tabs/vocabulary/VocabularySuggestions.tsx`, `src/windows/settings/tabs/vocabulary/VocabularyAnalysisPanel.tsx`, `src/windows/settings/tabs/vocabulary/CorrectionDialog.tsx` | production-раздел, reviewed population/review/analysis/correction |
| `src/windows/settings/SettingsApp.tsx`, `src/windows/settings/settingsNavigation.ts`, `src-tauri/src/commands/settings_window.rs` | frontend/native whitelist новой вкладки |
| `src/lib/hotkeyEvents.ts`, `src/windows/widget/services/hotkeyTransaction.ts`, `src/windows/widget/hooks/useWidgetHotkey.ts` | новый target, transaction/rollback, capture до focus |
| `src/lib/store.ts`, `src/windows/settings/tabs/MainTab.tsx` | settings default/hotkey, backward-compatible history, correction action, deletion/pruning hooks |
| `src/lib/i18n/messages.ts`, `src/lib/i18n/dict/vocabulary.ts`, `src/lib/i18n/dict/settingsRest.ts` | русские строки и навигация |
| `src/lib/summarize.ts`, `src/lib/textCleanup.ts`, `src-tauri/src/ai.rs`, `src-tauri/src/ai/text_requests.rs` | shared runner operation/deadlines/addressable cancellation; один glossary block |
| `src/windows/widget/hooks/useWidgetController.ts`, `src/windows/widget/hooks/useWidgetRecording.ts`, `src/windows/widget/services/recordingRuntime.ts`, `src/windows/widget/services/transcriptionPipeline.ts`, `src/windows/widget/services/dictationStreamOverlay.ts` | snapshot lifecycle, common normalization, notices, stream/batch parity, analysis ownership |
| `src-tauri/src/bin/talkee-stt.rs`, `src-tauri/src/live_dictation.rs`, `src-tauri/src/realtime.rs` | actual Whisper inference prompt и purpose-aware native/realtime bridge |
| `src-tauri/src/llm_runtime.rs`, `src-tauri/sidecars/talkee-llm/src/main.rs`, `src-tauri/sidecars/talkee-llm/src/request_control.rs` | cancel capability, bounded request queue, single inference worker |
| `src-tauri/src/lib.rs` | регистрация vocabulary/cancel команд, managed state |
| `scripts/evaluate-vocabulary.mjs`, `scripts/evaluate-vocabulary.test.mjs`, `package.json` | reproducible evaluator/benchmark и bun-команда |
| `docs/architecture/overview.md`, `docs/architecture/processing-modes.md`, `docs/audio-pipeline-principles.md`, `docs/privacy.md`, `docs/testing/manual-style-test-plan.md` | реальные возможности, порядок pipeline, consent/retention и ручная приёмка |
| Соседние `*.test.ts` / Rust unit tests | сценарии конфликтов, Unicode/protected spans, budgets, cancellation, deletion и interop |

## Risks / Trade-offs

- [LLM может уверенно придумать правильное написание] → origin/цитаты не выдаются за истинность; ≥3 источника лишь дают предложение, каждое применение утверждает человек.
- [Точный alias может быть обычным словом] → область, optional context, раздельное утверждение, ноль false positives в controls; никаких fuzzy-правил.
- [Nemotron не получает word boosting] → UI «Только замены после распознавания», реальная оценка N отдельно от H, работа без cleanup.
- [Whisper prompt ограничен и может повлиять на hallucinations] → компактный deterministic budget, сохранение guardrails, no-speech fixtures и held-out аудио.
- [Локальная LLM конкурирует с foreground] → настоящий адресный cancel и приоритет записи; custom без cancel не получает periodic.
- [Три запроса не покрывают всю историю] → точный остаток/checkpoints, «Продолжить», последующие периоды без ложного completed.
- [История уже удалена/не сохранялась] → анализ только доступного, manual/correction/starter остаются полноценным наполнением.
- [Единый store и ограничения размера] → bounded state, CAS, preserve-on-error; отдельная БД нужна только при подтверждённом будущем масштабе.
- [Высокая цена полноты фичи] → переиспользовать store/backend/UI/hotkeys; отмена sidecar — необходимая граница, без дополнительных classifier/cron/semantic services.

## Migration Plan

1. Архивировать зависимость; начать реализацию на `change/add-personal-dictation-vocabulary`, сохранив несвязанные пользовательские изменения.
2. Добавить reader/validator v1, defaults off и hotkey empty; existing history/settings не переписывать массово.
3. Реализовать durable mutations, normalizer, manual UI и capture. На промежуточном этапе ручной словарь уже проверяем, API-анализ ещё выключен.
4. Подключить STT hints/cleanup, затем request cancellation/sidecar contract и только после этого history analysis/periodic UI.
5. Выполнить contract/integration checks и реальные accuracy/latency критерии; обновить документацию и gate.
6. Rollback поведения: выключить применение/расписание, сохранить экспорт; старые версии приложения игнорируют отдельный root key и optional history fields. Не удалять v1 при downgrade. Для full reset использовать явную команду.
7. Архивирование/merge change — отдельное последующее действие после выполненных задач и приёмки; текущий запрос создаёт только спецификацию.
