# Architecture

How the opencode Artifacts Plugin works under the hood. For installation and
usage, see the [README](../README.md).

## Overview

The plugin has two parts:

- **Backend** (`src/`) — an opencode plugin that runs in opencode's Bun runtime.
  It exposes the `publish_artifact` tool, enforces the plan-first gate, persists
  artifacts to disk, and runs a small HTTP server.
- **Companion** (`companion/`) — a prebuilt React single-page app served by the
  backend and opened in your browser for review.

They communicate over a loopback HTTP API plus a Server-Sent Events (SSE) stream
for real-time updates. State lives on disk under `.opencode/artifacts/` and is
mirrored in memory by the backend.

```
opencode agent ──▶ publish_artifact tool ──▶ store (disk + memory)
       ▲                                          │
       │ tool call blocks on a plan               │ broadcast (SSE)
       │ until a verdict arrives                   ▼
   tool.execute.before gate            HTTP server (127.0.0.1) ──▶ browser companion
```

## Plugin wiring & hooks — `src/index.ts`

`ArtifactsPlugin({ directory, client })` constructs the core services and
returns the opencode hooks:

- `createStore({ root: <directory>/.opencode/artifacts })` — artifact registry.
- `createBroadcaster()` — SSE fan-out (`src/events.ts`).
- `createServer({ store, events, token, port, staticDir, … })` — HTTP API +
  static companion (`src/server.ts`).
- `createPublishTool({ store, events, url, token, notify })` — the
  `publish_artifact` tool (`src/tools.ts`).

A per-session **capability token** (`crypto.randomUUID()`) is generated at
startup and passed to both the server and the tool. On the first publish, the
plugin opens the browser at `${server.url}/?token=…` (once; guarded by an
`opened` flag).

Registered hooks:

- **`chat.message`** — tracks the active opencode session and broadcasts
  `session.active` so the companion can highlight it.
- **`tool.execute.before`** — the hard gate (below). Throws to block a mutating
  tool call when there's no approved plan.
- **`experimental.chat.system.transform`** — every turn, injects the workflow
  contract and the live plan/roadmap blocks into the system prompt.
- **`experimental.session.compacting`** — re-injects the same plan/roadmap blocks
  into the compacted context so the plan survives compaction.
- **`dispose`** — rejects any parked verdict promises and stops the server.

`interruptSession` (wired to `client.session.abort`) is used to stop a parked
agent when its plan is **declined**.

## The workflow & gate — `src/workflow.ts`

The enforced flow is **plan → implement → report**, with large work decomposed
into a **roadmap** + per-phase cycles. The module is pure and unit-tested.

**The gate.** `isMutatingCall(tool, args)` returns true for `GATED_TOOLS`
(`write`, `edit`, `patch`) and for `bash` commands that `isMutatingBash` flags
(see below). `gateState(plan)` is `"open"` only when the session's active plan is
an **approved, non-roadmap, non-completed** plan. In `tool.execute.before`, a
mutating call with a closed gate throws an error whose message explains exactly
why it's blocked (no plan / roadmap approved but no phase plan / plan still in
review / plan completed by a report).

**Plan structure validation.** `validatePlanStructure(content, { roadmap })`
parses the markdown headings (skipping fenced code blocks) and requires a
canonical set of `##`/`###` sections — `REQUIRED_PLAN_SECTIONS`
(Context, Goals, Approach, Tasks, Verification) or `REQUIRED_ROADMAP_SECTIONS`
(Context, Goals, Phases). Each section accepts synonyms. On failure the tool
returns the missing sections plus a `PLAN_TEMPLATE`/`ROADMAP_TEMPLATE` skeleton.

**Context injection.** `buildWorkflowContract()` is a static rules block injected
every turn. `buildSessionContext(plan, content)` embeds the live plan and its
gate status; `buildDeclineContext(plan)` replaces it with a rejection notice when
the plan was declined; `buildRoadmapContext(roadmap, content, children)` adds the
roadmap and its phase list. `planContextBlocks(sessionID)` in `src/index.ts`
assembles these for both the system-prompt and compaction hooks — re-injecting
the plan each turn is what keeps it tracked across context compaction.

**Roadmaps & phases.** A roadmap is an approved decomposition that does *not*
open the gate. Phases are scratched as **drafts** (non-blocking), then each is
submitted for review, implemented, and reported on in turn.

## The bash gate — `src/bash-gate.ts`

