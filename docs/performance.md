# Производительность на Apple Silicon

Документ описывает методику замеров и таблицу «до/после» для change
`optimize-apple-silicon`. Бюджеты заданы в спеке
`openspec/changes/optimize-apple-silicon/specs/performance/spec.md`.

## Методика

### Размер бандла

```bash
bun run build:release:macos
du -sh src-tauri/target/release/bundle/macos/Talkee.app
ls -la src-tauri/target/release/bundle/macos/Talkee.app/Contents/MacOS/
```

Скрипт `scripts/report-bundle-size.mjs` (вызывается в конце
`build:release:macos`) печатает размер `.app` и каждого sidecar'а и падает,
если бюджет превышен.

### Задержка диктовки

- Фраза длительностью ~5 с, локальный режим, модель Whisper large-v3-turbo
  (или модель по умолчанию), прогретая модель.
- Пять прогонов подряд; в таблицу идёт медиана.
- Метрики берутся из `~/.talkee/talkee.log`: `pipeline_total_ms`,
  `inference_ms`, `paste_ms`, `model_load_ms`.

### CPU в простое

- Приложение запущено, виджет виден, курсор не над виджетом, запись не идёт.
- «Мониторинг системы», 60 с, среднее по процессам talkee и WebView.

## Таблица «до» (baseline, 30.09.2026, Apple M5, macOS 26)

Замеры сделаны на ветке `change/optimize-apple-silicon` до изменений.

| Метрика | Значение |
| --- | --- |
| `Talkee.app` | 86 МБ |
| `talkee` (main) | 29,0 МБ |
| `talkee-ffmpeg` | 45,3 МБ |
| `talkee-stt` | 7,0 МБ |
| `talkee-diarize` | 3,9 МБ |
| `talkee-llm` | 4,9 МБ |
| `pipeline_total_ms` (медиана 5 прогонов) | не измерено |
| CPU в простое (60 с) | не измерено |

### Комментарии к baseline

- В коде на момент baseline нет лог-полей `pipeline_total_ms`, `inference_ms`,
  `paste_ms`, `model_load_ms` — ближайшего существующего поля для замера
  задержки нет. Их добавляет задача 1.4.
- Замер задержки требует интерактивной диктовки (горячая клавиша + микрофон),
  поэтому автоматически не воспроизводится. Замер CPU в простое требует
  запущенного GUI-приложения с видимым виджетом.
- Оба интерактивных замера выполняются вручную по методике выше; поле в
  таблице «до» остаётся «не измерено».

## Таблица «после» (30.09.2026, Apple M5, macOS 26)

Замеры после изменений change'а `optimize-apple-silicon`. Размеры сняты тем же
`du -sh`, что и baseline; скрипт `scripts/report-bundle-size.mjs` (логический
размер) печатает 27,8 МБ для `.app` и 2,6 МБ для ffmpeg и падает при
превышении бюджетов 40 МБ / 8 МБ.

| Метрика | До | После |
| --- | --- | --- |
| `Talkee.app` | 86 МБ | 28 МБ |
| `talkee` (main) | 29,0 МБ | 15 МБ |
| `talkee-ffmpeg` | 45,3 МБ | 2,6 МБ |
| `talkee-stt` | 7,0 МБ | 4,5 МБ |
| `talkee-diarize` | 3,9 МБ | 1,8 МБ |
| `talkee-llm` | 4,9 МБ | 3,8 МБ |
| `pipeline_total_ms` (медиана 5 прогонов) | не измерено | не измерено |
| CPU в простое (60 с) | не измерено | не измерено |

### Комментарии к «после»

- Бюджеты спеки по размеру выполнены: `.app` ≤ 40 МБ, ffmpeg ≤ 8 МБ
  (проверяется `scripts/report-bundle-size.mjs` в конце
  `bun run build:release:macos`).
- `LSMinimumSystemVersion` собранного `.app` — `14.0`.
- Задержка `pipeline_total_ms` и CPU в простое требуют интерактивной диктовки
  (микрофон + горячая клавиша) и ручного замера «Мониторингом системы»; в этой
  среде не воспроизводимы автоматически. Методика описана выше.
- Кеш и прогрев STT проверены автоматически: вторая транскрибация подряд даёт
  `model_load_ms=0` (см. задачу 1.8).
