# Audio Pipeline Principles

This document is the working contract for Talkee audio changes. Future agents should update it when the audio architecture changes.

## Goals

- Keep ordinary voice dictation fast.
- Keep transcription quality stable.
- Avoid moving expensive conversion into hot paths.
- Keep local, cloud, file, and call behavior explicit instead of relying on hidden fallbacks.
- Preserve enough logs to diagnose audio quality and runtime behavior from `~/.talkee/talkee.log`.

## Pipeline Map

Voice dictation:

```text
Widget hotkey/button
-> useWidgetRecording.ts
-> recordingRuntime.ts
-> native_voice_recorder.rs first
-> processRecordingBlob()
-> ai::transcribe_and_clean()
-> optional guarded dictation cleanup (shared text backend, 8s API / 12s local deadline)
-> optional dictation translation via configured text backend
-> paste_text
```

File transcription:

```text
Files tab / history retry / widget file drop
-> path/options event to Widget-owned fileTranscriptionJobs queue
-> history processing entry (source path retained)
-> src/lib/fileTranscription.ts
-> ai::transcribe_file_path()
-> media.rs preparation/chunking
-> local, custom, or cloud STT
```

Call transcription:

```text
Widget call mode
-> src/lib/callCapture.ts
-> call_capture.rs for system track and preferred native mic track
-> recordingRuntime.ts only for the WebView mic fallback
-> transcribeCallCaptureSession()
-> file transcription pipeline
```

Live translation:

```text
Widget live-translation button
-> live_translation.rs
-> call_capture.rs system-audio stream plus optional cpal microphone stream
-> mono / 16 kHz / PCM16 / 100 ms chunks
-> bounded channels
-> Talkee Cloud (short-lived OpenAI secret) or configured OpenAI/Gemini API
-> separate realtime sessions per enabled audio source
-> normalized partial/final text events
-> existing widget-text overlay and history
```

## Live Streaming And Translation

Realtime audio stays in Rust. Never route PCM through React/Tauri events and do
not use ffmpeg in this hot path. System audio is always translated; microphone
audio is opt-in to avoid sending speaker echo as the user's voice. When enabled,
microphone and system audio are independent channels with separate translation
connections. Audio callbacks use bounded
non-blocking queues and may drop old audio instead of blocking capture.

Remote streaming STT is supported only for adapters whose exact key, model, and
endpoint configuration passed a realtime handshake. A transport failure must not
stop ordinary recording: the existing batch transcription remains the stop-time
fallback. Local Whisper and WhisperX are not realtime translation adapters.
In Cloud mode the desktop authenticates to `talkee-proxy` with its device token;
the proxy checks the subscription and returns a short-lived OpenAI Realtime
client secret. The primary cloud API key must never be returned to or stored by
the desktop. API mode continues to use the user's verified adapter directly.

Live translation reconnects after 0.5/1/2 seconds and replays no more than two
seconds of recent PCM. Gemini `goAway` events rotate the session. Provider audio
responses are ignored unless synchronous voice playback is explicitly enabled.
OpenAI translation uses the official `gpt-realtime`/`gpt-realtime-mini` session
models with text-only output by default. Voice playback switches the same session
to audio output and uses `response.output_audio_transcript.*` for the visible
translated text, so speech and overlay do not come from separate translation
requests. PCM16/24 kHz audio deltas stay in Rust and feed a bounded native
playback queue; stale queued speech is discarded instead of increasing live
latency without limit. Voice playback is currently enabled only on macOS, where
the global Core Audio tap excludes the Talkee process from capture. Other
platforms must not enable playback until their system-audio path can provide
equivalent self-process exclusion. When original-audio ducking is enabled, the
macOS tap uses `MutedWhenTapped` so the source remains available to Talkee at
full capture level without also playing at full volume. The captured 16 kHz
monitor feed is replayed through the self-excluded Talkee playback stream at low
gain and mixed with the translated voice, so the original remains quietly
audible without entering the translation loop;
legacy `gpt-realtime-translate` settings are resolved to `gpt-realtime` at the
runtime boundary. Continuous video speech must not be treated as one unbounded
turn. Talkee disables server-side turn detection for this path and commits voiced
PCM in short, roughly two-second segments. Only one text response may be active
at a time; audio received while a response is active stays in the next input
buffer and is committed as soon as the
previous response finishes. Session shutdown commits the final voiced fragment
and waits briefly for its response instead of dropping it.
Provider commit boundaries are transport details, not speaker boundaries. The
frontend coalesces consecutive final and partial segments from the same channel
into one visible turn; a new turn starts when the channel changes between the
system audio and the optional microphone.
OpenAI text deltas are accumulated by `response_id` without trimming or adding
synthetic spaces. A final event promotes only that response's draft; late deltas
for a finalized response are ignored. The frontend keeps finalized text stable,
renders only the active draft with reduced emphasis, coalesces rapid partial
updates to at most one render per 100 ms, and serializes overlay commands so an
older render cannot overwrite a newer one.
API keys stay in the Rust request path and must never appear in events or logs.

