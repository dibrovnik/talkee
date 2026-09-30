# Talkee — Agent Guide

Talkee is a macOS (Apple Silicon) voice-to-text app: a small floating widget that records
on a global hotkey, transcribes, optionally cleans the text with an LLM, and pastes the
result into the active app. Desktop stack is Tauri v2 (Rust) + React/TypeScript. Processing
is either your own API key or managed local models; there is no cloud account, no telemetry,
and no subscription.

Full module map: `docs/architecture/overview.md`.

## Repository Map

```text
src/                        Frontend (React/TypeScript)
  lib/                      Store, logging, permissions, model mode, stats, shared clients
  windows/widget/           Floating widget: hooks + recording/transcription services
  windows/settings/         Settings window and tabs
  components/               Shared UI controls and onboarding
src-tauri/                  Rust backend
  src/                      Tauri commands, AI, audio, STT, paste, window management
  src/bin/                  Managed sidecar runtimes (talkee-stt, talkee-diarize)
  Cargo.toml
docs/                       Architecture, audio rules, privacy, release, testing
rules/                      Agent-facing project rules
skills/                     Talkee UI style skill (checklist)
scripts/                    Build, sidecar and check scripts
openspec/                   OpenSpec planning workspace (changes, specs, config.yaml)
```

Detailed rules live in one place each; see [Domain Rules](#domain-rules).

## Commands

Use `bun` everywhere (not npm/yarn).

Before finishing any task, run `bun run gate` (see `docs/quality.md`).

```bash
# Development (hot reload)
bun run tauri dev

# Production build
bun run tauri build

# Signed local macOS release artifact
bun run build:release:macos

# TypeScript check
bunx tsc --noEmit

# Rust check
cargo check --manifest-path src-tauri/Cargo.toml

# Tests
bun test
bun test scripts

# Quality gate (run before finishing any task)
bun run gate          # static checks, format, types/lint, tests
bun run format        # apply Biome + rustfmt

# Hygiene and release gates
bun run check:naming
bun run check:release

# Versioning and changelog
bun run version:current
bun run version:check
bun run version:patch     # bumps, commits and tags
bun run check:changelog

# Logs
bun run logs          # tail -f ~/.talkee/talkee.log
bun run logs:clear
```

Versioning and release steps are in `rules/release.rule.md`.

## Code Rules

Prefer small modules with a clear responsibility, public API, and contract. Keep unrelated
workflows separated: a change to one pipeline (diarization, media conversion, request routing)
should not require reading whole unrelated files. Extract along stable boundaries — parsing,
conversion, chunking, runtime lifecycle, request routing, error mapping, UI state/view
composition. Do not create abstractions only to reduce line count; extract when it reduces
coupling or limits the context needed for a change. Preserve behavior during refactors.

### TypeScript / React

- Function components with explicit return types; hooks at the top, early returns for
  loading/error states.
- Inline styles with CSS variables. No CSS modules or styled-components.
- Prefer explicit `interface` over type aliases; use union types for finite states.
- Errors: catch, convert to a user-friendly message, log with the logger utility.
- Logging: use `src/lib/logger.ts` for important events.

### Rust

- `#[tauri::command]` for commands; keep them thin where practical and move pipeline logic
  into focused modules with explicit input/output structs.
- Return `Result<T, String>` from commands and map errors with `.map_err(|e| e.to_string())`.
- Logging: use the `logger` module.

## Domain Rules

- Audio, transcription, local STT, file transcription, call capture → `docs/audio-pipeline-principles.md`
- Processing modes (API / local) → `docs/architecture/processing-modes.md`
- Managed local STT runtime → `docs/local-stt-runtime.md`
- Privacy model → `docs/privacy.md`
- Product UI style → `rules/style.rule.md` (source of truth; `skills/talkee-product-ui-style/` references it)
- Release process → `rules/release.rule.md`
- Business requirements → `docs/business-requirements.md`
- Manual test plan → `docs/testing/manual-style-test-plan.md`

Key source files for audio work: `src/windows/widget/hooks/useWidgetRecording.ts`,
`src/windows/widget/services/recordingRuntime.ts`, `src-tauri/src/native_voice_recorder.rs`,
`src-tauri/src/ai.rs`, `src-tauri/src/media/`, `src-tauri/src/bin/talkee-stt.rs`,
`src-tauri/src/call_capture.rs`, `src/lib/callCapture.ts`.

## Workflow

Planning is done only through OpenSpec in `openspec/changes/`:

1. `/opsx:propose` — write the proposal, design, specs and tasks.
2. `/opsx:apply` — implement the tasks, marking them complete as you go.
3. `/opsx:archive` — archive the finished change.

The ordering of changes is recorded in `openspec/config.yaml`. Do not use other task
trackers or ad hoc markdown TODO lists.

The OpenSpec skills and commands (`.claude/skills/openspec-*`, `.agents/skills/openspec-*`,
`.claude/commands/opsx/`) are generated by `openspec update`. Do not edit them by hand;
regenerate them instead.

## Key Conventions

1. **Language:** UI text in Russian, code and comments in English.
2. **Hotkeys:** format `Modifier+Key` (e.g. `Ctrl+Alt+Space`); always validate with
   `validateHotkey()`.
3. **Settings:** load once at startup via `getSettings()`, save immediately on change.
4. **Widget size:** the compact widget matches `src/windows/widget/widgetConstants.ts`.
5. **Logs:** `~/.talkee/talkee.log`.
6. **Package manager:** `bun` everywhere (not npm/yarn).
7. **Dev-only features:** gate behind `import.meta.env.DEV`.
8. **License:** AGPL-3.0-or-later; see `LICENSE`.