`isMutatingBash(command)` decides whether a shell command looks like it writes to
the workspace, so read-only exploration stays unblocked while planning. It uses a
quote/operator-aware `tokenize()` that tracks command position and comparison
context (`[[ ]]`, `(( ))`). A command is treated as mutating when it contains:

- a write **redirect** (`>` / `>>`) outside a comparison (dup redirects like
  `>&2` and `&>` are ignored);
- a command-position word in `MUTATING_CMDS` (`rm`, `mv`, `cp`, `mkdir`, `rmdir`,
  `touch`, `truncate`, `dd`, `tee`, `chmod`, `chown`, `ln`);
- `sed` with an in-place flag (`-i` / `--in-place`);
- a **package manager** (`npm`, `pnpm`, `yarn`, `bun`, `pip`, `pip3`, `cargo`,
  `go`, `brew`) with an install/remove subcommand;
- a mutating **git** subcommand (`checkout`, `switch`, `apply`, `reset`,
  `restore`, `merge`, `rebase`, `stash`, `clean`, `rm`, `mv`) — with `checkout
  -b` / `switch -c` (branch creation) exempted.

**This is a cooperative heuristic, not a security boundary.** An agent that wants
to write a file can still do so via an interpreter (`node -e`, `python -c`),
which is deliberately not gated. The gate guards the intended workflow; it does
not sandbox the agent.

## Store & on-disk layout — `src/store.ts`, `src/types.ts`

**Model** (`src/types.ts`): an `Artifact` has `id`, `type` (`plan` | `report`),
`title`, `status`, `currentRevision`, timestamps, and optional `sessionID`,
`agent`, `parentId`, `isRoadmap`, `archived`, `completed`, `declineReason`. A
`Comment` is `anchor` or `general`, carries a `revision`, `body`, and `resolved`
flag. A `Verdict` is `approved` | `changes_requested` | `declined` (+ optional
reason and the comments carried to the agent). Statuses: `draft`,
`awaiting_review`, `approved`, `changes_requested`, `declined`, `published`.

**Disk layout** under `.opencode/artifacts/<id>/`:

```
meta.json            # the serialized Artifact
comments.json        # array of Comment
revisions/
  001.md             # content of revision 1
  002.md             # … zero-padded, one file per revision
```

In memory the store keeps `Map`s of artifacts, comments, and pending verdict
promises. `load()` rehydrates these from disk on startup, skipping any corrupt
entry rather than failing the whole load.

**Lifecycle** (`publish`):

- `draft: true` → a non-blocking `draft` (never the gate-governing plan).
- otherwise a plan enters `awaiting_review`; a report is `published`.
- Each publish writes a new revision file and bumps `currentRevision`. On a
  revision bump, prior comments are marked resolved (except when refining a draft,
  so early feedback still rides to the agent).
- A **new report** with a session is auto-linked (`parentId`) to that session's
  active plan; if that plan is standalone (not a phase) it's marked `completed`,
  re-closing the gate.
- An **approved plan is frozen** — re-publishing it is rejected unless
  `resubmit: true`, which clears `completed` and sends it back to review.

**Blocking.** When a plan is published for review, the tool calls
`awaitVerdict(id)`, which returns a promise that only resolves when the browser
posts a verdict (`resolveVerdict`) — there is **no timeout**. `getActivePlan`,
`getRoadmap`, `getLastCompletedPlan`, `getChildren`, and `getDescendants` are the
queries the gate and context injection rely on.

## HTTP API & realtime — `src/server.ts`, `src/events.ts`, `src/validate.ts`

