# FFmpeg (встроенный sidecar)

Talkee не использует внешний FFmpeg. В релизной сборке аудио конвертирует
собственный минимальный sidecar `talkee-ffmpeg`, который собирается из исходников
скриптом `scripts/prepare-ffmpeg-sidecar.mjs`.

## Как используется

Единственная точка вызова — `src-tauri/src/media/ffmpeg.rs::run_ffmpeg`. Реальные
аргументы задаются в `src-tauri/src/media/`:

| Место | Аргументы |
| --- | --- |
| `media/local_stt.rs:31-46` | `-hide_banner -loglevel error -y -i <in> -vn -ac 1 -ar 16000 -acodec pcm_s16le <out>` |
| `media/file_prep.rs:59-88` (local STT) | то же + `-f segment -segment_time <N> -reset_timestamps 1 <pattern>` |
| `media/file_prep.rs:59-88` (API) | `… -b:a 32k -f segment …` и вывод `.mp3` |
| `media/file_prep.rs:257-272` | `-hide_banner -loglevel error -y -i <in> -vn -ac 1 -ar 16000 -acodec pcm_s16le <out>` |
| `media/file_prep.rs:311-326` | `… -vn -ac 1 -ar 16000 -b:a 32k <out.mp3>` |

Итого используются:

- **фильтры:** авто-вставляемые `aresample`, `aformat`, `anull` (явных `-af` нет);
- **энкодеры:** `pcm_s16le` (WAV 16 кГц mono) и `libmp3lame` (MP3 32 кбит/с);
- **мультиплексоры:** `wav`, `mp3`, `segment`;
- **протоколы:** `file`, `pipe`;
- **`-vn`**: видеопоток отбрасывается без декодирования, видеодекодеры не нужны.

## Форматы диалога выбора файла

`src/windows/settings/tabs/FileTranscriptionTab.tsx:1076`:

```text
audio/*,video/*,.mp3,.wav,.m4a,.mp4,.mov,.webm,.ogg,.flac,.mpeg,.mpga,.avi,.mkv
```

Этому соответствуют демультиплексоры `aac,aiff,avi,caf,flac,matroska,mov,mp3,mpegps,mpegts,ogg,wav`
(`mov` покрывает mp4/m4a/mov; `matroska` покрывает mkv/webm) и аудиодекодеры из
`scripts/prepare-ffmpeg-sidecar.mjs`.

## ffprobe

`src-tauri/src/media/probe.rs` **не вызывает ffprobe**: длительность и параметры WAV
читаются чисто на Rust через `hound`. Поэтому `--enable-ffprobe` не включается —
сборка идёт с `--disable-ffprobe`, а probe остаётся минимальным вариантом.

## Сборка

`scripts/prepare-ffmpeg-sidecar.mjs`:

1. Скачивает исходники с проверкой SHA256:
   - FFmpeg `7.1.5` — `https://ffmpeg.org/releases/ffmpeg-7.1.5.tar.xz`
     (`de668509caf9e35e3cd162473441fdb29538c6d96ed080292b3cf9e6fc5d558f`);
   - LAME `3.100` — `https://downloads.sourceforge.net/project/lame/lame/3.100/lame-3.100.tar.gz`
     (`ddfe36cab873794038ae2c1210557ad34857a4b6bdc515785d1da9e175b1da1e`).
2. Собирает статический `libmp3lame.a` (LGPL).
3. Конфигурирует FFmpeg: `--disable-everything --disable-autodetect --disable-network
   --disable-doc --disable-programs --enable-ffmpeg --disable-ffplay --disable-ffprobe
   --enable-small --disable-gpl --disable-nonfree --cc=clang --enable-protocol=file,pipe`
   с явными списками демультиплексоров, декодеров, энкодеров (`pcm_s16le,libmp3lame`),
   мультиплексоров (`mp3,segment,wav`) и фильтров.
4. Кеширует сборку в `src-tauri/target/ffmpeg-build/` и копирует результат в
   `src-tauri/binaries/talkee-ffmpeg-<target-triple>`.

Дополнительно к плану change'а включены `libmp3lame` и мультиплексор `segment`
(они нужны реальному коду), а также демультиплексоры `avi` и `mpegps/mpegts`
(форматы диалога выбора файла).

## Лицензия

Сборка LGPL: `--disable-gpl --disable-nonfree`. `libmp3lame` — LGPL. Исходники FFmpeg
и LAME распространяются по своим лицензиям; ссылки на них приведены выше.

## Проверка

`bun scripts/smoke-ffmpeg.mjs` прогоняет фикстуры
`src-tauri/tests/fixtures/media/` (wav, m4a/aac, mp3, ogg/opus, webm/opus, flac,
mp4 с видео+AAC) через встроенный ffmpeg в WAV 16 кГц mono, проверяет MP3-кодирование
и мультиплексор `segment`.
