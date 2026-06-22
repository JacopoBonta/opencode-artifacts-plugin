# Comment Auto-Resolve on Revise Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When an artifact is re-published as a new revision, auto-mark all prior comments resolved so the agent only receives unresolved feedback; show resolved comments behind a collapsible toggle and stop highlighting them.

**Architecture:** A one-line-of-behavior change in `store.publish` (revision-bump branch) marks prior comments resolved on disk + in memory; the server's existing `!c.resolved` filter then becomes meaningful. The companion excludes resolved comments from anchor highlighting and collapses them under a `Resolved (N)` toggle.

**Tech Stack:** TypeScript / Bun (`bun test`); React + Vitest + @testing-library/react.

---

## File Structure

- `src/store.ts` — MODIFY `publish` (revision-bump branch) to resolve+persist prior comments.
- `src/store.test.ts` — ADD test: re-publish resolves prior comments.
- `src/server.test.ts` — ADD test: after a revise, `changes_requested` returns only unresolved comments (validates the agent-facing filter end-to-end).
- `companion/src/components/ArtifactView.tsx` — MODIFY highlight loop to skip resolved comments.
- `companion/src/components/ArtifactView.highlight.test.tsx` — ADD test: resolved anchored comment is not highlighted.
- `companion/src/components/CommentThread.tsx` — MODIFY to split active (inline) vs resolved (collapsible `Resolved (N)`).
- `companion/src/components/CommentThread.test.tsx` — CREATE: active shown, resolved hidden until toggled.
- `companion/src/App.css` — ADD muted style for resolved comments + toggle.

---

## Task 1: Backend — auto-resolve prior comments on re-publish

**Files:**
- Modify: `src/store.ts` (the `publish` function, revision-bump branch + commit block)
- Test: `src/store.test.ts`, `src/server.test.ts`

- [ ] **Step 1: Write the failing store test** — append to `src/store.test.ts` (after the "addComment to an unknown artifact throws" test):

```ts
test("re-publishing a revision auto-resolves all prior comments", async () => {
  const store = newStore()
  const { artifact } = await store.publish({ type: "plan", title: "P", content: "v1" })
  await store.addComment(artifact.id, { revision: 1, kind: "general", body: "fix intro" })
  await store.addComment(artifact.id, { revision: 1, kind: "anchor", anchor: { quote: "x", prefix: "", suffix: "" }, body: "tighten" })

  await store.publish({ type: "plan", title: "P", content: "v2", artifactId: artifact.id })

  const comments = await store.getComments(artifact.id)
  expect(comments).toHaveLength(2)
  expect(comments.every((c) => c.resolved)).toBe(true)
})

test("a brand-new artifact's first publish leaves its (empty) comments untouched", async () => {
  const store = newStore()
  const { artifact } = await store.publish({ type: "plan", title: "P", content: "v1" })
  expect(await store.getComments(artifact.id)).toHaveLength(0)
})
```

- [ ] **Step 2: Run the store test to verify it fails**

Run: `bun test src/store.test.ts`
Expected: FAIL on "re-publishing a revision auto-resolves all prior comments" — `comments.every((c) => c.resolved)` is `false` (comments stay unresolved).

- [ ] **Step 3: Implement the auto-resolve in `src/store.ts`**

In `publish`, inside the I/O block, after the `metaPath` write and before the comments-bootstrap `if (isNew ...)`, add the resolved-comments write; then update the commit block to store it. The full updated I/O + commit section becomes:

```ts
    await mkdir(join(artDir(next.id), "revisions"), { recursive: true })
    await writeFile(revPath(next.id, next.currentRevision), input.content)
    await writeFile(metaPath(next.id), JSON.stringify(next, null, 2))

    // On a revision bump, all prior comments are assumed addressed by the new
    // revision — mark them resolved (build a copy, write, commit after I/O).
    let resolvedComments: Comment[] | undefined
    if (!isNew) {
      resolvedComments = (comments.get(next.id) ?? []).map((c) => ({ ...c, resolved: true }))
      await writeFile(commentsPath(next.id), JSON.stringify(resolvedComments, null, 2))
    }
    if (isNew && !existsSync(commentsPath(next.id))) {
      await writeFile(commentsPath(next.id), JSON.stringify([], null, 2))
    }

    // Commit to in-memory state only after all writes succeeded.
    artifacts.set(next.id, next)
    if (isNew) comments.set(next.id, [])
    else if (resolvedComments) comments.set(next.id, resolvedComments)
    return { artifact: { ...next } }
```

