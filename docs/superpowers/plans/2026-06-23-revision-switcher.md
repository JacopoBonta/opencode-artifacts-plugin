# Revision Switcher (Read-Only History) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the companion navigate to any prior revision of an artifact via a dropdown and view it read-only — its content, its comments, and its anchor highlights — while the latest revision stays fully interactive.

**Architecture:** Companion-only change. The server already serves any revision (`GET /api/artifacts/:id/revisions/:n`), returns all comments (each tagged with `revision`), and exposes `artifact.currentRevision` as the count. The companion adds a `RevisionSwitcher`, fetches historical content on demand, and renders a read-only path for non-latest revisions.

**Tech Stack:** React + Vite + Vitest + @testing-library/react (run from `companion/`).

---

## File Structure

- `companion/src/api.ts` — ADD `getRevision(id, n)`.
- `companion/src/api.test.ts` — ADD test for `getRevision`.
- `companion/src/components/RevisionSwitcher.tsx` — CREATE dropdown component.
- `companion/src/components/RevisionSwitcher.test.tsx` — CREATE tests.
- `companion/src/components/ArtifactView.tsx` — ADD `highlightResolved` prop.
- `companion/src/components/ArtifactView.highlight.test.tsx` — ADD test for `highlightResolved`.
- `companion/src/components/CommentThread.tsx` — ADD `readOnly` prop.
- `companion/src/components/CommentThread.test.tsx` — ADD test for `readOnly`.
- `companion/src/App.tsx` — wire revision state, switcher, historical fetch, read-only view, banner.
- `companion/src/App.test.tsx` — ADD revision-switch integration test.
- `companion/src/App.css` — ADD switcher + banner styles.

All commands run from `companion/`.

---

## Task 1: `api.getRevision`

**Files:**
- Modify: `companion/src/api.ts`
- Test: `companion/src/api.test.ts`

- [ ] **Step 1: Write the failing test** — append to `companion/src/api.test.ts`, and add `getRevision` to the import on line 2 (`import { listArtifacts, getArtifact, postComment, postVerdict, getRevision } from "./api"`):

```tsx
test("getRevision GETs the revision endpoint", async () => {
  const fetchMock = vi.fn().mockResolvedValue({ json: async () => ({ content: "# rev 2" }) })
  vi.stubGlobal("fetch", fetchMock)
  const out = await getRevision("id1", 2)
  expect(fetchMock).toHaveBeenCalledWith("/api/artifacts/id1/revisions/2")
  expect(out).toEqual({ content: "# rev 2" })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test src/api.test.ts`
Expected: FAIL — `getRevision` is not exported.

- [ ] **Step 3: Implement** — add to `companion/src/api.ts` (after `getArtifact`):

```ts
export async function getRevision(id: string, n: number): Promise<{ content: string }> {
  return (await fetch(`/api/artifacts/${id}/revisions/${n}`)).json()
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test src/api.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add companion/src/api.ts companion/src/api.test.ts
git commit -m "feat: companion api.getRevision"
```

---

## Task 2: `RevisionSwitcher` component

**Files:**
- Create: `companion/src/components/RevisionSwitcher.tsx`
- Test: `companion/src/components/RevisionSwitcher.test.tsx`

- [ ] **Step 1: Write the failing test** — create `companion/src/components/RevisionSwitcher.test.tsx`:

```tsx
import { test, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { RevisionSwitcher } from "./RevisionSwitcher"

test("renders an option per revision and fires onSelect", async () => {
  const onSelect = vi.fn()
  render(<RevisionSwitcher total={3} viewing={3} onSelect={onSelect} />)
  const select = screen.getByRole("combobox", { name: /revision/i })
  expect(screen.getAllByRole("option")).toHaveLength(3)
  await userEvent.selectOptions(select, "1")
  expect(onSelect).toHaveBeenCalledWith(1)
})

test("renders nothing when there is only one revision", () => {
  const { container } = render(<RevisionSwitcher total={1} viewing={1} onSelect={() => {}} />)
  expect(container.firstChild).toBeNull()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test src/components/RevisionSwitcher.test.tsx`
Expected: FAIL — cannot find module `./RevisionSwitcher`.

