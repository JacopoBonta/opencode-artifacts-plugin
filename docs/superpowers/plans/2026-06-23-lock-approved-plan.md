# Lock an Approved Plan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Once a plan is approved, close its review — the server rejects further comments/verdicts (409) and the companion renders the latest revision read-only with an "Approved — review closed" banner instead of the action bar.

**Architecture:** Two layers. The server guards `POST .../comments` and `POST .../verdict` against `approved` artifacts. The companion derives an `interactive` flag (`isLatest && status !== "approved"`) and reuses the existing read-only path for the locked view.

**Tech Stack:** TypeScript / Bun (`bun test`) for the server; React + Vite + Vitest for the companion.

---

## File Structure

- `src/server.ts` — MODIFY: reject comment/verdict POSTs when the artifact is `approved`.
- `src/server.test.ts` — ADD two guard tests.
- `companion/src/App.tsx` — MODIFY: `interactive` flag, read-only branch for approved-latest, approved banner.
- `companion/src/App.test.tsx` — ADD a locked-plan test.
- `companion/src/App.css` — ADD `.approved-banner` style.

---

## Task 1: Backend — reject mutations on an approved artifact

**Files:**
- Modify: `src/server.ts`
- Test: `src/server.test.ts`

- [ ] **Step 1: Write the failing tests** — append to `src/server.test.ts`:

```ts
test("posting a comment to an approved artifact returns 409", async () => {
  const { store, srv } = setup()
  const { artifact } = await store.publish({ type: "plan", title: "P", content: "x" })
  await store.resolveVerdict(artifact.id, { status: "approved" })
  const res = await fetch(`${srv.url}/api/artifacts/${artifact.id}/comments`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ revision: 1, kind: "general", body: "late comment" }),
  })
  expect(res.status).toBe(409)
})

test("posting a verdict to an approved artifact returns 409 and leaves status approved", async () => {
  const { store, srv } = setup()
  const { artifact } = await store.publish({ type: "plan", title: "P", content: "x" })
  await store.resolveVerdict(artifact.id, { status: "approved" })
  const res = await fetch(`${srv.url}/api/artifacts/${artifact.id}/verdict`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: "changes_requested" }),
  })
  expect(res.status).toBe(409)
  expect((await store.get(artifact.id))!.status).toBe("approved")
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/server.test.ts`
Expected: FAIL — both currently return 201 / 200 (no approved guard).

- [ ] **Step 3: Implement** — in `src/server.ts`, add an approved-guard right after the `safeId` check in each handler.

In the comments handler, change:

```ts
      const commentMatch = path.match(/^\/api\/artifacts\/([^/]+)\/comments$/)
      if (commentMatch && req.method === "POST") {
        const id = commentMatch[1]
        if (!safeId(id)) return json({ error: "not found" }, 404)
        let b: any
```

to:

```ts
      const commentMatch = path.match(/^\/api\/artifacts\/([^/]+)\/comments$/)
      if (commentMatch && req.method === "POST") {
        const id = commentMatch[1]
        if (!safeId(id)) return json({ error: "not found" }, 404)
        if ((await store.get(id))?.status === "approved") {
          return json({ error: "artifact approved" }, 409)
        }
        let b: any
```

In the verdict handler, change:

```ts
      const verdictMatch = path.match(/^\/api\/artifacts\/([^/]+)\/verdict$/)
      if (verdictMatch && req.method === "POST") {
        const id = verdictMatch[1]
        if (!safeId(id)) return json({ error: "not found" }, 404)
        let b: any
```

to:

```ts
      const verdictMatch = path.match(/^\/api\/artifacts\/([^/]+)\/verdict$/)
      if (verdictMatch && req.method === "POST") {
        const id = verdictMatch[1]
        if (!safeId(id)) return json({ error: "not found" }, 404)
        if ((await store.get(id))?.status === "approved") {
          return json({ error: "artifact approved" }, 409)
        }
        let b: any
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/server.test.ts`
Expected: PASS (all server tests, including the two new ones).

- [ ] **Step 5: Run the full backend suite + typecheck**