`createServer` runs `Bun.serve` bound to `127.0.0.1`. Routes (all `/api/*`
require the capability token):

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/events` | SSE stream of `ServerEvent`s |
| GET | `/api/artifacts` | list all artifacts (with resolved session titles) |
| GET | `/api/artifacts/:id` | artifact meta + current content + comments |
| GET | `/api/artifacts/:id/revisions/:n` | a historical revision's content |
| POST | `/api/artifacts/:id/comments` | add a comment |
| PATCH | `/api/artifacts/:id/comments/:cid` | edit an unresolved comment |
| DELETE | `/api/artifacts/:id/comments/:cid` | delete an unresolved comment |
| POST | `/api/artifacts/:id/verdict` | approve / request changes / decline |
| POST | `/api/artifacts/:id/archive` | archive / unarchive (cascades) |
| DELETE | `/api/artifacts/:id` | delete an archived artifact (cascades) |
| _other_ | `/*` | static companion assets (SPA fallback) |

**Events** (`src/events.ts`): `artifact.published`, `artifact.updated`,
`artifact.archived`, `artifact.deleted`, `comment.added`, `comment.updated`,
`session.active`, `ping`. `createBroadcaster()` fans events out to SSE listeners
and drops any listener whose write throws (a closed connection).

**Validation** (`src/validate.ts`): request bodies are validated by hand-rolled,
dependency-free validators (`validateCommentInput`, `validateCommentEdit`,
`validateVerdictInput`, `validateArchiveInput`) — bad shapes get a `400` before
anything reaches the store. Free-text fields are capped at `MAX_TEXT` (10k).

## Security model

- **Loopback only** — `Bun.serve({ hostname: "127.0.0.1" })`, so the server isn't
  reachable from the LAN.
- **Capability token** — every `/api/*` request must present the per-session
  token: the `x-artifacts-token` header, or `?token=` for the SSE stream (which
  can't set headers). The companion captures the token from the URL the plugin
  opens, stores it in `sessionStorage`, and strips it from the address bar.
- **Origin check** — state-changing requests (POST/PATCH/DELETE) with a
  mismatched `Origin` are rejected (CSRF defense in depth behind the token).
- **Path safety** — `safeId` rejects ids containing `..`, `/`, or a leading `.`
  before any disk I/O, and static serving is constrained to the assets directory.

This protects the review server from the network, other local processes, and
cross-origin pages. It is **not** a sandbox for the agent itself — see the bash
gate caveat above.

## Anchored comments — `src/anchor.ts` ↔ `companion/src/anchor-dom.ts`

An anchor pins a comment to a span of text as `{ quote, prefix, suffix }` — the
selected text plus 32 characters of surrounding context. To re-locate it in a
later revision, `matchAnchor` finds all occurrences of the quote and, when there
are several, scores each candidate by how well the surrounding text matches the
stored prefix/suffix; if the quote no longer exists the anchor is **orphaned**
(the companion flags it rather than dropping it silently). The backend
(`src/anchor.ts`) and the DOM-aware frontend (`companion/src/anchor-dom.ts`)
implement the same algorithm with the same `CONTEXT` window and must be kept in
sync.

## Companion app — `companion/src/`

A React + Vite SPA. `App.tsx` holds the UI state (open tabs, active artifact,
viewed revision, SSE connection, unseen-activity set, pending anchor) and wires
the components together. It subscribes to `/api/events` once and reads live tab
state from refs so it never tears down the stream on a tab switch.

Key modules:

- `api.ts` — typed `fetch` client; attaches the token to every request.
- `token.ts` — captures `?token=` on load, persists to `sessionStorage`,
  strips it from the URL.
- `anchor-dom.ts` — DOM selection ↔ plain-text offsets, and anchor matching.
- `layoutPrefs.ts` / `theme.ts` — persisted rail widths, open tabs, tree
  collapse state, reading width, and system/light/dark theme.
- `shortcuts.ts` — the global keyboard layer.

Components (`companion/src/components/`):

- **ArtifactTree** — session-scoped explorer with nested roadmaps/phases/reports.
- **TabBar** — open-artifact tabs with unseen-activity dots.
- **ArtifactView** — renders the markdown, draws anchor highlights, and shows the
  floating Comment button on selection.
- **CommentThread** — add/edit/delete comments; resolved + orphaned states.
- **ActionBar** — Approve / Request changes / Decline (two-step decline).
- **RevisionSwitcher** — browse historical revisions.
- **CommandPalette** — `⌘/Ctrl-K` fuzzy jump to any artifact.
- **ShortcutHelp** — the `?` shortcut overlay.
- **Toaster** — transient success/error notifications.
- **ThemeToggle**, **ReadingWidthToggle**, **ResizeHandle** — layout controls.

## Repo layout & further reading

```
src/             backend plugin (store, server, workflow, gate, tools, anchors)
companion/       React review app (companion/dist is the prebuilt bundle)
docs/            this document + design specs
```

Design specs and the original implementation plans live under
`docs/superpowers/specs/` and `docs/superpowers/plans/` — useful for the
rationale behind individual features (anchored comments, comment auto-resolve,
session grouping, locked approved plans, read-only reports, the revision
switcher, and the companion restyle).