- [ ] **Step 3: Implement** — create `companion/src/components/RevisionSwitcher.tsx`:

```tsx
import React from "react"

export function RevisionSwitcher(props: {
  total: number              // total number of revisions (M)
  viewing: number            // currently viewed revision (1..M)
  onSelect: (n: number) => void
}) {
  if (props.total <= 1) return null
  const options = Array.from({ length: props.total }, (_, i) => i + 1)
  return (
    <select
      className="revision-switcher"
      aria-label="Revision"
      value={props.viewing}
      onChange={(e) => props.onSelect(Number(e.target.value))}
    >
      {options.map((n) => (
        <option key={n} value={n}>
          Revision {n} of {props.total}
        </option>
      ))}
    </select>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test src/components/RevisionSwitcher.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add companion/src/components/RevisionSwitcher.tsx companion/src/components/RevisionSwitcher.test.tsx
git commit -m "feat: RevisionSwitcher dropdown component"
```

---

## Task 3: `ArtifactView` `highlightResolved` prop

The historical view needs to highlight a revision's (resolved) anchored comments. Add an opt-in prop; the default preserves today's behavior (skip resolved).

**Files:**
- Modify: `companion/src/components/ArtifactView.tsx`
- Test: `companion/src/components/ArtifactView.highlight.test.tsx`

- [ ] **Step 1: Write the failing test** — append to `companion/src/components/ArtifactView.highlight.test.tsx`:

```tsx
test("with highlightResolved, a resolved anchored comment IS highlighted", async () => {
  const resolved: Comment[] = [
    { id: "r2", revision: 1, kind: "anchor", anchor: { quote: "step one", prefix: "", suffix: "" }, body: "historical note", resolved: true, createdAt: 0 },
  ]
  render(<ArtifactView content={"# Plan\n\nstep one here"} comments={resolved} onAnchor={() => {}} highlightResolved />)
  await waitFor(() => {
    const marks = document.querySelectorAll("mark.anchor-highlight")
    expect(marks.length).toBe(1)
    expect(marks[0].textContent).toBe("step one")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test src/components/ArtifactView.highlight.test.tsx`
Expected: FAIL — `highlightResolved` is not a known prop; the resolved comment is skipped, so 0 marks are found.

- [ ] **Step 3: Implement** — in `companion/src/components/ArtifactView.tsx`:

Add the prop to the component signature:

```tsx
export function ArtifactView(props: {
  content: string
  comments: Comment[]
  onAnchor: (anchor: Anchor) => void
  highlightResolved?: boolean
}) {
```

Change the highlight loop guard inside the `useEffect` from:

```tsx
    for (const comment of props.comments) {
      if (comment.kind !== "anchor" || !comment.anchor || comment.resolved) continue
      const offsets = findAnchorOffsets(text, comment.anchor)
      if (!offsets) continue
      wrapRange(ref.current, offsets.start, offsets.end, comment.body)
    }
```

to:

```tsx
    for (const comment of props.comments) {
      if (comment.kind !== "anchor" || !comment.anchor) continue
      if (comment.resolved && !props.highlightResolved) continue
      const offsets = findAnchorOffsets(text, comment.anchor)
      if (!offsets) continue
      wrapRange(ref.current, offsets.start, offsets.end, comment.body)
    }
```

And add `props.highlightResolved` to the effect's dependency array:

```tsx
  }, [props.content, props.comments, props.highlightResolved])
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test src/components/ArtifactView.highlight.test.tsx`
Expected: PASS (6 tests — the existing "resolved are NOT highlighted" test still passes because it omits `highlightResolved`).

- [ ] **Step 5: Commit**

```bash
git add companion/src/components/ArtifactView.tsx companion/src/components/ArtifactView.highlight.test.tsx
git commit -m "feat: ArtifactView highlightResolved opt-in for historical views"
```

---

## Task 4: `CommentThread` `readOnly` prop

**Files:**
- Modify: `companion/src/components/CommentThread.tsx`
- Test: `companion/src/components/CommentThread.test.tsx`

- [ ] **Step 1: Write the failing test** — append to `companion/src/components/CommentThread.test.tsx`:

