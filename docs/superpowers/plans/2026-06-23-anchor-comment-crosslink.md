# Clickable Anchor ↔ Comment Cross-Linking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Click a highlight in the document to scroll/flash its comment in the rail, and click an anchored comment to scroll/flash its highlight — bidirectionally, keyed by comment id.

**Architecture:** Companion-only. A small `flash.ts` helper scrolls + transiently styles a DOM element. `ArtifactView` stamps each highlight `<mark>` with `data-comment-id`, reports clicks, and flashes marks on demand; `CommentThread` makes anchored comment items clickable and flashes them on demand. `App` cross-wires the two with nonce-keyed flash state.

**Tech Stack:** React + Vite + Vitest + @testing-library/react (run from `companion/`).

---

## File Structure

- `companion/src/flash.ts` — CREATE `flashElement` helper.
- `companion/src/flash.test.ts` — CREATE tests.
- `companion/src/components/ArtifactView.tsx` — MODIFY: `data-comment-id` on marks, click delegation, flash effect.
- `companion/src/components/ArtifactView.crosslink.test.tsx` — CREATE tests.
- `companion/src/components/CommentThread.tsx` — MODIFY: single root ref, clickable anchored items, flash effect.
- `companion/src/components/CommentThread.test.tsx` — ADD tests.
- `companion/src/App.tsx` — MODIFY: cross-wire flash state into both children.
- `companion/src/App.test.tsx` — ADD an end-to-end direction test.
- `companion/src/App.css` — ADD `.flash` + `.comment.clickable` styles.

All commands run from `companion/`.

---

## Task 1: `flashElement` helper

**Files:**
- Create: `companion/src/flash.ts`
- Test: `companion/src/flash.test.ts`

- [ ] **Step 1: Write the failing test** — create `companion/src/flash.test.ts`:

```ts
import { test, expect, vi, beforeEach, afterEach } from "vitest"
import { flashElement } from "./flash"

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

test("adds .flash then removes it after the timer", () => {
  const el = document.createElement("div")
  flashElement(el)
  expect(el.classList.contains("flash")).toBe(true)
  vi.advanceTimersByTime(1200)
  expect(el.classList.contains("flash")).toBe(false)
})

test("is a no-op for null", () => {
  expect(() => flashElement(null)).not.toThrow()
})

test("calls scrollIntoView when available", () => {
  const el = document.createElement("div")
  const spy = vi.fn()
  ;(el as unknown as { scrollIntoView: () => void }).scrollIntoView = spy
  flashElement(el)
  expect(spy).toHaveBeenCalled()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test src/flash.test.ts`
Expected: FAIL — cannot find module `./flash`.

- [ ] **Step 3: Implement** — create `companion/src/flash.ts`:

```ts
/** Scroll an element into view (if supported) and briefly add a `.flash` class. */
export function flashElement(el: HTMLElement | null): void {
  if (!el) return
  if (typeof el.scrollIntoView === "function") {
    try { el.scrollIntoView({ block: "nearest" }) } catch { /* jsdom has no layout */ }
  }
  el.classList.add("flash")
  setTimeout(() => el.classList.remove("flash"), 1200)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test src/flash.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add companion/src/flash.ts companion/src/flash.test.ts
git commit -m "feat: flashElement helper (scroll + transient highlight)"
```

---

## Task 2: ArtifactView — clickable marks + flash

**Files:**
- Modify: `companion/src/components/ArtifactView.tsx`
- Test: `companion/src/components/ArtifactView.crosslink.test.tsx`

- [ ] **Step 1: Write the failing test** — create `companion/src/components/ArtifactView.crosslink.test.tsx`:

```tsx
import { test, expect, vi } from "vitest"
import { render, waitFor, fireEvent } from "@testing-library/react"
import { ArtifactView } from "./ArtifactView"
import type { Comment } from "../api"

const anchored: Comment[] = [
  { id: "c1", revision: 1, kind: "anchor", anchor: { quote: "step one", prefix: "", suffix: "" }, body: "note", resolved: false, createdAt: 0 },
]

test("clicking a highlight fires onHighlightClick with the comment id", async () => {
  const onHighlightClick = vi.fn()
  render(<ArtifactView content={"# Plan\n\nstep one here"} comments={anchored} onAnchor={() => {}} onHighlightClick={onHighlightClick} />)
  let mark: Element | null = null
  await waitFor(() => {
    mark = document.querySelector("mark.anchor-highlight")
    expect(mark).not.toBeNull()
  })
  fireEvent.click(mark!)
  expect(onHighlightClick).toHaveBeenCalledWith("c1")
})

test("flashAnchorId + flashKey adds .flash to the matching mark", async () => {
  const { rerender } = render(
    <ArtifactView content={"# Plan\n\nstep one here"} comments={anchored} onAnchor={() => {}} />,
  )
  await waitFor(() => expect(document.querySelector("mark.anchor-highlight")).not.toBeNull())
  rerender(
    <ArtifactView content={"# Plan\n\nstep one here"} comments={anchored} onAnchor={() => {}} flashAnchorId="c1" flashKey={1} />,
  )
  await waitFor(() => {
    expect(document.querySelector("mark.anchor-highlight")?.classList.contains("flash")).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test src/components/ArtifactView.crosslink.test.tsx`