(`Comment` is already imported in `src/store.ts`.)

- [ ] **Step 4: Run the store test to verify it passes**

Run: `bun test src/store.test.ts`
Expected: PASS (all store tests, including the two new ones).

- [ ] **Step 5: Write the failing server integration test** — append to `src/server.test.ts` (after the last test):

```ts
test("after a revise, changes_requested returns only the new revision's unresolved comments", async () => {
  const { store, srv } = setup()
  const { artifact } = await store.publish({ type: "plan", title: "P", content: "v1" })
  const id = artifact.id
  // comment on v1, then the agent revises (republish) — v1 comments auto-resolve
  await store.addComment(id, { revision: 1, kind: "general", body: "old v1 note" })
  await store.publish({ type: "plan", title: "P", content: "v2", artifactId: id })

  // user reviews v2 and leaves a fresh comment, then requests changes
  const pending = store.awaitVerdict(id)
  await fetch(`${srv.url}/api/artifacts/${id}/comments`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ revision: 2, kind: "general", body: "new v2 note" }),
  })
  await fetch(`${srv.url}/api/artifacts/${id}/verdict`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: "changes_requested" }),
  })

  const verdict = await pending
  expect(verdict.status).toBe("changes_requested")
  if (verdict.status === "changes_requested") {
    expect(verdict.comments).toHaveLength(1)
    expect(verdict.comments[0].body).toBe("new v2 note")
  }
})
```

- [ ] **Step 6: Run the server test to verify it passes** (no server code change needed — the store change makes the existing `!c.resolved` filter meaningful)

Run: `bun test src/server.test.ts`
Expected: PASS (all server tests, including the new one).

- [ ] **Step 7: Run the full backend suite + typecheck**

Run: `bun run test && bun run typecheck`
Expected: all pass; typecheck clean.

- [ ] **Step 8: Commit**

```bash
git add src/store.ts src/store.test.ts src/server.test.ts
git commit -m "feat: auto-resolve prior comments on re-publish so the agent only gets fresh feedback"
```

---

## Task 2: Companion — stop highlighting resolved anchored comments

**Files:**
- Modify: `companion/src/components/ArtifactView.tsx` (the highlight `useEffect` loop)
- Test: `companion/src/components/ArtifactView.highlight.test.tsx`

- [ ] **Step 1: Write the failing test** — append to `companion/src/components/ArtifactView.highlight.test.tsx`:

```tsx
test("resolved anchored comments are NOT highlighted", async () => {
  const resolved: Comment[] = [
    { id: "r1", revision: 1, kind: "anchor", anchor: { quote: "step one", prefix: "", suffix: "" }, body: "addressed", resolved: true, createdAt: 0 },
  ]
  render(<ArtifactView content={"# Plan\n\nstep one here"} comments={resolved} onAnchor={() => {}} />)
  await new Promise((r) => setTimeout(r, 20))
  expect(document.querySelectorAll("mark.anchor-highlight").length).toBe(0)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd companion && bun run test src/components/ArtifactView.highlight.test.tsx`
Expected: FAIL — one `mark.anchor-highlight` is found (resolved anchors are still highlighted).

- [ ] **Step 3: Implement — skip resolved comments in the highlight loop**

In `companion/src/components/ArtifactView.tsx`, change the loop guard inside the `useEffect`:

```tsx
    for (const comment of props.comments) {
      if (comment.kind !== "anchor" || !comment.anchor || comment.resolved) continue
      const offsets = findAnchorOffsets(text, comment.anchor)
      if (!offsets) continue
      wrapRange(ref.current, offsets.start, offsets.end, comment.body)
    }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd companion && bun run test src/components/ArtifactView.highlight.test.tsx`
Expected: PASS (all highlight tests, including the new one — the existing "wraps each anchored comment's quote" test still passes because its comment has `resolved: false`).

