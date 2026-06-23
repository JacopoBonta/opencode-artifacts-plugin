# Reports Are Read-Only Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make report artifacts read-only — no commenting or actions in the companion — and remove the now-defunct "Request refinement" pathway, while plans are unchanged and agents still publish reports.

**Architecture:** The server rejects browser comment/verdict POSTs to reports (409) and drops the `refine` branch + `onRefine` option; the plugin drops the refinement handler. The companion treats only non-approved latest **plans** as interactive; reports show a read-only note, and `ActionBar` is simplified to plan-only.

**Tech Stack:** TypeScript / Bun (`bun test`) for the server; React + Vite + Vitest for the companion.

---

## File Structure

- `src/server.ts` — MODIFY: reject reports (and approved) on comment/verdict; remove `refine` branch + `onRefine` option + unused `Comment` import.
- `src/server.test.ts` — MODIFY: drop `onRefine` from `setup()`, remove the refine test, add two report-409 tests.
- `src/index.ts` — MODIFY: remove the `onRefine` handler, `lastSessionID`, and the `event` hook.
- `companion/src/components/ActionBar.tsx` — MODIFY: plan-only (drop `type`/`onRefine`).
- `companion/src/components/ActionBar.test.tsx` — MODIFY: plan-only test.
- `companion/src/api.ts` — MODIFY: narrow `postVerdict` status.
- `companion/src/App.tsx` — MODIFY: `interactive` requires a plan; report read-only note; drop `refine`.
- `companion/src/App.test.tsx` — ADD a report-read-only test.

---

## Task 1: Backend — reject report mutations, remove refinement

**Files:**
- Modify: `src/server.ts`, `src/index.ts`
- Test: `src/server.test.ts`

- [ ] **Step 1: Update `src/server.test.ts`.**

(a) Replace the `setup()` function (drop the `onRefine`/`refine` wiring) with:

```ts
function setup() {
  const dir = mkdtempSync(join(tmpdir(), "artifacts-"))
  const store = createStore({ root: dir, clock: () => 1, idgen: (() => { let n = 0; return () => `id${++n}` })() })
  const events = createBroadcaster()
  const srv = createServer({ store, events, port: 0, staticDir: null })
  stop = srv.stop
  return { store, events, srv }
}
```

(b) Delete the entire test titled **"POST verdict {refine} on a report triggers onRefine"**.

(c) Append two new tests:

```ts
test("posting a comment to a report returns 409 (reports are read-only)", async () => {
  const { store, srv } = setup()
  const { artifact } = await store.publish({ type: "report", title: "R", content: "done" })
  const res = await fetch(`${srv.url}/api/artifacts/${artifact.id}/comments`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ revision: 1, kind: "general", body: "nope" }),
  })
  expect(res.status).toBe(409)
})

test("posting a verdict to a report returns 409", async () => {
  const { store, srv } = setup()
  const { artifact } = await store.publish({ type: "report", title: "R", content: "done" })
  const res = await fetch(`${srv.url}/api/artifacts/${artifact.id}/verdict`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: "changes_requested" }),
  })
  expect(res.status).toBe(409)
})
```

- [ ] **Step 2: Run tests to verify failure**

Run: `bun test src/server.test.ts`
Expected: the two new tests FAIL (reports currently accept comments/verdicts) — and a TypeScript error is acceptable here since `onRefine` was removed from `setup()` (the next step removes the option). If Bun reports a type/lint issue rather than a clean fail, proceed to Step 3 and re-run.

- [ ] **Step 3: Edit `src/server.ts`.**

(a) Remove the unused import line `import type { Comment } from "./types"`.

(b) In `ServerOptions`, delete the `onRefine` field (the comment line and the property):

```ts
  /** called when a report's "request refinement" verdict arrives */
  onRefine?: (artifactId: string, comments: Comment[]) => void
```

(c) In the **comments** handler, replace the approved-only guard:

```ts
        if ((await store.get(id))?.status === "approved") {
          return json({ error: "artifact approved" }, 409)
        }
```

with a read-only guard (approved plan OR any report):

```ts
        const ca = await store.get(id)
        if (ca && (ca.status === "approved" || ca.type === "report")) {
          return json({ error: "read-only artifact" }, 409)
        }
```

(d) In the **verdict** handler, replace the approved-only guard:

```ts
        if ((await store.get(id))?.status === "approved") {
          return json({ error: "artifact approved" }, 409)
        }
```