When `saveRecordingAudio` is enabled, `system.wav` and `mic.wav` are written so
history playback contains both sides of the conversation. The live microphone
translation toggle controls whether mic PCM is sent to the realtime translation
worker; it does not control local mic recording. When saving is disabled and
live microphone translation is off, no mic capture is started. When saving is
disabled, no audio file is created and the
whole session must not be retained in memory. Live translation, call capture, and
ordinary dictation mutually exclude each other.

## Voice Dictation

The primary voice path is native Rust capture:

- `src-tauri/src/native_voice_recorder.rs`
- Tauri commands:
  - `start_native_voice_recording`
  - `pause_native_voice_recording`
  - `resume_native_voice_recording`
  - `stop_native_voice_recording`
- Output contract:
  - `audio_base64`
  - `mime_type: "audio/wav"`
  - `file_name: "recording.wav"`
  - `duration_ms`
  - `sample_rate: 16000`
  - `channels: 1`
  - `peak`
  - `rms`

The recorder uses `cpal`, stores microphone samples in memory, converts to mono, resamples to `16 kHz`, writes PCM16 WAV, and logs stats on stop.

Important implementation details:

- `cpal::Stream` is not safe to keep in a global static on macOS. Keep the
  stream alive on its recorder owner thread and store only thread-safe control
  handles in global state.
- The native recorder owner thread is process-long and reused across recording
  sessions. Do not replace it with one short-lived OS thread per recording.

## Dictation Translation

Translation is an optional post-processing step for ordinary voice dictation
only. The widget records and transcribes the same way as normal dictation; after
successful recognition, `src/windows/widget/services/transcriptionPipeline.ts`
can send the cleaned text to the configured text backend through
`resolveSummaryBackend(settings)`.

Rules:

- Source language is `settings.language`; the translator UI must not maintain a
  separate source selector.
- Target language is `settings.translation.targetLanguage`.
- `settings.translation.widgetEnabled` only controls whether the widget bubble is
  visible.
- `settings.translation.active` is toggled from the widget bubble and controls
  whether the post-STT translation step runs.
- If the text backend is unavailable or translation fails, mark the history entry
  as failed and do not silently paste the untranslated text.
- Preserve the recognized text in `raw`, put the final translated text in
  `cleaned`, and store translation evidence in `dictationTranslation`.
- Do not apply this path to file transcription or call capture.

## Voice Fallback

Keep WebView `MediaRecorder` fallback in `recordingRuntime.ts`.

Fallback is required when:

- native recorder fails to start;
- a selected microphone exists, but only WebView `deviceId` can identify it reliably;
- platform-specific microphone permissions or device routing behave differently than `cpal`.

Do not remove the fallback unless selected-microphone parity is proven on macOS.

Talkee Cloud dictation is batch-only. Do not start a realtime transcription
session, stream microphone audio to the Cloud realtime endpoint, or show a live
transcript overlay while recording in Cloud mode. After recording stops, send
the complete recorded WAV through the Cloud batch transcription path and use
that result for history and paste. Local and own-key API streaming behavior
remains unchanged.