Run: `bun run test && bun run typecheck`
Expected: all pass; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/server.ts src/server.test.ts
git commit -m "feat: reject comments/verdicts on an approved artifact (409)"
```

---

## Task 2: Companion — lock the approved-plan view

**Files:**
- Modify: `companion/src/App.tsx`
- Modify: `companion/src/App.css`
- Test: `companion/src/App.test.tsx`

- [ ] **Step 1: Write the failing test** — append to `companion/src/App.test.tsx`:

```tsx
test("an approved plan is locked: no actions, no comment input, approved banner", async () => {
  vi.mocked(api.getArtifact).mockResolvedValue({
    artifact: { id: "id1", type: "plan", title: "P", status: "approved", currentRevision: 1, createdAt: 0, updatedAt: 0 },
    content: "# Approved Plan",
    comments: [{ id: "c1", revision: 1, kind: "general", body: "a note", resolved: false, createdAt: 0 }],
  })
  render(<App />)
  await waitFor(() => screen.getByRole("heading", { name: "Approved Plan" }))
  expect(screen.getByText(/approved — review closed/i)).toBeInTheDocument()
  expect(screen.queryByRole("button", { name: /approve/i })).toBeNull()
  expect(screen.queryByRole("button", { name: /request changes/i })).toBeNull()
  expect(screen.queryByPlaceholderText("Add a comment")).toBeNull()
  expect(screen.getByText("a note")).toBeInTheDocument()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd companion && bun run test src/App.test.tsx`
Expected: FAIL — the action bar + comment input still render for an approved plan; no approved banner exists.

- [ ] **Step 3: Implement** — edit `companion/src/App.tsx`.

(a) Add the `interactive` derivation next to the existing `isLatest` line:

```tsx
  const total = detail?.artifact.currentRevision ?? 0
  const viewing = viewedRevision ?? total
  const isLatest = viewing === total
  const interactive = isLatest && detail?.artifact.status !== "approved"
  const revisionComments = detail
    ? (isLatest ? detail.comments : detail.comments.filter((c) => c.revision === viewing))
    : []
```

(b) Add the approved banner just after the historical-banner block in the `<main>`:

```tsx
            {!isLatest && (
              <div className="historical-banner">
                <span>Revision {viewing} of {total} (historical)</span>
                <button type="button" onClick={() => pickRevision(total)}>Back to latest</button>
              </div>
            )}
            {isLatest && detail.artifact.status === "approved" && (
              <div className="approved-banner">✓ Approved — review closed</div>
            )}
```

(c) Change the `ArtifactView`'s `onAnchor` to gate on `interactive`:

```tsx
              onAnchor={interactive ? setPendingAnchor : () => {}}
```

(d) Change the comments-rail branch condition from `isLatest` to `interactive`, and make the read-only title revision-aware. Replace the whole comments-rail body:

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
                  type={detail.artifact.type}
                  onApprove={() => verdict("approved")}
                  onRequestChanges={() => verdict("changes_requested")}
                  onRefine={() => verdict("refine")}
                />
              </>
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

Note: reports keep working — a report's status is `published` (never `approved`), so `interactive` stays true and its `ActionBar` (Request refinement) and comment input remain.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd companion && bun run test src/App.test.tsx`
Expected: PASS (all App tests, including the new one).

- [ ] **Step 5: Add the style** — append to `companion/src/App.css`:

```css
.approved-banner { margin-bottom: 12px; padding: 6px 10px; border-radius: 6px; background: #ecfdf5; color: #065f46; font-size: 13px; }
```

- [ ] **Step 6: Run the full companion suite + typecheck + build**

Run: `cd companion && bun run test && bunx tsc --noEmit -p tsconfig.json && bun run build`
Expected: all companion tests PASS; typecheck clean; `dist/` produced.

- [ ] **Step 7: Commit**

```bash
git add companion/src/App.tsx companion/src/App.css companion/src/App.test.tsx
git commit -m "feat: lock the review UI once a plan is approved"
```

---

## Self-Review Notes

- **Spec coverage:** server 409 on comment + verdict for approved (Task 1, both handlers + both tests, including status-unchanged assertion); companion `interactive = isLatest && status !== "approved"` (Task 2a); read-only branch reused for approved-latest with no ActionBar and no comment input (Task 2d); no-op `onAnchor` blocks comment creation (Task 2c); approved banner (Task 2b + style); existing comments still visible read-only (Task 2 test asserts "a note"); reports unaffected (noted in Task 2d — `published` ≠ `approved`).
- **Type consistency:** uses existing `ArtifactStatus` value `"approved"` and the `interactive`/`isLatest`/`revisionComments` locals already present from the revision-switcher work; `CommentThread`/`ArtifactView` props (`readOnly`, `onCommentClick`, `flashCommentId`, `flashKey`, `onAnchor`) match their current signatures.
- **No placeholders:** every code step is complete and runnable.