```tsx
test("readOnly hides the input and lists all comments flat", () => {
  const mixed: Comment[] = [
    { id: "a", revision: 1, kind: "general", body: "one", resolved: false, createdAt: 0 },
    { id: "b", revision: 1, kind: "general", body: "two", resolved: true, createdAt: 0 },
  ]
  render(<CommentThread comments={mixed} onAdd={() => {}} readOnly />)
  expect(screen.getByText("one")).toBeInTheDocument()
  expect(screen.getByText("two")).toBeInTheDocument()
  expect(screen.queryByPlaceholderText("Add a comment")).toBeNull()
  expect(screen.queryByRole("button", { name: /resolved \(/i })).toBeNull()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test src/components/CommentThread.test.tsx`
Expected: FAIL — with `readOnly` ignored, the resolved comment "two" is hidden behind the toggle (not shown), and the "Add a comment" textarea is still present.

- [ ] **Step 3: Implement** — in `companion/src/components/CommentThread.tsx`, add `readOnly` to the props type and an early read-only branch before the interactive return. The `CommentItem` helper at the top of the file is reused. The full file becomes:

```tsx
import React, { useState } from "react"
import type { Comment } from "../api"

function CommentItem({ c }: { c: Comment }) {
  return (
    <div className={`comment${c.resolved ? " resolved" : ""}`}>
      {c.anchor?.quote && <blockquote>{c.anchor.quote}</blockquote>}
      <p>{c.body}</p>
    </div>
  )
}

export function CommentThread(props: {
  comments: Comment[]
  onAdd: (body: string) => void
  title?: string
  readOnly?: boolean
}) {
  const [draft, setDraft] = useState("")
  const [showResolved, setShowResolved] = useState(false)

  if (props.readOnly) {
    return (
      <div className="comment-thread">
        {props.title && <h4>{props.title}</h4>}
        {props.comments.length === 0 && <p className="empty">No comments on this revision.</p>}
        {props.comments.map((c) => <CommentItem key={c.id} c={c} />)}
      </div>
    )
  }

  const active = props.comments.filter((c) => !c.resolved)
  const resolved = props.comments.filter((c) => c.resolved)

  return (
    <div className="comment-thread">
      {props.title && <h4>{props.title}</h4>}

      {active.map((c) => <CommentItem key={c.id} c={c} />)}

      {resolved.length > 0 && (
        <div className="resolved-section">
          <button
            type="button"
            className="resolved-toggle"
            onClick={() => setShowResolved((s) => !s)}
          >
            {showResolved ? "▾" : "▸"} Resolved ({resolved.length})
          </button>
          {showResolved && resolved.map((c) => <CommentItem key={c.id} c={c} />)}
        </div>
      )}

      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Add a comment"
      />
      <button
        onClick={() => { if (draft.trim()) { props.onAdd(draft.trim()); setDraft("") } }}
      >
        Comment
      </button>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test src/components/CommentThread.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add companion/src/components/CommentThread.tsx companion/src/components/CommentThread.test.tsx
git commit -m "feat: CommentThread readOnly flat list for historical views"
```

---

## Task 5: App wiring — switcher, historical fetch, read-only view, banner

**Files:**
- Modify: `companion/src/App.tsx`
- Modify: `companion/src/App.css`
- Test: `companion/src/App.test.tsx`

- [ ] **Step 1: Write the failing test** — in `companion/src/App.test.tsx`: (a) add `getRevision` spy to `beforeEach`, and (b) append the integration test.

In the existing `beforeEach`, add this line (alongside the other `vi.spyOn` calls):

```tsx
  vi.spyOn(api, "getRevision").mockResolvedValue({ content: "" })
```

Then append:

```tsx
test("switching to an older revision shows read-only history; back to latest restores actions", async () => {
  vi.mocked(api.listArtifacts).mockResolvedValue([
    { id: "id1", type: "plan", title: "P", status: "awaiting_review", currentRevision: 2, createdAt: 0, updatedAt: 0 },
  ])
  vi.mocked(api.getArtifact).mockResolvedValue({
    artifact: { id: "id1", type: "plan", title: "P", status: "awaiting_review", currentRevision: 2, createdAt: 0, updatedAt: 0 },
    content: "# Rev Two Latest",
    comments: [{ id: "c1", revision: 1, kind: "general", body: "old feedback", resolved: true, createdAt: 0 }],
  })
  vi.mocked(api.getRevision).mockResolvedValue({ content: "# Rev One Old" })

  render(<App />)
  await waitFor(() => screen.getByRole("heading", { name: "Rev Two Latest" }))
  expect(screen.getByRole("button", { name: /approve/i })).toBeInTheDocument()

  await userEvent.selectOptions(screen.getByRole("combobox", { name: /revision/i }), "1")
  await waitFor(() => screen.getByRole("heading", { name: "Rev One Old" }))
  expect(screen.getByText(/historical/i)).toBeInTheDocument()
  expect(screen.queryByRole("button", { name: /approve/i })).toBeNull()
  expect(screen.getByText("old feedback")).toBeInTheDocument()

  await userEvent.click(screen.getByRole("button", { name: /back to latest/i }))
  await waitFor(() => screen.getByRole("heading", { name: "Rev Two Latest" }))
  expect(screen.getByRole("button", { name: /approve/i })).toBeInTheDocument()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test src/App.test.tsx`
Expected: FAIL — no `combobox`/RevisionSwitcher rendered yet; the new test can't find the Revision dropdown.

- [ ] **Step 3: Implement** — replace `companion/src/App.tsx` with:

```tsx
import React, { useEffect, useState, useCallback } from "react"
import "./App.css"
import * as api from "./api"
import type { Anchor, Artifact, ArtifactDetail } from "./api"
import { ArtifactList } from "./components/ArtifactList"
import { ArtifactView } from "./components/ArtifactView"
import { CommentThread } from "./components/CommentThread"
import { ActionBar } from "./components/ActionBar"
import { RevisionSwitcher } from "./components/RevisionSwitcher"

export function App() {
  const [artifacts, setArtifacts] = useState<Artifact[]>([])
  const [selectedId, setSelectedId] = useState<string>()
  const [detail, setDetail] = useState<ArtifactDetail>()
  const [pendingAnchor, setPendingAnchor] = useState<Anchor>()
  const [connected, setConnected] = useState(true)
  // undefined = viewing the latest revision
  const [viewedRevision, setViewedRevision] = useState<number>()
  const [historicalContent, setHistoricalContent] = useState<string>()

  const refreshList = useCallback(async () => setArtifacts(await api.listArtifacts()), [])
  const refreshDetail = useCallback(async (id: string) => setDetail(await api.getArtifact(id)), [])

  const select = useCallback((id: string) => {
    setSelectedId(id)
    setPendingAnchor(undefined)
    setViewedRevision(undefined)
    setHistoricalContent(undefined)
    refreshDetail(id)
  }, [refreshDetail])

  useEffect(() => { refreshList() }, [refreshList])

  useEffect(() => {
    return api.subscribeEvents(
      (e) => {
        setConnected(true)
        if (e.type === "ping") return
        refreshList()
        if (selectedId && e.id === selectedId) {
          // A new revision may have arrived — return to the latest view.
          setViewedRevision(undefined)
          setHistoricalContent(undefined)
          refreshDetail(selectedId)
        }
      },
      () => setConnected(false),
    )
  }, [selectedId, refreshList, refreshDetail])

  // Auto-select the first artifact once the list loads and nothing is selected.
  useEffect(() => {
    if (!selectedId && artifacts.length) select(artifacts[0].id)
  }, [artifacts, selectedId, select])

  const pickRevision = useCallback(async (n: number) => {
    if (!detail) return
    if (n >= detail.artifact.currentRevision) {
      setViewedRevision(undefined)
      setHistoricalContent(undefined)
      return
    }
    setViewedRevision(n)
    const { content } = await api.getRevision(detail.artifact.id, n)
    setHistoricalContent(content)
  }, [detail])

  async function addComment(body: string, anchor?: Anchor) {
    if (!detail) return
    await api.postComment(detail.artifact.id, {
      revision: detail.artifact.currentRevision,
      kind: anchor ? "anchor" : "general",
      anchor,
      body,
    })
    setPendingAnchor(undefined)
    refreshDetail(detail.artifact.id)
  }

  async function verdict(status: "approved" | "changes_requested" | "refine") {
    if (!detail) return
    await api.postVerdict(detail.artifact.id, status)
    refreshDetail(detail.artifact.id)
  }

  const total = detail?.artifact.currentRevision ?? 0
  const viewing = viewedRevision ?? total
  const isLatest = viewing === total
  const revisionComments = detail
    ? (isLatest ? detail.comments : detail.comments.filter((c) => c.revision === viewing))
    : []

  return (
    <div className="layout">
      {!connected && (
        <div className="conn-lost">Connection lost — reconnecting…</div>
      )}
      <aside className="rail">
        <h2>Artifacts</h2>
        <ArtifactList artifacts={artifacts} selectedId={selectedId} onSelect={select} />
      </aside>
      <main className="main">
        {detail ? (
          <>
            <header className="main-header">
              <h1>{detail.artifact.title}</h1>
              <div className="main-header-right">
                <RevisionSwitcher total={total} viewing={viewing} onSelect={pickRevision} />
                <span className={`status status-${detail.artifact.status}`}>
                  {detail.artifact.status.replace(/_/g, " ")}
                </span>
              </div>
            </header>
            {!isLatest && (
              <div className="historical-banner">
                <span>Revision {viewing} of {total} (historical)</span>
                <button type="button" onClick={() => pickRevision(total)}>Back to latest</button>
              </div>
            )}
            <ArtifactView
              content={isLatest ? detail.content : historicalContent ?? ""}
              comments={revisionComments}
              highlightResolved={!isLatest}
              onAnchor={isLatest ? setPendingAnchor : () => {}}
            />
          </>
        ) : (
          <p className="empty">Select an artifact.</p>
        )}
      </main>
      <aside className="rail comments-rail">
        {detail && (
          <>
            {isLatest ? (
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
                title={`Comments · revision ${viewing}`}
                comments={revisionComments}
                onAdd={() => {}}
                readOnly
              />
            )}
          </>
        )}
      </aside>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test src/App.test.tsx`