Before any ordinary dictation result reaches history, overlay, or paste, apply
the shared frontend no-speech guard. Clearly silent recordings should skip the
STT request when recorder signal statistics are available. Batch responses must
drop known silence hallucinations (including refusal/caption templates) and
short results written entirely in an unexpected script for the explicitly
selected recognition language. Automatic language detection must not reject a
short result solely because of its script.

## Local STT Input Format

Managed local Whisper expects:

```text
WAV, 16 kHz, mono, PCM 16-bit
```

Rules:

- Native voice recording should already produce this format.
- `media::convert_audio_to_local_stt_wav()` must skip ffmpeg when input is already ready.
- File transcription should also skip ffmpeg for ready WAV files that fit into one STT request.
- GigaAM v3 E2E RNNT is a non-streaming, short-form model. Keep ordinary dictation on the batch path and split file transcription into chunks no longer than 25 seconds.
- ffmpeg remains the correct path for arbitrary audio/video, WebM/Opus, MP3/M4A/MP4, diarization prep, and chunking.

When editing conversion code, preserve the logs:

- `Running bundled ffmpeg sidecar`
- `Bundled ffmpeg sidecar finished in ...ms`
- `System ffmpeg fallback finished in ...ms`
- `Skipping ffmpeg for local STT...`
- `Skipping ffmpeg for file transcription...`

The managed local STT runtime may move from its configured port to a dynamic
port when the preferred port is occupied. Live transcription must use the
effective endpoint returned by runtime warm-up, not the stale configured URL.
All HTTP requests to managed loopback runtimes must bypass operating-system
proxy settings. Keep proxy support for remote and cloud endpoints, but never
route `127.0.0.1` or `localhost` runtime health checks and inference requests
through a system proxy.
Reuse that effective runtime for subsequent chunks instead of starting a new
sidecar for every request. Runtime readiness must probe both the buffered
`/stream` route and the continuous `/live` route so an older sidecar cannot be
mistaken for a live-capable runtime. The Whisper runtime `/health` response also
has a versioned live API contract; bump and validate it whenever that protocol
changes.
For managed local endpoints, the batch request model must come from the active
local STT selection, never from the currently selected remote API adapter. The
Rust request boundary must still fall back to any installed managed model when
it receives a stale or unsupported remote model id.
Recording startup must not wait for a cold local runtime indefinitely. Give the
live warm-up only a short budget; when it is exceeded, begin microphone capture
and use the normal post-stop batch path while warm-up continues in the
background. A managed runtime that fails readiness must be terminated instead
of being left to occupy another port.

## Local Whisper Hallucination Guardrails

Long local Whisper jobs can produce repeated caption-like text on silence, for example:

- `Спасибо. Спасибо. Спасибо.`
- `Продолжение следует...`
- repeated copies of the last real phrase

This is not a UI recursion bug. It usually means Whisper received a long low-signal or silent region and reused context across internal windows.

Preserve these safeguards:

- `src-tauri/src/bin/talkee-stt.rs`
  - `params.set_no_context(true)`
  - `params.set_suppress_nst(true)`
  - low temperature / no temperature increment
  - entropy threshold
- `src-tauri/src/ai.rs`
  - known hallucination detection
  - repetitive transcript text sanitizer
  - repetitive timestamped segment filter before diarization assembly

If changing these filters, test against:

- short real voice dictation;
- long meeting/call recording with pauses;
- mostly silent audio;
- file transcription with speaker diarization enabled.

## File Transcription

File transcription is path-based. Do not load large files into WebView memory.

Rules:

- Keep `src/lib/fileTranscription.ts` as the frontend entry point.
- Keep native path invocation through `transcribe_file_path`.
- Keep chunk progress events and per-chunk logs.
- Use ffmpeg for video and unsupported formats.
- For local mode, each chunk must be converted to the local STT WAV contract before hitting the runtime.
- For cloud mode, use the existing proxy endpoints and do not silently switch to local diarization.