Expected: FAIL — `onHighlightClick` does nothing / `flash` class never applied.

- [ ] **Step 3: Implement** — edit `companion/src/components/ArtifactView.tsx`:

(a) Add the import (top of file):

```tsx
import { anchorFromOffsets, selectionOffsets, findAnchorOffsets } from "../anchor-dom"
import { flashElement } from "../flash"
```

(b) Change `wrapRange` to stamp the comment id — replace its signature and the `mark` creation:

```tsx
function wrapRange(container: HTMLElement, start: number, end: number, title: string, commentId: string) {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  let pos = 0
  const slices: { node: Text; from: number; to: number }[] = []
  while (walker.nextNode()) {
    const node = walker.currentNode as Text
    const len = node.nodeValue?.length ?? 0
    const nodeStart = pos, nodeEnd = pos + len
    pos = nodeEnd
    const s = Math.max(start, nodeStart), e = Math.min(end, nodeEnd)
    if (s < e) slices.push({ node, from: s - nodeStart, to: e - nodeStart })
  }
  for (const { node, from, to } of slices) {
    const range = document.createRange()
    range.setStart(node, from)
    range.setEnd(node, to)
    const mark = document.createElement("mark")
    mark.className = "anchor-highlight"
    mark.title = title
    mark.dataset.commentId = commentId
    range.surroundContents(mark)
  }
}
```

(c) Add the new props to the component signature:

```tsx
export function ArtifactView(props: {
  content: string
  comments: Comment[]
  onAnchor: (anchor: Anchor) => void
  highlightResolved?: boolean
  onHighlightClick?: (commentId: string) => void
  flashAnchorId?: string
  flashKey?: number
}) {
```

(d) In the highlight `useEffect`, pass the comment id to `wrapRange`:

```tsx
      wrapRange(ref.current, offsets.start, offsets.end, comment.body, comment.id)
```

(e) Add a click handler (after `onMouseUp`):

```tsx
  function onClick(e: React.MouseEvent) {
    const mark = (e.target as HTMLElement).closest("mark.anchor-highlight") as HTMLElement | null
    const id = mark?.dataset.commentId
    if (id) props.onHighlightClick?.(id)
  }
```

(f) Add a flash effect AFTER the existing highlight effect (so marks already exist):

```tsx
  useEffect(() => {
    if (!ref.current || !props.flashAnchorId) return
    ref.current
      .querySelectorAll<HTMLElement>(`mark.anchor-highlight[data-comment-id="${CSS.escape(props.flashAnchorId)}"]`)
      .forEach((m) => flashElement(m))
  }, [props.flashAnchorId, props.flashKey])
```

(g) Wire the click handler on the container div:

```tsx
    <div className="artifact-view" ref={ref} onMouseUp={onMouseUp} onClick={onClick}>
      <Markdown>{props.content}</Markdown>
    </div>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test src/components/ArtifactView.crosslink.test.tsx`
Expected: PASS (2 tests). Also run the existing highlight suite to confirm no regression:
Run: `bun run test src/components/ArtifactView.highlight.test.tsx`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add companion/src/components/ArtifactView.tsx companion/src/components/ArtifactView.crosslink.test.tsx
git commit -m "feat: ArtifactView reports highlight clicks and flashes marks on demand"
```

---

## Task 3: CommentThread — clickable items + flash

**Files:**
- Modify: `companion/src/components/CommentThread.tsx`
- Test: `companion/src/components/CommentThread.test.tsx`

- [ ] **Step 1: Write the failing test** — append to `companion/src/components/CommentThread.test.tsx`, and ensure `waitFor` is imported (change the testing-library import line to `import { render, screen, waitFor } from "@testing-library/react"`):

```tsx
test("clicking an anchored comment fires onCommentClick; general comments are not clickable", async () => {
  const onCommentClick = vi.fn()
  const items: Comment[] = [
    { id: "x", revision: 1, kind: "anchor", anchor: { quote: "q", prefix: "", suffix: "" }, body: "anchored body", resolved: false, createdAt: 0 },
    { id: "y", revision: 1, kind: "general", body: "general body", resolved: false, createdAt: 0 },
  ]
  render(<CommentThread comments={items} onAdd={() => {}} onCommentClick={onCommentClick} />)
  await userEvent.click(screen.getByText("anchored body"))
  expect(onCommentClick).toHaveBeenCalledWith("x")
  onCommentClick.mockClear()
  await userEvent.click(screen.getByText("general body"))
  expect(onCommentClick).not.toHaveBeenCalled()
})