Expected: PASS (all App tests, including the new revision-switch test).

- [ ] **Step 5: Add styles** — append to `companion/src/App.css`:

```css
.main-header-right { display: flex; align-items: center; gap: 10px; }
.revision-switcher { font-size: 12px; padding: 2px 4px; }
.historical-banner { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; padding: 6px 10px; border-radius: 6px; background: #eff6ff; color: #1e40af; font-size: 13px; }
.historical-banner button { background: none; border: none; color: #1d4ed8; text-decoration: underline; cursor: pointer; font-size: 13px; }
```

- [ ] **Step 6: Run the full companion suite + typecheck + build**

Run: `bun run test && bunx tsc --noEmit -p tsconfig.json && bun run build`
Expected: all companion tests PASS; typecheck clean; `dist/` produced.

- [ ] **Step 7: Commit**

```bash
git add companion/src/App.tsx companion/src/App.css companion/src/App.test.tsx
git commit -m "feat: revision switcher with read-only historical view"
```

---

## Self-Review Notes

- **Spec coverage:** dropdown listing 1..M (Task 2, hidden when M=1); `getRevision` fetch (Task 1); historical content read-only (Task 5); highlight the viewed revision's anchored comments incl. resolved (Task 3 `highlightResolved` + Task 5 passing `revisionComments` filtered by `c.revision === viewing`); read-only comment list for historical (Task 4 + Task 5); banner + "Back to latest" (Task 5); reset to latest on artifact change / new-revision SSE (Task 5 `select` + event handler); latest view unchanged (Task 5 `isLatest` branch). No backend change — confirmed by reuse of existing `/revisions/:n` and `currentRevision`.
- **Type consistency:** `RevisionSwitcher` prop is `total` (not `current`) in both the component (Task 2) and its use in App (Task 5). `getRevision(id, n)` signature matches between Task 1 and Task 5. `highlightResolved?: boolean` matches Task 3 and Task 5. `readOnly?: boolean` matches Task 4 and Task 5.
- **No placeholders:** every code step is complete and runnable.
- **Note for implementer:** Task 5 replaces the whole `App.tsx`; the only behavioral changes vs. the current file are the revision state/switcher/banner and the `isLatest` split — the connection banner, auto-select, comment, and verdict logic are carried over unchanged.