with:

```ts
        const va = await store.get(id)
        if (va && (va.status === "approved" || va.type === "report")) {
          return json({ error: "read-only artifact" }, 409)
        }
```

(e) In the **verdict** handler, delete the now-unreachable `refine` branch:

```ts
        if (b.status === "refine") {
          const comments = (await store.getComments(id)).filter((c) => !c.resolved)
          opts.onRefine?.(id, comments)
          events.broadcast({ type: "artifact.updated", id })
          return json({ ok: true })
        }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/server.test.ts`
Expected: PASS (all server tests, including the two new report-409 tests).

- [ ] **Step 5: Edit `src/index.ts` — remove the refinement wiring.**

(a) Delete the line:

```ts
  let lastSessionID: string | undefined
```

(b) In the `createServer({...})` call, remove the entire `onRefine: async (id, comments) => { ... },` property so the call reads exactly:

```ts
  const server = createServer({
    store,
    events,
    port: Number(process.env.OPENCODE_ARTIFACTS_PORT ?? 0),
    staticDir: existsSync(staticDir) ? staticDir : null,
  })
```

(c) Replace the returned hooks object (removing the `event` hook):

```ts
  return {
    tool: { publish_artifact: tool },
    dispose: async () => {
      store.disposeAll()
      server.stop()
    },
  }
```

- [ ] **Step 6: Run the full backend suite + typecheck**

Run: `bun run test && bun run typecheck`
Expected: all pass; typecheck clean (no unused `Comment`/`onRefine`/`lastSessionID` references remain).

- [ ] **Step 7: Commit**

```bash
git add src/server.ts src/server.test.ts src/index.ts
git commit -m "feat: reports are read-only on the server; remove the refinement pathway"
```

---

## Task 2: Companion — read-only reports + plan-only ActionBar

**Files:**
- Modify: `companion/src/components/ActionBar.tsx`, `companion/src/components/ActionBar.test.tsx`
- Modify: `companion/src/api.ts`, `companion/src/App.tsx`
- Test: `companion/src/App.test.tsx`

- [ ] **Step 1: Replace `companion/src/components/ActionBar.test.tsx`** (plan-only):

```tsx
import { test, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { ActionBar } from "./ActionBar"

test("renders Approve + Request changes and fires their callbacks", async () => {
  const onApprove = vi.fn(), onChanges = vi.fn()
  render(<ActionBar onApprove={onApprove} onRequestChanges={onChanges} />)
  await userEvent.click(screen.getByRole("button", { name: /approve/i }))
  expect(onApprove).toHaveBeenCalled()
  await userEvent.click(screen.getByRole("button", { name: /request changes/i }))
  expect(onChanges).toHaveBeenCalled()
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd companion && bun run test src/components/ActionBar.test.tsx`
Expected: FAIL — `ActionBar` still requires `type`/`onRefine` (TS) and renders differently.

- [ ] **Step 3: Replace `companion/src/components/ActionBar.tsx`** (plan-only):

```tsx
import React from "react"

export function ActionBar(props: {
  onApprove: () => void
  onRequestChanges: () => void
}) {
  return (
    <div className="action-bar">
      <button onClick={props.onApprove}>Approve</button>
      <button onClick={props.onRequestChanges}>Request changes</button>
    </div>
  )
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd companion && bun run test src/components/ActionBar.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 5: Narrow `postVerdict` in `companion/src/api.ts`.** Change:

```ts
export async function postVerdict(
  id: string,
  status: "approved" | "changes_requested" | "refine",
): Promise<void> {
  await fetch(`/api/artifacts/${id}/verdict`, jsonPost({ status }))
}
```

to:

```ts
export async function postVerdict(
  id: string,
  status: "approved" | "changes_requested",
): Promise<void> {
  await fetch(`/api/artifacts/${id}/verdict`, jsonPost({ status }))
}
```

- [ ] **Step 6: Write the failing App test** — append to `companion/src/App.test.tsx`:

```tsx
test("a report is read-only: no comment input, no action buttons, shows the read-only note", async () => {
  vi.mocked(api.listArtifacts).mockResolvedValue([
    { id: "id1", type: "report", title: "R", status: "published", currentRevision: 1, createdAt: 0, updatedAt: 0 },
  ])
  vi.mocked(api.getArtifact).mockResolvedValue({
    artifact: { id: "id1", type: "report", title: "R", status: "published", currentRevision: 1, createdAt: 0, updatedAt: 0 },
    content: "# Report Body",
    comments: [],
  })
  render(<App />)
  await waitFor(() => screen.getByRole("heading", { name: "Report Body" }))
  expect(screen.queryByPlaceholderText("Add a comment")).toBeNull()
  expect(screen.queryByRole("button", { name: /approve/i })).toBeNull()
  expect(screen.queryByRole("button", { name: /request changes/i })).toBeNull()
  expect(screen.queryByRole("button", { name: /request refinement/i })).toBeNull()
  expect(screen.getByText(/agent report — read-only/i)).toBeInTheDocument()
})
```

- [ ] **Step 7: Run to verify failure**

Run: `cd companion && bun run test src/App.test.tsx`
Expected: FAIL — a report currently renders the interactive block (comment input + Request refinement), and there's no read-only note.

- [ ] **Step 8: Edit `companion/src/App.tsx`.**

(a) Narrow the `verdict` function signature:

```tsx
  async function verdict(status: "approved" | "changes_requested") {
    if (!detail) return
    await api.postVerdict(detail.artifact.id, status)
    refreshDetail(detail.artifact.id)
  }
