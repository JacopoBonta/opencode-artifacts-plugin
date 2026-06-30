# opencode Artifacts Plugin

Agent-generated **plans** and **reports** for [opencode](https://opencode.ai),
reviewed in your browser — with inline anchored comments, **Approve /
Request changes / Decline**, and a blocking approval **gate** that stops the
agent from editing files until you've signed off on a plan.

The workflow it enforces: **plan → (you review) → implement → report**.

---

## Features

- **Plan-first gate** — file edits (`write`/`edit`/`patch` and mutating shell
  commands) are blocked until you approve a plan.
- **Inline review** — select any text in a plan to leave an **anchored** comment,
  or add general comments; **Approve**, **Request changes**, or **Decline**.
- **Revisions** — request changes and the agent re-publishes a new revision;
  browse the history.
- **Roadmaps & phases** — large work decomposes into a roadmap plus per-phase
  plan → implement → report cycles.
- **Read-only reports** — the agent summarizes what it did; reports never block.
- **Real-time** — the browser updates live over Server-Sent Events.
- **Keyboard-driven** — command palette (`⌘/Ctrl-K`), shortcut help (`?`), tabs,
  light/dark themes.
- **Local & private** — the review server binds to `127.0.0.1` and is guarded by
  a per-session capability token.

## Requirements

- **opencode** (the plugin runs in opencode's Bun-based runtime).
- A web browser for the review companion.

The browser companion ships **prebuilt** in the npm package — there's nothing to
build to use the plugin.

## Install

Add the package to the `plugin` array in your `opencode.json`:

```json
{
  "plugin": ["opencode-artifacts-plugin"]
}
```

opencode resolves it from npm (installing it into `node_modules` on demand). To
pin a version:

```json
{
  "plugin": ["opencode-artifacts-plugin@0.1.0"]
}
```

<details>
<summary>Local development alternative</summary>

Reference a checkout by absolute path, or symlink it into `.opencode/plugins/`:

```json
{ "plugin": ["/absolute/path/to/opencode-artifacts-plugin"] }
```

When running from source, build the companion once with
`bun run build:companion` (see [Development](#development)).
</details>

## Usage

1. **Ask the agent to implement something.** Because file edits are gated, the
   agent's first step is to publish a plan with the `publish_artifact` tool. A
   browser tab opens with the plan, and **the agent pauses** — the tool call
   does not return until you act.
2. **Review the plan.** Select text in the document to get a floating
   **💬 Comment** button for an *anchored* comment, or write a general comment in
   the right-hand panel. Then choose:
   - **Approve** — file edits unblock and the agent implements the plan.
   - **Request changes** — your unresolved comments go back to the agent, which
     revises and re-publishes a new revision for another look.
   - **Decline** — the work is rejected and the agent's turn is stopped.
3. **The agent implements**, then publishes a **report** summarizing what was
   done. Reports are read-only and never block. Publishing a report against a
   standalone plan **completes** it and re-closes the gate, so new work needs a
   fresh plan.

**Large work** is split into a **roadmap** (a high-level decomposition you
approve) and then one plan → implement → report cycle per **phase**. Approving a
roadmap does *not* unblock edits — each phase plan is reviewed on its own.

### What the gate blocks

While there's no approved plan, these are blocked: the `write`, `edit`, and
`patch` tools, and `bash` commands that look like they modify the workspace
(`rm`, `mv`, `cp`, redirects, `sed -i`, package installs, mutating `git`
subcommands, …). **Not** blocked: read-only commands (`ls`, `grep`, `git
status`, running tests) and git bookkeeping (`git add`/`commit`/`push`, branch
creation). The bash gate is a cooperative heuristic to keep the workflow honest,
**not** a security sandbox.

## Configuration

By default the companion server binds to a random free port. To pin it, use
either of the following (the config option wins over the environment variable):

**1. The `companionPort` plugin option** in your `opencode.json` — pass options
to the plugin with the `[name, options]` tuple form of the `plugin` array:

```json
{
  "plugin": [
    ["opencode-artifacts-plugin", { "companionPort": 4799 }]
  ]
}
```

The value may be a number or a string, so opencode's
[variable substitution](https://opencode.ai/docs/config/) works — for example,
read the port from a `COMPANION_PORT` environment variable:

```json
{
  "plugin": [
    ["opencode-artifacts-plugin", { "companionPort": "{env:COMPANION_PORT}" }]
  ]
}
```

Then set that variable before launching opencode:

```sh
COMPANION_PORT=4799 opencode
```

`{env:COMPANION_PORT}` resolves to `4799`, so the companion server listens on
`http://127.0.0.1:4799`. If `COMPANION_PORT` is unset it resolves to an empty
string, which is ignored — the server falls back to a random free port.

**2. The `OPENCODE_ARTIFACTS_PORT` environment variable** (used when
`companionPort` is unset):

| Variable | Default | Effect |
| --- | --- | --- |
| `OPENCODE_ARTIFACTS_PORT` | random free port | Pin the companion server's port. |

Resolution order: `companionPort` option → `OPENCODE_ARTIFACTS_PORT` → random
free port. Empty, non-integer, or out-of-range (`1`–`65535`) values are ignored
and fall through to the next source.

## Notes on security & blocking

- The review server listens on **`127.0.0.1`** only and requires a **per-session
  capability token** (handed to the browser via the URL the plugin opens), so it
  isn't reachable from the network or from other web pages.
- Publishing a **plan blocks the agent with no timeout by design** — it waits
  until you Approve or Request changes. If you close the browser without acting,
  the agent stays parked until the opencode session ends. **Reports never block.**

## Development

```sh
bun install
bun run build:companion     # build the browser companion (companion/dist)
bun run test                # backend tests (bun)
bun run test:companion      # companion tests (vitest)
bun run typecheck           # tsc --noEmit
```

The companion is built automatically before publishing (`prepublishOnly`).

For how it all works under the hood — the gate, the store, the HTTP/SSE API, the
anchoring model, and the companion app — see
**[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.
