# Group Artifacts by Session Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Group the companion's artifact list by the opencode session that produced each artifact, with a human-friendly session title as a collapsible group header.

**Architecture:** The server augments `GET /api/artifacts` with a resolved `sessionTitle` per artifact via an injected resolver; the plugin backs that resolver with the opencode SDK (`client.session.get`) plus an in-memory cache. The companion's `ArtifactList` groups by `sessionID` into collapsible sections, expanding the selected artifact's group.

**Tech Stack:** TypeScript / Bun (`bun test`) for the server; React + Vite + Vitest for the companion.

---

## File Structure

- `src/server.ts` — MODIFY: `resolveSessionTitle` option; augment the list response.
- `src/server.test.ts` — ADD two tests (with / without resolver).
- `src/index.ts` — MODIFY: provide the cached SDK-backed resolver.
- `companion/src/api.ts` — MODIFY: add `sessionID?`/`sessionTitle?` to `Artifact`.
- `companion/src/components/ArtifactList.tsx` — MODIFY: grouped, collapsible list.
- `companion/src/components/ArtifactList.test.tsx` — CREATE: grouping tests.
- `companion/src/App.css` — ADD group-header styles.

---

## Task 1: Backend — resolve and attach session titles

**Files:**
- Modify: `src/server.ts`, `src/index.ts`
- Test: `src/server.test.ts`

- [ ] **Step 1: Write the failing tests** — append to `src/server.test.ts`:

```ts
test("GET /api/artifacts attaches sessionTitle when a resolver is provided", async () => {
  const dir = mkdtempSync(join(tmpdir(), "artifacts-"))
  const store = createStore({ root: dir, clock: () => 1, idgen: (() => { let n = 0; return () => `id${++n}` })() })
  const events = createBroadcaster()
  const srv = createServer({
    store, events, port: 0, staticDir: null,
    resolveSessionTitle: async (id) => `Title for ${id}`,
  })
  stop = srv.stop
  await store.publish({ type: "plan", title: "P", content: "x", sessionID: "ses_abc" })
  const body = await (await fetch(`${srv.url}/api/artifacts`)).json()
  expect(body[0].sessionTitle).toBe("Title for ses_abc")
})

test("GET /api/artifacts omits sessionTitle when no resolver is configured", async () => {
  const { store, srv } = setup()
  await store.publish({ type: "plan", title: "P", content: "x", sessionID: "ses_abc" })
  const body = await (await fetch(`${srv.url}/api/artifacts`)).json()
  expect(body[0].sessionTitle).toBeUndefined()
})
```

- [ ] **Step 2: Run tests to verify failure**

Run: `bun test src/server.test.ts`
Expected: the resolver test FAILS (`sessionTitle` is undefined — not attached yet). (The no-resolver test already passes.)

- [ ] **Step 3: Edit `src/server.ts`.**

(a) Add the option to `ServerOptions`:

```ts
export interface ServerOptions {
  store: Store
  events: Broadcaster
  /** 0 = pick a free port */
  port?: number
  /** directory of prebuilt companion assets, or null to disable static serving */
  staticDir?: string | null
  /** resolve a human title for a session id (for grouping); optional */
  resolveSessionTitle?: (sessionID: string) => Promise<string | undefined>
}
```

(b) Replace the list handler:

```ts
      // --- API ---
      if (path === "/api/artifacts" && req.method === "GET") {
        return json(await store.list())
      }
```

with:

```ts
      // --- API ---
      if (path === "/api/artifacts" && req.method === "GET") {
        const artifacts = await store.list()
        if (!opts.resolveSessionTitle) return json(artifacts)
        const resolve = opts.resolveSessionTitle
        const withTitles = await Promise.all(
          artifacts.map(async (a) => ({
            ...a,
            sessionTitle: a.sessionID ? await resolve(a.sessionID) : undefined,
          })),
        )
        return json(withTitles)
      }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/server.test.ts`
Expected: PASS (both new tests).

- [ ] **Step 5: Provide the real resolver in `src/index.ts`.**

Add a cached resolver above the `createServer({...})` call, and pass it in. Insert after the `const staticDir = ...` line:

```ts
  const sessionTitleCache = new Map<string, string | undefined>()
  async function resolveSessionTitle(sessionID: string): Promise<string | undefined> {
    if (sessionTitleCache.has(sessionID)) return sessionTitleCache.get(sessionID)
    let title: string | undefined
    try {
      const res = (await client.session.get({ path: { id: sessionID } })) as any
      title = res?.title ?? res?.data?.title
    } catch {
      title = undefined
    }
    sessionTitleCache.set(sessionID, title)
    return title
  }
```

Then add `resolveSessionTitle,` to the `createServer({...})` call so it reads:

