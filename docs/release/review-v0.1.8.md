# Release Review

## Release

- Version: `0.1.8`
- Release branch: `release/v0.1.8`
- Target tag: `v0.1.8`
- Reviewer: Antigravity
- Date: 2026-04-06

## Scope

- Key changes included in this release:
  - full rebrand from TalkFlow / Talk Flow / talk-flow to Talkee across the entire codebase
  - updated bundle identifier: `com.trixter.talkflow` → `com.trixter.talkee`
  - updated deep link URL scheme: `talkflow://` → `talkee://`
  - updated log directory: `~/.talkflow/` → `~/.talkee/`
  - updated Tauri store filename: `talkflow.json` → `talkee.json`
  - updated Cargo crate name: `talk-flow` / `talk_flow_lib` → `talkee` / `talkee_lib`
  - updated GitHub Actions release workflow paths and artifact names
  - fixed: API key and subscription changes now apply immediately without app restart (SettingsTabs was not emitting SETTINGS_UPDATED_EVENT to the widget)
  - bumped version metadata to `0.1.8`
- User-facing changes:
  - application name shown as "Talkee" everywhere (title bar, settings sidebar, permissions screen, widget notice, About)
  - `.app` bundle is now `Talkee.app` instead of `Talk Flow.app`
  - DMG is now `Talkee_<version>_aarch64.dmg`
  - users must re-grant Accessibility and Microphone permissions after upgrade because the bundle ID changed
  - existing settings in `talkflow.json` will not carry over; users start with a fresh `talkee.json`
- Risky areas:
  - bundle ID change means macOS treats this as a different app for permissions
  - users with existing `~/.talkflow/` logs won't see old logs unless they manually rename the directory
  - deep link scheme change: web auth callbacks must use the new `talkee://` scheme

## Checks run

- `bun run check:versions` — passed (all three files at `0.1.8`)
- `bun run check:release` — passed (TypeScript, Rust, hotkey smoke tests, Vite build)
- `bun run build:release:macos` — passed
  - `Talkee.app` created at `/tmp/talkee-target/release/bundle/macos/Talkee.app`
  - `Talkee_0.1.8_aarch64.dmg` created
  - Ad-hoc signed with identifier `com.trixter.talkee`

## Manual review

- Hotkey flow: unchanged in this release (code paths not touched)
- Settings sync: verified that API key, style, and endpoint changes in SettingsTabs now emit SETTINGS_UPDATED_EVENT, which the widget listens to and re-reads settings immediately
- Onboarding permissions: all UI strings now reference "Talkee" instead of "TalkFlow"
- Widget position and notice behavior: window titles now say "Talkee" and "Talkee Notice"
- Settings window title: "Talkee — Settings"
- Sidebar wordmark: "Talkee"
- Subscription and API key labels: reference "Talkee" correctly
- README refreshed: yes, version examples updated to `v0.1.8`
- GitHub Actions release workflow: artifact paths, names, and zip filenames all reference "Talkee"
- `grep -ri 'talk[-_ ]*flow'` across the repo returns zero results (excluding git history)

## Findings

- Blockers: none
- Non-blocking issues:
  - old `talkflow.json` store file will remain orphaned on existing installs; no automatic migration
  - old `~/.talkflow/` log directory will remain; no cleanup script provided
- Follow-ups after release:
  - verify the web app at talkee.ru correctly redirects to `talkee://auth?token=...` after login
  - confirm new users can complete full onboarding on a clean macOS install
  - consider adding a one-time migration from `talkflow.json` to `talkee.json` in a future release

## Decision

- Ready for `main` merge: yes
- Ready for tag publish: yes