```

(b) Change the `interactive` derivation to require a plan:

```tsx
  const interactive = isLatest && detail?.artifact.type === "plan" && detail?.artifact.status !== "approved"
```

(c) Replace the comments-rail body (the `{detail && (...)}` inner content) with a three-way branch and a plan-only `ActionBar`:

```tsx
        {detail && (
          <>
            {interactive ? (
              <>
                {pendingAnchor && (
                  <div className="pending-anchor">
                    Commenting on: <blockquote>{pendingAnchor.quote}</blockquote>
                  </div>
                )}
                <CommentThread
                  title="Comments"
                  comments={detail.comments}
                  onAdd={(body) => addComment(body, pendingAnchor)}
                  onCommentClick={onCommentClick}
                  flashCommentId={flashComment?.id}
                  flashKey={flashComment?.key}
                />
                <ActionBar
                  onApprove={() => verdict("approved")}
                  onRequestChanges={() => verdict("changes_requested")}
                />
              </>
            ) : detail.artifact.type === "report" ? (
              <p className="empty">Agent report — read-only.</p>
            ) : (
              <CommentThread
                title={isLatest ? "Comments" : `Comments · revision ${viewing}`}
                comments={revisionComments}
                onAdd={() => {}}
                readOnly
                onCommentClick={onCommentClick}
                flashCommentId={flashComment?.id}
                flashKey={flashComment?.key}
              />
            )}
          </>
        )}
```

- [ ] **Step 9: Run the full companion suite + typecheck + build**

Run: `cd companion && bun run test && bunx tsc --noEmit -p tsconfig.json && bun run build`
Expected: all companion tests PASS (including the new report test; the existing "clicking another artifact" test still passes — the report just renders read-only); typecheck clean; `dist/` produced.

- [ ] **Step 10: Commit**

```bash
git add companion/src/components/ActionBar.tsx companion/src/components/ActionBar.test.tsx companion/src/api.ts companion/src/App.tsx companion/src/App.test.tsx
git commit -m "feat: reports are read-only in the companion; ActionBar is plan-only"
```

---

## Self-Review Notes

- **Spec coverage:** server rejects report comment + verdict (Task 1 c/d + tests); refine branch + `onRefine` + `Comment` import removed (Task 1 a/b/e); `index.ts` refinement wiring removed (Task 1 step 5); companion `interactive` requires a plan + report read-only note + no `onAnchor` commenting (Task 2 b/c — `onAnchor` already gated on `interactive` upstream, unchanged); `ActionBar` plan-only (Task 2 step 3); `postVerdict` narrowed (Task 2 step 5); reports still published by the unchanged `publish_artifact` tool (no task needed). Tests: server report-409 ×2, App report-read-only, ActionBar plan-only; refine tests removed.
- **Type consistency:** `verdict`/`postVerdict` both use `"approved" | "changes_requested"`; `ActionBar` props (`onApprove`, `onRequestChanges`) match the App call site; the report read-only note text "Agent report — read-only." matches the App test query.
- **No placeholders:** every step is a concrete edit with the exact code.
- **Note:** the existing App test "clicking another artifact in the list selects it" selects a report (`id2`) and only asserts the heading renders — still valid, since a report renders read-only with the document visible.
