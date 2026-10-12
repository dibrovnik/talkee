# Release Rule

This file defines the mandatory release workflow for Talkee. Follow it for every release without skipping steps.

## Naming

- Release branch: `release/vX.Y.Z`
- Release review file: `docs/release/review-vX.Y.Z.md`
- Git tag: `vX.Y.Z`
- Release preflight workflow: `.github/workflows/release-preflight.yml`
- `package.json` is the single version source; `@dibrovnik/pvs` propagates it to the
  other manifests through `pvs.config.json`.

## Mandatory sequence

1. Make sure everything is committed and the quality gate is green:
   - `bun run check:release`
2. Learn the next version without writing anything:
   - `bunx pvs bump <patch|minor|major> --dry-run` → `X.Y.Z`
3. Update `CHANGELOG.md`: rename `## [Unreleased]` to `## [X.Y.Z] - YYYY-MM-DD`
   and add a new empty `## [Unreleased]` above it. Commit `docs: changelog for vX.Y.Z`.
4. Raise the version everywhere and create the release commit and tag:
   - `bun run version:<patch|minor|major>` (runs `pvs bump <level> --commit --tag`)
   - This writes `package.json`, both `version` lines of `src-tauri/Cargo.toml` and the
     `talkee`/`talkee-llm` entries of `src-tauri/Cargo.lock`, then commits
     `chore: release vX.Y.Z` and tags `vX.Y.Z`.
5. Verify the changelog matches the new version:
   - `bun run check:changelog`
6. Build the signed macOS release artifact:
   - `bun run build:release:macos`

## GitHub Actions release source of truth

- Workflow file: `.github/workflows/release.yml`
- Tag push is the canonical release trigger; release preflight is the canonical build
  validation before tag push.
- Run release preflight on `release/vX.Y.Z` and do not push the `vX.Y.Z` tag until
  `Preflight macos` is green on the exact commit that will be tagged.
- Build the macOS release in the workflow. Do not claim unsupported platforms in release notes.

## Review checklist

- Working tree is clean and the version commit diff is intentional.
- `bun run version:check` and `bun run check:changelog` pass.
- Local production build passes via `bun run build:release:macos`.
- Version numbers and the release tag match.
- GitHub Release includes the macOS DMG and the signed macOS app archive.

## Output expectations

For each release, produce:

- release branch `release/vX.Y.Z`
- review file `docs/release/review-vX.Y.Z.md`
- updated `CHANGELOG.md`
- release commit `chore: release vX.Y.Z` and tag `vX.Y.Z`
- green release preflight on the release commit
- GitHub Release artifacts created by Actions

## Public distribution

- Canonical repository: https://github.com/dibrovnik/talkee.
- GitHub Actions uses the Apple Silicon `macos-14` runner and `bun run build:release:macos`; this prepares real sidecars after the gate creates placeholders.
- Manual Release dispatch checks out the requested tag in every job.
- Stable downloads: `Talkee-macos.dmg`, `Talkee-macos.zip`, and `SHA256SUMS`.
- CI uses ad-hoc signing (`TALKEE_DEV_SIGNING_IDENTITY=-`), without Apple notarization. Never describe it as Apple-verified signing. Local builds can use the configured stable identity.

- The LLM sidecar strips Rust `target-cpu` flags when building llama.cpp: upstream maps them to Clang `-march`, which does not accept Apple CPU names. It uses the portable ARM baseline and retains unrelated Rust flags.
