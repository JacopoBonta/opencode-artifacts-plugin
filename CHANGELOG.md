# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Configurable companion port via the `companionPort` plugin option in
  `opencode.json` (the `[name, options]` tuple form of the `plugin` array).
  Supports opencode variable substitution, e.g. `"companionPort": "{env:MY_ENV}"`.
  Resolution order: `companionPort` → `OPENCODE_ARTIFACTS_PORT` env → random port.

## [0.2.0] - 2026-06-30

First npm-publishable release: security hardening, a round of companion UX
improvements, and full documentation.

### Added
- Toast notifications for success/error with a Retry action on failed fetches.
- Discoverable floating **Comment** button on text selection (mouse + touch),
  replacing the implicit auto-anchor.
- Keyboard-shortcut help overlay (`?`).
- "anchor not in this revision" indicator for orphaned anchored comments.
- System / light / dark theme with live `prefers-color-scheme` tracking.
- README (install, usage, configuration) and `docs/ARCHITECTURE.md`
  (technical "how it works").

### Changed
- Comment deletion now requires a two-step inline confirm.
- Tree collapse state, and editor scroll position, persist across reloads/refreshes.
- Command palette gains focus trap/return and listbox/option ARIA.
- Package is now npm-publishable: `files` allowlist ships the prebuilt
  `companion/dist`, `prepublishOnly` builds it, plus license/repository metadata.
- Removed references to Antigravity from the docs.

### Fixed
- A failed comment post no longer discards the typed draft.
- Reading a historical revision is no longer force-jumped to latest on a live
  update; a "newer revision" nudge is shown instead.
- Artifact-tree rows align: a plan with a nested result lines up with childless
  sibling rows (shared chevron gutter).

### Security
- The review server binds to `127.0.0.1` (was all interfaces) and requires a
  per-session capability token (`x-artifacts-token` header; `?token=` for SSE).
- Origin check on state-changing requests (CSRF defense in depth).
- Request bodies are validated; verdicts on unknown ids return 404.
- Artifact ids are now unguessable UUIDs; static serving is path-contained; the
  SSE stream is token-gated and connection-capped.

## [0.1.0] - 2026-06-22

### Added
- Initial plugin: the `publish_artifact` tool, the plan → implement → report
  workflow with a plan-first edit gate, roadmaps and phases, the on-disk
  artifact store, the loopback HTTP/SSE API, and the React review companion
  (inline anchored comments, revisions, approve / request-changes / decline).

[0.2.0]: https://github.com/JacopoBonta/opencode-artifacts-plugin/releases/tag/v0.2.0
[0.1.0]: https://github.com/JacopoBonta/opencode-artifacts-plugin/releases/tag/v0.1.0