- [ ] **Step 5: Commit**

```bash
git add companion/src/components/ArtifactView.tsx companion/src/components/ArtifactView.highlight.test.tsx
git commit -m "feat: don't highlight resolved anchored comments"
```

---

## Task 3: Companion — collapse resolved comments behind a toggle

**Files:**
- Modify: `companion/src/components/CommentThread.tsx`
- Create: `companion/src/components/CommentThread.test.tsx`
- Modify: `companion/src/App.css`

- [ ] **Step 1: Write the failing test** — create `companion/src/components/CommentThread.test.tsx`:

```tsx
import { test, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { CommentThread } from "./CommentThread"
import type { Comment } from "../api"

const comments: Comment[] = [
  { id: "a", revision: 2, kind: "general", body: "active note", resolved: false, createdAt: 0 },
  { id: "b", revision: 1, kind: "general", body: "resolved note", resolved: true, createdAt: 0 },
]

test("active comments show inline; resolved are hidden until the toggle is expanded", async () => {
  render(<CommentThread comments={comments} onAdd={() => {}} title="Comments" />)
  expect(screen.getByText("active note")).toBeInTheDocument()
  expect(screen.queryByText("resolved note")).toBeNull()

  await userEvent.click(screen.getByRole("button", { name: /resolved \(1\)/i }))
  expect(screen.getByText("resolved note")).toBeInTheDocument()
})

test("no Resolved toggle is shown when there are no resolved comments", () => {
  render(
    <CommentThread
      comments={[{ id: "a", revision: 1, kind: "general", body: "only active", resolved: false, createdAt: 0 }]}
      onAdd={() => {}}
    />,
  )
  expect(screen.queryByRole("button", { name: /resolved \(/i })).toBeNull()
})

test("adding a comment calls onAdd with trimmed text", async () => {
  const onAdd = vi.fn()
  render(<CommentThread comments={[]} onAdd={onAdd} />)
  await userEvent.type(screen.getByPlaceholderText("Add a comment"), "  hello  ")
  await userEvent.click(screen.getByRole("button", { name: /^comment$/i }))
  expect(onAdd).toHaveBeenCalledWith("hello")
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd companion && bun run test src/components/CommentThread.test.tsx`
Expected: FAIL — resolved comment "resolved note" is rendered inline (no toggle exists yet).

- [ ] **Step 3: Implement — split active vs resolved in `companion/src/components/CommentThread.tsx`**

Replace the whole file with:

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
}) {
  const [draft, setDraft] = useState("")
  const [showResolved, setShowResolved] = useState(false)

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

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd companion && bun run test src/components/CommentThread.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Add styles** — append to `companion/src/App.css`:

```css
.comment.resolved { opacity: 0.6; }
.resolved-section { margin: 4px 0 8px; }
.resolved-toggle { background: none; border: none; padding: 4px 0; color: #71717a; font-size: 12px; cursor: pointer; }
```

- [ ] **Step 6: Run the full companion suite + typecheck + build**

Run: `cd companion && bun run test && bunx tsc --noEmit -p tsconfig.json && bun run build`
Expected: all companion tests PASS; typecheck clean; `dist/` produced.

- [ ] **Step 7: Commit**

```bash
git add companion/src/components/CommentThread.tsx companion/src/components/CommentThread.test.tsx companion/src/App.css
git commit -m "feat: collapse resolved comments behind a Resolved (N) toggle"
```

---

## Self-Review Notes

- **Spec coverage:** auto-resolve on revision bump (Task 1, store); agent only gets unresolved via existing server filter, validated end-to-end (Task 1, server test); highlights skip resolved (Task 2); resolved collapsed behind `Resolved (N)` toggle, active inline (Task 3); applies to report refine re-publish too (same `store.publish` path — covered by Task 1's mechanism). No data-model change (uses existing `resolved`).
- **Type consistency:** `Comment.resolved: boolean` and `comment.anchor?.quote` match `companion/src/api.ts` and `src/types.ts`. `resolvedComments: Comment[]` uses the already-imported `Comment` type in `src/store.ts`.
- **No placeholders:** every code step is complete and runnable.