Chunking currently protects API limits and long recordings. Do not remove chunking unless the target endpoint is proven to handle the full file size and duration.

## Call Capture

Call capture has two different tracks:

- mic track: user microphone, captured natively through `cpal` when possible,
  with WebView `MediaRecorder` only as a compatibility fallback;
- system track: platform-specific system audio capture.

Resolve a selected call microphone label through `enumerateDevices()` before
starting capture, but do not pre-open it with WebView `getUserMedia()`. Start the
native mic first and open a WebView stream only after the backend explicitly
reports that native capture is unavailable. Opening the same input through both
paths during startup can make macOS call apps rebuild their audio route and can
leave other audio ducked.

Both native tracks are written while the call is active. Their PCM WAV headers
must be flushed at least every five seconds so a process crash cannot invalidate
the whole conversation. The session manifest is written atomically and the
frontend creates the history entry immediately after capture starts.

When the selected STT configuration supports streaming, microphone and system
audio use separate realtime sessions and update one live history draft. Durable
transcript checkpoints are appended to `transcript.jsonl`; partial UI updates
must never block an audio callback. A realtime failure is non-fatal: audio
capture continues and the user sees that the saved recording is still safe.

After stop, the normal file pipeline transcribes both saved tracks and replaces
the draft with the reconciled result. Batch-only models such as GigaAM skip the
live step and use this same stop-time path. On startup, manifests left in
`starting` or `recording` state are recovered, WAV sizes are repaired from the
durable file tail, and the latest saved transcript draft is restored to history.

Current system-audio support:

- macOS: implemented via a stereo global Core Audio tap / aggregate device in
  `call_capture.rs`. The aggregate is private and tap-only: do not add the
  physical output device as a subdevice, because recording must observe output
  without joining or changing its playback route. Ordinary call capture must
  always use the unmuted tap policy.

For macOS system track diagnostics, rely on stop-time logs:

```text
System audio capture level: max=... dBFS, frames_above_noise_floor=...
```

If `max=-120.0 dBFS` and `frames_above_noise_floor=0`, the system track is silent. The transcript should not treat that as usable remote-speaker audio.

## macOS Development Permissions

Run the macOS dev binary from `Talkee Dev.app` with a stable Apple Development
code-signing identity. An ad-hoc signature uses a designated requirement tied
to the binary's changing CDHash, so rebuilding makes TCC treat the next process
as a different application even when the old checkbox remains visible.

Microphone status should be read from AVFoundation without starting an audio
session. System-audio access must first be confirmed with the existing short
Core Audio capture probe. Only a successful probe may write the versioned
verification marker used after relaunch with the stable signing identity;
legacy or unversioned flags must be ignored, and a failed probe clears the
current marker.

## Speaker Diarization

Local speaker diarization uses:

- local Whisper segments with timestamps;
- local diarization runtime segments;
- overlap/nearest matching in `ai.rs`;
- final formatting in `format_speaker_transcript()`.

Rules:

- Do not assemble speaker transcripts from STT text without timestamps.
- Filter known repeated/hallucinated STT segments before assigning speakers.
- If the system track has no diarizable speech, the existing mic fallback is acceptable, but logs must make that explicit.
- Speaker labels shown to users should stay product-facing: `Вы`, `Гость N`.

## Logging Contract

Audio bugs are usually runtime bugs, not static type bugs. Keep logs specific.

Required evidence:

- recorder path used: native WAV, WebView WAV, WebM, or fallback;
- selected mic and active device label when available;
- audio stats: duration, sample rate, channels, peak, RMS;
- ffmpeg start and finish timing;
- STT endpoint and response status;
- file chunk index, total chunks, and chunk size;
- call system capture level and source/stored format.

Do not log API keys, device tokens, or full local model paths if they include sensitive user names.

## Verification

Minimum checks after audio pipeline edits:

```bash
bunx tsc --noEmit
cargo check --manifest-path src-tauri/Cargo.toml
git diff --check
```

For Rust logic in `ai.rs`, run targeted tests:

```bash
cargo test --manifest-path src-tauri/Cargo.toml ai::tests --lib
```

Manual checks when behavior changes:

- macOS voice dictation recognizes a real phrase and logs native recorder stats.
- Local voice dictation does not run bundled ffmpeg when native WAV is used.
- WebView fallback still records when native capture fails or selected mic cannot be mapped.
- Ready `16 kHz mono PCM WAV` file skips ffmpeg.
- MP3/MP4/WebM files still go through ffmpeg.
- Long local call/file transcription with pauses does not produce repeated `Спасибо` / `Продолжение следует`.
- macOS call capture does not regress.

## Release Notes For Audio Dependencies

`cpal` pulls the macOS Core Audio backend. If changing `cpal` features or
replacing the recorder backend, re-check the macOS build configuration.

## Tray call controls

The native tray sends explicit start/stop actions to the existing widget-owned
call pipeline. The native action is consumed once and disabled until the owner
publishes its next phase; synchronous widget phase refs additionally reject
repeated requests before React renders. Starting/finishing phases and conflicting
voice, file or live-translation activity disable start. Stop remains available
while a call is recording. Permission and disk failures use existing call notices.

`saveRecordingAudio` controls ordinary dictation only. Call mic/system tracks are
written independently and preserved after STT failure for playback/retry. This does
not override explicit history deletion, the 200-call/50 MB history limits, or the
separate live-translation retention policy.

## File Job Ownership

The Widget owns the single serial file queue. Settings only sends native paths and
options, subscribes before requesting a snapshot, and merges updates by job revision.
Closing/hiding settings or changing tabs does not cancel a job. This is not restart
recovery: exiting the application ends its runtime. History is persisted before
inference, retains `filePath`, and retry uses the same owner. Video data never goes
through `File.arrayBuffer()` in the settings workflow. Speaker setup remains an
explicit prerequisite; ordinary files do not trigger model installation.

Cancellation immediately marks the job interrupted and suppresses late progress
and success, but keeps the serial slot until the native request settles. A queued job
waits for dictation/call/live translation to become idle, without a polling loop.

### Cooperative cancellation

`ai::file_jobs` keeps one cancel flag per native `request_id`. `transcribe_file_path`
registers the flag and checks it before preparation, after each preparation step,
before every chunk, after diarization assembly and before returning the result. A
cancelled request removes its temporary chunk/diarization directories and fails with
the cancellation message, which the widget maps to the localized "stopped, you can
retry" wording. `cancel_file_job` only sets that flag: it never stops the shared
local runtime, and returning `false` for an unknown id is normal (the request may have
finished between the click and the command). The guard unregisters itself on drop, so
a settled request cannot be cancelled by a stale click and a later job with the same
id starts clean. Late success after cancellation is never written to history.

### Progress, durations and ETA

Progress is measured, not assumed. Native progress reports the chunk that *started*
and, separately, the chunks and audio seconds that *completed*, plus the monotonic
elapsed transcription time. Durations come from the FFmpeg segment CSV (including a
short last segment) or ready-WAV metadata. `getFileTranscriptionPercent` therefore
stays below 100 until the result exists, and the last started chunk never reads as
finished.

`estimateFileTranscription` extrapolates only measured transcription work: it needs
at least two completed chunks with a positive completed duration, the total audio
seconds and a positive elapsed time. Cold start, preparation, diarization and assembly
have no measurement, so they report "Оцениваем время" instead of a fabricated timer.
The wording stays explicitly approximate, and a completed job reports zero remaining.

### Streaming draft

When the managed Nemotron runtime streams, chunk partial text is forwarded on the
existing `dictation-stream:update` channel using the same request id as the file job.
The settings tab shows it as a clearly labelled draft and it is cleared as soon as an
authoritative progress event or the finished chunk text arrives, so completed text is
never duplicated. No timer fabricates partial text, the model and endpoint are
unchanged, and diarization keeps using its own verified non-streaming path. This is a
within-session draft only: it is never treated as a finished transcription, and it is
not part of restart recovery.

