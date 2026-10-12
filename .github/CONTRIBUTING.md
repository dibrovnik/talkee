# Contributing to Talkee

Thanks for helping make voice input better on macOS. [Bug reports and feature ideas](https://github.com/dibrovnik/talkee/issues/new/choose) are welcome.

## Develop

Use macOS 14+ on Apple Silicon, Bun (the packageManager version in package.json), and stable Rust with rustfmt and clippy.

```sh
bun install --frozen-lockfile
bun run prepare:sidecars
bun run tauri dev
```

Before a pull request, run `bun run gate` and `bun run build`. Keep changes focused, explain the user-visible behavior, and include screenshots for UI changes. Never attach API keys, private recordings, or unredacted logs.

Read [AGENTS.md](../AGENTS.md) for conventions, [architecture](../docs/architecture/overview.md) for the module map, and [audio principles](../docs/audio-pipeline-principles.md) before changing recording or transcription. Planning lives in OpenSpec. Release maintainers follow [the release rule](../rules/release.rule.md).

Code and comments are English; UI strings belong in the existing Russian/English dictionaries. Use existing helpers and controls, and preserve accessibility.

By contributing, you agree that your contributions are licensed under [AGPL-3.0-or-later](../LICENSE).
