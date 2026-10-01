# Local STT Runtime

Talkee supports a managed local STT runtime named `talkee-stt`. The app uses it for local models without requiring Docker.

## Recommended catalog and compatibility

The visible suggestions are limited to three Russian-capable models:

| Model | Runtime id | Mode |
| --- | --- | --- |
| Nemotron 3.5 ASR Streaming 0.6B | `nvidia/nemotron-3.5-asr-streaming-0.6b` | streaming (main scenario) |
| GigaAM v3 | `ai-sage/GigaAM-v3` | batch, 25-second segment window |
| Whisper large-v3-turbo | `whisper-large-v3-turbo` | batch |

Only Nemotron advertises native streaming; GigaAM and Whisper large-v3-turbo run as
batch models in this runtime, and the file pipeline keeps the 25-second window for
the GigaAM RNNT model (`local_file_transcription_segment_seconds`).

The runtime registry itself is not trimmed: the resolver still maps earlier values —
runtime ids (`whisper-small`), GGUF file names (`whisper-small-q4_k.gguf`,
`gigaam-v3-e2e-rnnt-Q4_K_M.gguf`) and Hugging Face ids (`Qwen/Qwen3-ASR-0.6B`,
`ai-sage/GigaAM-v3`) — so an already installed model and the user's saved choice
keep working. Such models are shown in the models tab with a "previously
installed" note instead of being dropped.

Installs stay explicit: Talkee never downloads or removes a model on its own. A
model that is no longer suggested is neither deleted nor hidden while its file is
present; removing it requires the user's delete action.

## Runtime Lookup

When a local model is installed, Talkee:

1. Checks whether the local OpenAI-compatible endpoint is already available at `http://127.0.0.1:8000`.
2. Tries to start a bundled Tauri sidecar named `talkee-stt`.
3. If the sidecar is not bundled, downloads a platform-specific runtime from a manifest.
4. Starts the downloaded runtime and waits for `/health`.
5. Calls `POST /v1/models/:model` to install the selected model.

The runtime manifest URL defaults to:

```text
https://talkee.ru/downloads/talkee-stt/manifest.json
```

For development it can be overridden with:

```text
TALKEE_STT_RUNTIME_MANIFEST=https://example.test/manifest.json
```

## Manifest Format

```json
{
  "version": "0.1.0",
  "macos-aarch64": {
    "url": "https://talkee.ru/downloads/talkee-stt/0.1.0/talkee-stt-aarch64-apple-darwin",
    "sha256": "..."
  },
  "macos-x86_64": {
    "url": "https://talkee.ru/downloads/talkee-stt/0.1.0/talkee-stt-x86_64-apple-darwin",
    "sha256": "..."
  }
}
```

## Runtime API

The runtime must bind to localhost only.

```text
GET  /health
GET  /v1/models
POST /v1/models/:model
POST /v1/audio/transcriptions
```

`GET /v1/models` should return:

```json
{
  "data": [
    { "id": "Systran/faster-whisper-large-v3-turbo" }
  ]
}
```

`POST /v1/audio/transcriptions` should accept OpenAI-compatible multipart form data and return:

```json
{
  "text": "Recognized text"
}
```