The streaming path is used only when all three hold: the endpoint is local, the request
is not diarized, and the selected model is a streaming one. A fourth condition is the
language: the managed runtime only starts a stream for a concrete language, and answers
`unsupported language` for `auto` or an empty selection. `file_streaming_supported`
therefore disables both the `streaming` flag and the streaming request id for `auto`,
so that case takes the ordinary JSON path and still succeeds instead of failing.

## Dictation cleanup hotkeys

The main hotkey and widget click follow the saved `cleanupEnabled` switch. The
dedicated cleanup hotkey forces cleanup on for that take only; it does not write
the global setting. Both hold and toggle recording modes use this same contract.
The pill/island indicator shows the saved setting while idle and the captured
effective choice during recording/processing.

## Cleanup latency and diagnostic evidence

Text processing alone uses a small persistent HTTP pool (one idle connection per
host, 30-second idle TTL). STT/file/download clients retain their existing policy.
Remote clients retain system-proxy support; local clients bypass it. DeepSeek
receives `thinking.type=disabled`. Cleanup has an absolute 8-second API / 12-second
local deadline, does not replay failed POSTs or issue paid background warm-ups,
and never accepts a response marked `finish_reason=length`. Long summary/chat
operations keep their existing budgets and output handling. Built-in cleanup
prompts are cached by language and selected preset id; custom prompts stay live.

Each dictation/attempt has a `request_id`; retries have a fresh id and retain the
history `entry_id`. Correlate `RECORDING`, `STT`, `CLEANUP`, `LLM`, `PASTE` and
`API` records. These are diagnostic measurements, not a guarantee of immediate
provider response or successful insertion into another application's editor.

| Event | Safe evidence |
| --- | --- |
| recording choice / cleanup decision | trigger, global/effective flag, override, backend, model, preset, input size |
| cleanup request/end | prompt version, budget, prep/cleanup milliseconds, applied/reason/error code, output size |
| LLM start/headers/response/end | request/entry id, operation, host/path, model, status, headers/total milliseconds, safe error code |
| provider metadata | request id, finish reason, supplied token/cache/reasoning counts; absent usage is unavailable, not zero |
| STT/paste stage | request/entry id, start/end, outcome, stage milliseconds |
| pipeline end | request id and pipeline_total_ms |

Error categories include missing configuration, `connect`, `transport`, `read`,
`timeout`, `http_NNN`, `parse`, `empty_response`, `truncated` and frontend
quality rejection. Raw provider error bodies and request payloads are not logged.

## Rotating local logs

The active log is `~/.talkee/talkee.log`; the three newest archives are `.1`, `.2`,
`.3` (newest first). Each is limited to 5 MiB, so the set is at most 20 MiB for a
single app writer. Oversized legacy logs retain only a bounded tail of complete
records on the next write. Entries are single-line, UTF-8-safe and bounded to
16 KiB; known key/Auth fields and endpoint credentials/query are redacted.
Newly opened log files use owner-only 0600 permissions. Disk/rotation failures
report a safe stderr category and do not interrupt dictation or append without
limits. Keep only one running app instance writing this path; the lock is
process-local.

- `bun run logs` follows replacement files through rotation (`tail -F`).
- The application's clear command serializes deletion of active + archives with
  writes. `bun run logs:clear` deletes the same four exact names; use this CLI
  command only while the app is stopped. Neighboring files are untouched.
- For a diagnostic audit read existing archives `.3`, `.2`, `.1`, then the active
  file, and filter by date/time and `request_id`/`entry_id`. For example:
  `grep 'request_id=YOUR_ID' ~/.talkee/talkee.log*`. Missing archives are normal.
- Unit tests capture native diagnostic records in memory and use temporary files
  for rotation tests, not the user's real app log.

No live hardware/VPN or external LLM latency/quality benchmark was performed in
this change: the user requested automated verification instead. Mock-server
tests exercise pooling, connection failure/recovery, statuses, deadlines and
metadata; prompt fixtures do not prove model inference quality.
