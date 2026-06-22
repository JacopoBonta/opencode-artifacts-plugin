# opencode Artifacts Plugin — Design

**Date:** 2026-06-22
**Status:** Approved (design)

## Summary

An opencode plugin that lets an agent generate **artifacts** (plans/specs and
walkthroughs/reports) and lets the user **comment, request refinement, and
approve** them through a browser-based companion GUI — bringing Google
Antigravity's artifact-review experience to opencode.

opencode's TUI cannot render custom UI, so the review surface is a separate,
auto-opened **browser companion** (React + Vite, prebuilt). The plugin is the
hub: it registers the agent-facing tools, runs a local HTTP + SSE server that
serves the companion and its API, and persists artifacts to disk.

## Goals

- Agent can publish two artifact types: **plan** (gates the work) and
  **report** (after-the-fact).
- **Plans block** the agent until the user approves or requests changes;
  **reports are non-blocking**.
- User reviews artifacts in a browser with **inline anchored comments**
  (Google-Docs style) plus a general comment box, and **Approve /
  Request-changes** actions.
- Refinement loop: requested changes flow back to the agent, which revises and
  re-publishes a new revision.

## Non-goals

- Rendering review UI inside the opencode TUI (not supported by the platform).
- Code-diff or freeform-document artifacts (only plans/specs and
  walkthroughs/reports are in scope).
- A hosted/multi-user service — this is a localhost, single-user companion.

## Platform constraints (opencode plugin reality)

Confirmed against `@opencode-ai/plugin` / `@opencode-ai/sdk` v1.17.9:

- Plugins are TS/JS ES modules loaded from `.opencode/plugins/` (or config).
- Plugins **register custom tools** (zod-schema'd via `tool.schema`).
- Plugins get an SDK `client` (sessions, files, `tui.showToast`,
  `tui.appendPrompt`, `session.prompt`) and Bun `$`.
- **No custom TUI rendering**, **no first-class plugin slash commands**, **no
  built-in KV store** — persistence is file-based.
- opencode runs an HTTP server; the companion talks to the plugin's own server.

## Architecture

```
┌─────────────── opencode (terminal) ───────────────┐
│  Agent turn → calls custom tool publish_artifact() │
│   ┌────────────────────────────────────────────┐  │
│   │  Plugin (TS module)                          │  │
│   │   • registers custom tool(s)                 │  │
│   │   • runs local HTTP + SSE server (Bun)       │  │
│   │   • in-memory review state + pending promises│  │
│   │   • persists to .opencode/artifacts/         │  │
│   └───────────────────────┬──────────────────────┘  │
└───────────────────────────┼──────────────────────────┘
                            │ HTTP / SSE (localhost)
                   ┌────────┴─────────┐
                   │ Browser companion │  React + Vite (prebuilt)
                   │  • render artifact │
                   │  • inline comments │
                   │  • approve/changes │
                   └────────────────────┘
```

## Components (plugin side)

- `index.ts` — plugin entry: start server, register tools, wire `dispose()`.
- `server.ts` — Bun HTTP server: serves prebuilt React assets + JSON/SSE API;
  picks a free port.
- `store.ts` — artifact persistence + in-memory state; owns on-disk layout and
  the map of pending review promises.
- `tools.ts` — custom tool definitions (zod-schema'd).
- `events.ts` — SSE broadcast helper (push artifact/comment updates to browsers).

## Agent-facing tool

A single tool, type-switched:

```
publish_artifact({
  type: "plan" | "report",
  title: string,
  content: string,          // markdown
  artifactId?: string       // omit = create new; pass = add a revision
})
```

- `type: "plan"` → **blocks**; returns
  `{ status: "approved" }` or
  `{ status: "changes_requested", comments: [...] }`
  (comments carry anchored text + body, plus general notes).
- `type: "report"` → returns immediately: `{ artifactId, url }`.

## Data model

On-disk layout (persists across restarts; git-reviewable if desired):

```
.opencode/artifacts/
  <artifactId>/
    meta.json              # type, title, status, current revision, timestamps
    revisions/
      001.md               # each published revision's markdown
      002.md
    comments.json          # anchored + general comments, per revision, resolved state
```

Comment shape:

```
{
  id, revision, kind: "anchor" | "general",
  anchor?: { quote: string, prefix: string, suffix: string },  // text-based anchor
  body: string, resolved: boolean, createdAt
}
```

Comments are anchored by **quoted text + surrounding context** (not line
numbers) so anchors survive small edits between revisions and degrade to an
"orphaned" state if the quoted text disappears.

## Browser companion (React + Vite, prebuilt)

- **Left rail:** artifact list with type badges and status (awaiting review /
  approved / changes requested).
- **Main pane:** rendered markdown of the selected revision. Select text → a
  floating "Comment" button anchors a thread to that quote. Existing anchors are
  highlighted; clicking opens the thread.
- **Right rail / footer:** general comment box + thread list, a revision
  switcher (compare 001 vs 002), and the action bar — **Approve /
  Request changes** (plans) or **Request refinement** (reports).
- **Live updates via SSE:** new revisions appear in the open tab in place.

## Data flow

**Plan (blocking):**
1. Agent calls `publish_artifact(type:"plan", ...)`.
2. `tools.ts` → `store.ts` writes revision + meta; creates a pending promise
   keyed by `artifactId`; `events.ts` broadcasts `artifact.published` over SSE;
   `client.tui.showToast("Plan awaiting review → <url>")`; browser opened on
   first publish.
3. User comments (`POST /api/artifacts/:id/comments`) and clicks
   Approve/Request-changes (`POST /api/artifacts/:id/verdict`).
4. Verdict handler resolves the pending promise → tool returns verdict +
   unresolved comments to the agent.
5. On changes-requested, agent revises and calls `publish_artifact` again with
   the same `artifactId` → revision 002 → loop.

**Report (non-blocking):** same publish, tool resolves immediately. "Request
refinement" in the browser calls `client.session.prompt()` (or
`tui.appendPrompt`) to start a new turn referencing the artifact + comments.

## Error handling

- **Port in use / can't bind:** try a port range; if all fail, degrade to
  writing the file + a toast with the path (no GUI) so the agent isn't blocked.
- **No browser opens (headless/remote):** toast + log the URL for manual open.
- **Agent abort / session ends while a plan is pending:** `dispose()` rejects
  pending promises cleanly (no zombie tool calls); state remains on disk.
- **Orphaned anchors after edits:** shown as orphaned, not dropped.
- **Concurrent reviews:** state keyed by `artifactId`; multiple pending plans
  are independent.

## Testing strategy

- **Unit:** `store.ts` (persistence round-trip, revision bump, anchor matching
  incl. orphan detection); SSE/event helper. Pure logic, no opencode needed.
- **API:** spin the HTTP server, hit endpoints (publish → comment → verdict
  resolves the promise) with a fake clock.
- **Tool contract:** call `publish_artifact` against a mocked store/server,
  assert blocking vs non-blocking return shapes.
- **Companion:** component tests for markdown render + anchor-on-selection
  logic; one end-to-end happy path (publish → comment → approve → tool resolves)
  driving the real server.

## Open questions / future

- Diff view between revisions (nice-to-have; revision switcher is in scope).
- Distribution as an npm package with the prebuilt companion bundled.