```ts
  const server = createServer({
    store,
    events,
    port: Number(process.env.OPENCODE_ARTIFACTS_PORT ?? 0),
    staticDir: existsSync(staticDir) ? staticDir : null,
    resolveSessionTitle,
  })
```

**Verify the SDK shape:** before finishing, check `node_modules/@opencode-ai/sdk` for `client.session.get`'s argument and return shape. The plan assumes `client.session.get({ path: { id } })` resolving to a session that has a `title` (possibly under `.data`). Adjust the `res?.title ?? res?.data?.title` access to match the real shape; keep the `try/catch` fallback to `undefined`.

- [ ] **Step 6: Run the full backend suite + typecheck**

Run: `bun run test && bun run typecheck`
Expected: all pass; typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add src/server.ts src/server.test.ts src/index.ts
git commit -m "feat: attach resolved session titles to the artifact list"
```

---

## Task 2: Companion — grouped, collapsible artifact list

**Files:**
- Modify: `companion/src/api.ts`
- Modify: `companion/src/components/ArtifactList.tsx`
- Create: `companion/src/components/ArtifactList.test.tsx`
- Modify: `companion/src/App.css`

- [ ] **Step 1: Add the fields to `companion/src/api.ts`.** Replace the `Artifact` interface:

```ts
export interface Artifact {
  id: string; type: "plan" | "report"; title: string
  status: string; currentRevision: number; createdAt: number; updatedAt: number
  sessionID?: string; sessionTitle?: string
}
```

- [ ] **Step 2: Write the failing tests** — create `companion/src/components/ArtifactList.test.tsx`:

```tsx
import { test, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { ArtifactList } from "./ArtifactList"
import type { Artifact } from "../api"

const arts: Artifact[] = [
  { id: "a1", type: "plan", title: "Plan A", status: "approved", currentRevision: 1, createdAt: 1, updatedAt: 1, sessionID: "ses_111", sessionTitle: "Build login" },
  { id: "a2", type: "report", title: "Report A", status: "published", currentRevision: 1, createdAt: 2, updatedAt: 2, sessionID: "ses_111", sessionTitle: "Build login" },
  { id: "b1", type: "plan", title: "Plan B", status: "awaiting_review", currentRevision: 1, createdAt: 3, updatedAt: 3, sessionID: "ses_222", sessionTitle: "Fix bug" },
  { id: "c1", type: "plan", title: "Plan C", status: "awaiting_review", currentRevision: 1, createdAt: 4, updatedAt: 4 },
]

test("renders a header per session (title) plus an Ungrouped section", () => {
  render(<ArtifactList artifacts={arts} selectedId="a1" onSelect={() => {}} />)
  expect(screen.getByText("Build login")).toBeInTheDocument()
  expect(screen.getByText("Fix bug")).toBeInTheDocument()
  expect(screen.getByText("Ungrouped")).toBeInTheDocument()
})

test("expands the selected artifact's group and collapses the others", () => {
  render(<ArtifactList artifacts={arts} selectedId="a1" onSelect={() => {}} />)
  expect(screen.getByText("Plan A")).toBeInTheDocument()
  expect(screen.getByText("Report A")).toBeInTheDocument()
  expect(screen.queryByText("Plan B")).toBeNull()
})

test("clicking a collapsed group header expands it", async () => {
  render(<ArtifactList artifacts={arts} selectedId="a1" onSelect={() => {}} />)
  expect(screen.queryByText("Plan B")).toBeNull()
  await userEvent.click(screen.getByText("Fix bug"))
  expect(screen.getByText("Plan B")).toBeInTheDocument()
})

test("clicking an artifact calls onSelect", async () => {
  const onSelect = vi.fn()
  render(<ArtifactList artifacts={arts} selectedId="a1" onSelect={onSelect} />)
  await userEvent.click(screen.getByText("Plan A"))
  expect(onSelect).toHaveBeenCalledWith("a1")
})
```

- [ ] **Step 3: Run tests to verify failure**

Run: `cd companion && bun run test src/components/ArtifactList.test.tsx`
Expected: FAIL — the current `ArtifactList` renders a flat list (no group headers like "Build login").

- [ ] **Step 4: Replace `companion/src/components/ArtifactList.tsx`:**

```tsx
import React, { useState } from "react"
import type { Artifact } from "../api"

interface Group { key: string; label: string; artifacts: Artifact[]; latest: number }

function groupBySession(artifacts: Artifact[]): Group[] {
  const map = new Map<string, Artifact[]>()
  for (const a of artifacts) {
    const key = a.sessionID ?? "__ungrouped__"
    const list = map.get(key) ?? []
    list.push(a)
    map.set(key, list)
  }
  const groups: Group[] = []
  for (const [key, list] of map) {
    const label =
      key === "__ungrouped__"
        ? "Ungrouped"
        : list.find((a) => a.sessionTitle)?.sessionTitle ?? `Session ${key.slice(-6)}`
    const latest = Math.max(...list.map((a) => a.updatedAt))
    groups.push({ key, label, artifacts: list, latest })
  }
  groups.sort((a, b) => b.latest - a.latest)
  return groups
}

export function ArtifactList(props: {
  artifacts: Artifact[]
  selectedId?: string
  onSelect: (id: string) => void
}) {
  const groups = groupBySession(props.artifacts)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  const selectedKey =
    props.artifacts.find((a) => a.id === props.selectedId)?.sessionID ?? "__ungrouped__"

  function isOpen(g: Group): boolean {
    // Explicit user choice wins; otherwise expand the selected group only.
    if (g.key in collapsed) return !collapsed[g.key]
    return g.key === selectedKey
  }

  return (
    <div className="artifact-groups">
      {groups.map((g) => {
        const open = isOpen(g)
        return (
          <div key={g.key} className="artifact-group">
            <button
              type="button"
              className="group-header"
              aria-expanded={open}
              onClick={() => setCollapsed((c) => ({ ...c, [g.key]: open }))}
            >
              <span className="group-chevron">{open ? "▾" : "▸"}</span>
              <span className="group-title">{g.label}</span>
              <span className="group-count">{g.artifacts.length}</span>
            </button>
            {open && (
              <ul className="artifact-list">
                {g.artifacts.map((a) => (
                  <li
                    key={a.id}
                    className={a.id === props.selectedId ? "selected" : ""}
                    onClick={() => props.onSelect(a.id)}
                  >
                    <span className={`badge badge-${a.type}`}>{a.type}</span>
                    <span className="title">{a.title}</span>
                    <span className={`status status-${a.status}`}>{a.status.replace(/_/g, " ")}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )
      })}
    </div>
  )
}
```

(`onClick` stores `collapsed[key] = open` — i.e. when currently open, mark it collapsed, and vice-versa — so a click always toggles relative to the displayed state.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd companion && bun run test src/components/ArtifactList.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 6: Add styles** — append to `companion/src/App.css`:

```css
.artifact-groups { display: flex; flex-direction: column; gap: 6px; }
.artifact-group { display: flex; flex-direction: column; }
.group-header { display: flex; align-items: center; gap: 6px; width: 100%; padding: 6px 4px; background: none; border: none; color: var(--text-muted); font-size: 11px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; cursor: pointer; text-align: left; }
.group-header:hover { color: var(--text); }
.group-chevron { width: 10px; font-size: 10px; }
.group-title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-transform: none; letter-spacing: normal; font-size: 12.5px; }
.group-count { background: var(--surface-2); color: var(--text-muted); border-radius: 999px; padding: 1px 7px; font-size: 10px; }
.artifact-group .artifact-list { padding-left: 4px; }
```

- [ ] **Step 7: Run the full companion suite + typecheck + build**

Run: `cd companion && bun run test && bunx tsc --noEmit -p tsconfig.json && bun run build`
Expected: all companion tests PASS (existing App tests still pass — their single mocked artifact forms one group that, being the selected one, is expanded so its items are visible); typecheck clean; `dist/` produced.

- [ ] **Step 8: Commit**

```bash
git add companion/src/api.ts companion/src/components/ArtifactList.tsx companion/src/components/ArtifactList.test.tsx companion/src/App.css
git commit -m "feat: group the artifact list by session with collapsible headers"
```

---

## Self-Review Notes

- **Spec coverage:** server `resolveSessionTitle` option + list augmentation (Task 1 a/b + tests); SDK-backed cached resolver in `index.ts` with shape-verification + fallback (Task 1 step 5); companion `Artifact` gains `sessionID`/`sessionTitle` (Task 2 step 1); grouped collapsible list with title-or-short-id headers, counts, recency ordering, selected-group expansion, and an "Ungrouped" section (Task 2 step 4 + tests); themed styles (Task 2 step 6). Behavior otherwise unchanged — App passes the same props to `ArtifactList`, no App.tsx change.
- **Type consistency:** `resolveSessionTitle: (sessionID: string) => Promise<string | undefined>` matches between `ServerOptions`, the server test's fake, and the `index.ts` implementation. `Artifact.sessionID`/`sessionTitle` are optional and used the same way in `ArtifactList`. The `__ungrouped__` sentinel and `Session <last 6>` fallback match the test expectations ("Ungrouped", titles shown).
- **No placeholders:** every step is a concrete edit with the exact code.
- **Note:** existing App tests don't set `sessionID` on their mocked artifacts, so each renders under "Ungrouped" — which is the selected group and therefore expanded, keeping all current item/text queries valid.
