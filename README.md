# opencode Artifacts Plugin

Agent-generated artifacts (plans & reports) with browser-based review:
inline anchored comments, approve / request-changes, and a blocking
approval gate for plans — inspired by Google Antigravity.

## Install

1. Build the companion once: `bun run build:companion`
2. Reference the plugin from your opencode config (`opencode.json`):

   ```json
   { "plugin": ["/absolute/path/to/opencode-artifacts-plugin"] }
   ```

   or symlink this repo into `.opencode/plugins/`.

## Usage

Ask the agent to draft a plan. It calls the `publish_artifact` tool; a browser
tab opens with the artifact. Comment inline (select text → Comment), then
**Approve** or **Request changes**. On changes, the agent revises and
re-publishes a new revision. Reports publish without blocking; use **Request
refinement** to send feedback for a follow-up turn.

Environment: set `OPENCODE_ARTIFACTS_PORT` to pin the companion port.

## Development

- Backend tests: `bun run test`
- Companion tests: `bun run test:companion`
- Typecheck: `bun run typecheck` (and `cd companion && bunx tsc --noEmit -p tsconfig.json`)