test("flashCommentId flashes the matching comment item", async () => {
  const items: Comment[] = [
    { id: "x", revision: 1, kind: "general", body: "the body", resolved: false, createdAt: 0 },
  ]
  const { rerender } = render(<CommentThread comments={items} onAdd={() => {}} />)
  rerender(<CommentThread comments={items} onAdd={() => {}} flashCommentId="x" flashKey={1} />)
  await waitFor(() => {
    expect(document.querySelector('[data-comment-id="x"]')?.classList.contains("flash")).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test src/components/CommentThread.test.tsx`
Expected: FAIL — `onCommentClick` not invoked; no `data-comment-id` / flash.

- [ ] **Step 3: Implement** — replace the whole `companion/src/components/CommentThread.tsx` with:

```tsx
import React, { useState, useRef, useEffect } from "react"
import type { Comment } from "../api"
import { flashElement } from "../flash"

function CommentItem({ c, onClick }: { c: Comment; onClick?: (id: string) => void }) {
  const clickable = c.kind === "anchor" && !!onClick
  return (
    <div
      className={`comment${c.resolved ? " resolved" : ""}${clickable ? " clickable" : ""}`}
      data-comment-id={c.id}
      onClick={clickable ? () => onClick!(c.id) : undefined}
    >
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
  onCommentClick?: (id: string) => void
  flashCommentId?: string
  flashKey?: number
}) {
  const [draft, setDraft] = useState("")
  const [showResolved, setShowResolved] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!rootRef.current || !props.flashCommentId) return
    const el = rootRef.current.querySelector<HTMLElement>(
      `[data-comment-id="${CSS.escape(props.flashCommentId)}"]`,
    )
    flashElement(el)
  }, [props.flashCommentId, props.flashKey])

  const item = (c: Comment) => <CommentItem key={c.id} c={c} onClick={props.onCommentClick} />

  let body: React.ReactNode
  if (props.readOnly) {
    body = (
      <>
        {props.comments.length === 0 && <p className="empty">No comments on this revision.</p>}
        {props.comments.map(item)}
      </>
    )
  } else {
    const active = props.comments.filter((c) => !c.resolved)
    const resolved = props.comments.filter((c) => c.resolved)
    body = (
      <>
        {active.map(item)}
        {resolved.length > 0 && (
          <div className="resolved-section">
            <button
              type="button"
              className="resolved-toggle"
              onClick={() => setShowResolved((s) => !s)}
            >
              {showResolved ? "▾" : "▸"} Resolved ({resolved.length})
            </button>
            {showResolved && resolved.map(item)}
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
      </>
    )
  }

  return (
    <div className="comment-thread" ref={rootRef}>
      {props.title && <h4>{props.title}</h4>}
      {body}
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test src/components/CommentThread.test.tsx`
Expected: PASS (6 tests — the 4 existing plus the 2 new; the refactor preserves all prior behavior).

- [ ] **Step 5: Commit**

```bash
git add companion/src/components/CommentThread.tsx companion/src/components/CommentThread.test.tsx
git commit -m "feat: CommentThread anchored items are clickable and flashable"
```

---

## Task 4: App wiring + styles + end-to-end test

**Files:**
- Modify: `companion/src/App.tsx`
- Modify: `companion/src/App.css`
- Test: `companion/src/App.test.tsx`

- [ ] **Step 1: Write the failing test** — in `companion/src/App.test.tsx`, add `fireEvent` to the testing-library import (`import { render, screen, waitFor, fireEvent } from "@testing-library/react"`), then append:

```tsx
test("clicking a highlight in the document flashes its comment in the rail", async () => {
  vi.mocked(api.getArtifact).mockResolvedValue({
    artifact: { id: "id1", type: "plan", title: "P", status: "awaiting_review", currentRevision: 1, createdAt: 0, updatedAt: 0 },
    content: "# Plan\n\nstep one here",
    comments: [{ id: "c1", revision: 1, kind: "anchor", anchor: { quote: "step one", prefix: "", suffix: "" }, body: "fix this", resolved: false, createdAt: 0 }],
  })
  render(<App />)
  let mark: Element | null = null
  await waitFor(() => {
    mark = document.querySelector("mark.anchor-highlight")
    expect(mark).not.toBeNull()
  })
  fireEvent.click(mark!)
  await waitFor(() => {
    const comment = document.querySelector('.comment[data-comment-id="c1"]')
    expect(comment?.classList.contains("flash")).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test src/App.test.tsx`
Expected: FAIL — clicking the mark does nothing (App doesn't wire `onHighlightClick` yet), so the comment never gets `.flash`.

- [ ] **Step 3: Implement** — edit `companion/src/App.tsx`:

(a) Ensure `useRef` is imported:

```tsx
import React, { useEffect, useState, useCallback, useRef } from "react"
```

(b) Add flash state + handlers (after the `historicalContent` state line):

```tsx
  const flashSeq = useRef(0)
  const [flashComment, setFlashComment] = useState<{ id: string; key: number }>()
  const [flashAnchor, setFlashAnchor] = useState<{ id: string; key: number }>()
  const onHighlightClick = useCallback((id: string) => setFlashComment({ id, key: ++flashSeq.current }), [])
  const onCommentClick = useCallback((id: string) => setFlashAnchor({ id, key: ++flashSeq.current }), [])
```

(c) Pass props to the single `ArtifactView`:

```tsx
            <ArtifactView
              content={isLatest ? detail.content : historicalContent ?? ""}
              comments={revisionComments}
              highlightResolved={!isLatest}
              onAnchor={isLatest ? setPendingAnchor : () => {}}
              onHighlightClick={onHighlightClick}
              flashAnchorId={flashAnchor?.id}
              flashKey={flashAnchor?.key}
            />
```

(d) Pass props to the **latest-branch** `CommentThread`:

```tsx
                <CommentThread
                  title="Comments"
                  comments={detail.comments}
                  onAdd={(body) => addComment(body, pendingAnchor)}
                  onCommentClick={onCommentClick}
                  flashCommentId={flashComment?.id}
                  flashKey={flashComment?.key}
                />
```

(e) Pass props to the **historical-branch** `CommentThread`:

```tsx
              <CommentThread
                title={`Comments · revision ${viewing}`}
                comments={revisionComments}
                onAdd={() => {}}
                readOnly
                onCommentClick={onCommentClick}
                flashCommentId={flashComment?.id}
                flashKey={flashComment?.key}
              />
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test src/App.test.tsx`
Expected: PASS (all App tests, including the new one).

- [ ] **Step 5: Add styles** — append to `companion/src/App.css`:

```css
.comment.clickable { cursor: pointer; }
@keyframes flash-pulse { 0% { box-shadow: 0 0 0 2px #f59e0b; } 100% { box-shadow: 0 0 0 2px transparent; } }
.flash { animation: flash-pulse 1.2s ease-out; border-radius: 3px; }
```

- [ ] **Step 6: Run the full companion suite + typecheck + build**

Run: `bun run test && bunx tsc --noEmit -p tsconfig.json && bun run build`
Expected: all companion tests PASS; typecheck clean; `dist/` produced.

- [ ] **Step 7: Commit**

```bash
git add companion/src/App.tsx companion/src/App.css companion/src/App.test.tsx
git commit -m "feat: cross-wire highlight<->comment flashing in App"
```

---

## Self-Review Notes

- **Spec coverage:** `flashElement` helper (Task 1); marks stamped with `data-comment-id` + click → `onHighlightClick` + flash marks (Task 2); anchored comment items clickable + `data-comment-id` + flash items, single-root-ref refactor covering both interactive and readOnly paths (Task 3); App nonce-keyed `flashComment`/`flashAnchor` wired into `ArtifactView` and both `CommentThread` usages (Task 4); both view branches covered (Task 4 d/e); transient flash via CSS animation (Task 4 styles); end-to-end direction tested (Task 4 test).
- **Type consistency:** prop names align across tasks — `onHighlightClick`, `flashAnchorId`, `flashKey` on ArtifactView (Task 2 & 4c); `onCommentClick`, `flashCommentId`, `flashKey` on CommentThread (Task 3 & 4 d/e); `wrapRange(..., title, commentId)` matches its call site (Task 2 b/d). `flashElement(el: HTMLElement | null)` matches all call sites.
- **No placeholders:** every code step is complete and runnable.
- **Regression note:** Task 3 rewrites CommentThread but preserves the existing 4 tests' behavior (flat read-only list, active/resolved toggle, trimmed onAdd, no-toggle-when-none-resolved); Task 2 keeps `mark.title` and `className` so the existing highlight tests still pass.
