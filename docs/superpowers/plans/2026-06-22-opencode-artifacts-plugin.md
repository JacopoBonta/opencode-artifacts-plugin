# opencode Artifacts Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an opencode plugin where an agent publishes plan and report artifacts, and the user reviews them — inline anchored comments, approve/request-changes — in an auto-opened browser companion; plans block the agent until approved.

**Architecture:** A TypeScript opencode plugin is the hub. It registers a `publish_artifact` custom tool, runs a local Bun HTTP + SSE server that serves a prebuilt React companion and a JSON API, and persists artifacts to `.opencode/artifacts/`. Plan publishes block on a pending promise resolved by the browser verdict; report publishes return immediately and can trigger a refinement turn via the SDK.

**Tech Stack:** TypeScript (ES modules), Bun (runtime, `Bun.serve`, `bun test`), `@opencode-ai/plugin` + `@opencode-ai/sdk` (v1.17.x), React + Vite + `react-markdown` for the companion, Vitest + @testing-library/react for companion tests.

---

## File Structure

**Plugin (root package, run by Bun/opencode):**
- `package.json` — root package, deps, scripts.
- `tsconfig.json` — TS config.
- `src/types.ts` — shared types (`Artifact`, `Comment`, `Anchor`, `Verdict`, etc.).
- `src/anchor.ts` — pure text-quote anchor matching (find/orphan detection).
- `src/store.ts` — persistence + in-memory state + pending verdict promises.
- `src/events.ts` — SSE broadcaster (subscriber registry + broadcast).
- `src/server.ts` — `Bun.serve` HTTP + SSE server; JSON API + static companion assets.
- `src/tools.ts` — `publish_artifact` tool factory (blocking plan / non-blocking report).
- `src/index.ts` — plugin entry: start server, register tool, track session id, `dispose`.
- `src/*.test.ts` — Bun tests colocated next to each module.

**Companion (sub-package, prebuilt to static assets):**
- `companion/package.json`, `companion/vite.config.ts`, `companion/index.html`, `companion/tsconfig.json`
- `companion/src/main.tsx` — React entry.
- `companion/src/api.ts` — fetch + SSE client.
- `companion/src/anchor-dom.ts` — DOM selection → text-quote anchor; anchor → highlight range.
- `companion/src/App.tsx` — layout + state.
- `companion/src/components/ArtifactList.tsx`, `ArtifactView.tsx`, `CommentThread.tsx`, `ActionBar.tsx`
- `companion/src/*.test.tsx` — Vitest component tests.
- `companion/dist/` — build output the plugin serves (gitignored or committed for distribution).

---

## Task 1: Project scaffolding

**Files:**
- Create: `package.json`, `tsconfig.json`, `.gitignore`, `src/smoke.test.ts`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "opencode-artifacts-plugin",
  "version": "0.1.0",
  "type": "module",
  "main": "src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "test": "bun test src",
    "build:companion": "cd companion && bun install && bun run build",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@opencode-ai/plugin": "^1.17.9",
    "@opencode-ai/sdk": "^1.17.9"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "@types/bun": "latest"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "types": ["bun"],
    "lib": ["ESNext", "DOM"],
    "noEmit": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `.gitignore`**

```
node_modules/
companion/node_modules/
companion/dist/
.opencode/artifacts/
*.log
```

- [ ] **Step 4: Write smoke test `src/smoke.test.ts`**

```ts
import { test, expect } from "bun:test"

test("test runner works", () => {
  expect(1 + 1).toBe(2)
})
```

- [ ] **Step 5: Install and run**

Run: `bun install && bun test src`
Expected: 1 pass.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: scaffold plugin project"
```

---

## Task 2: Shared types

**Files:**
- Create: `src/types.ts`, `src/types.test.ts`

- [ ] **Step 1: Write the failing test `src/types.test.ts`**

```ts
import { test, expect } from "bun:test"
import { isPlan, type Artifact } from "./types"

test("isPlan narrows by type", () => {
  const a: Artifact = {
    id: "x", type: "plan", title: "T", status: "awaiting_review",
    currentRevision: 1, createdAt: 0, updatedAt: 0,
  }
  expect(isPlan(a)).toBe(true)
  expect(isPlan({ ...a, type: "report" })).toBe(false)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/types.test.ts`
Expected: FAIL — cannot find module `./types`.

- [ ] **Step 3: Write `src/types.ts`**

```ts
export type ArtifactType = "plan" | "report"

export type ArtifactStatus =
  | "awaiting_review"
  | "approved"
  | "changes_requested"
  | "published"

export interface Anchor {
  quote: string
  prefix: string
  suffix: string
}

export type CommentKind = "anchor" | "general"

export interface Comment {
  id: string
  revision: number
  kind: CommentKind
  anchor?: Anchor
  body: string
  resolved: boolean
  createdAt: number
}

export interface Artifact {
  id: string
  type: ArtifactType
  title: string
  status: ArtifactStatus
  currentRevision: number
  createdAt: number
  updatedAt: number
  /** opencode session that published this artifact, for report refinement */
  sessionID?: string
}

export type Verdict =
  | { status: "approved" }
  | { status: "changes_requested"; comments: Comment[] }

export function isPlan(a: Pick<Artifact, "type">): boolean {
  return a.type === "plan"
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/types.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/types.test.ts
git commit -m "feat: shared artifact types"
```

---

## Task 3: Anchor matching (pure logic)

Text-quote anchors locate a comment by its quoted text plus surrounding context, so anchors survive small edits and degrade to "orphaned" when the text disappears.

**Files:**
- Create: `src/anchor.ts`, `src/anchor.test.ts`

- [ ] **Step 1: Write failing tests `src/anchor.test.ts`**

```ts
import { test, expect } from "bun:test"
import { makeAnchor, matchAnchor } from "./anchor"

const TEXT = "Alpha beta gamma. Alpha beta delta. The end."

test("makeAnchor captures quote with surrounding context", () => {
  const a = makeAnchor(TEXT, 18, 34) // "Alpha beta delta"
  expect(a.quote).toBe("Alpha beta delta")
  expect(TEXT.endsWith(a.suffix) || TEXT.includes(a.suffix)).toBe(true)
  expect(a.prefix.length).toBeGreaterThan(0)
})

test("matchAnchor finds unique quote", () => {
  const a = makeAnchor(TEXT, 18, 34)
  const m = matchAnchor(TEXT, a)
  expect(m).toEqual({ start: 18, end: 34 })
})

test("matchAnchor disambiguates duplicate quotes via context", () => {
  const a = makeAnchor(TEXT, 0, 10) // first "Alpha beta"
  const m = matchAnchor(TEXT, a)
  expect(m).toEqual({ start: 0, end: 10 })
})

test("matchAnchor returns null (orphaned) when quote is gone", () => {
  const a = makeAnchor(TEXT, 0, 10)
  expect(matchAnchor("completely different content", a)).toBeNull()
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/anchor.test.ts`
Expected: FAIL — cannot find module `./anchor`.

- [ ] **Step 3: Write `src/anchor.ts`**

```ts
import type { Anchor } from "./types"

const CONTEXT = 32

export function makeAnchor(text: string, start: number, end: number): Anchor {
  return {
    quote: text.slice(start, end),
    prefix: text.slice(Math.max(0, start - CONTEXT), start),
    suffix: text.slice(end, end + CONTEXT),
  }
}

/** All start indices where `needle` occurs in `hay`. */
function allIndexes(hay: string, needle: string): number[] {
  if (!needle) return []
  const out: number[] = []
  let i = hay.indexOf(needle)
  while (i !== -1) {
    out.push(i)
    i = hay.indexOf(needle, i + 1)
  }
  return out
}

/**
 * Locate the anchor in `text`. Returns the best {start,end} or null if the
 * quote no longer exists (orphaned). When the quote occurs multiple times the
 * candidate whose surrounding context best matches prefix/suffix wins.
 */
export function matchAnchor(
  text: string,
  anchor: Anchor,
): { start: number; end: number } | null {
  const candidates = allIndexes(text, anchor.quote)
  if (candidates.length === 0) return null
  if (candidates.length === 1) {
    return { start: candidates[0], end: candidates[0] + anchor.quote.length }
  }

  let best = candidates[0]
  let bestScore = -1
  for (const start of candidates) {
    const end = start + anchor.quote.length
    const beforeText = text.slice(Math.max(0, start - anchor.prefix.length), start)
    const afterText = text.slice(end, end + anchor.suffix.length)
    const score =
      commonSuffixLen(beforeText, anchor.prefix) +
      commonPrefixLen(afterText, anchor.suffix)
    if (score > bestScore) {
      bestScore = score
      best = start
    }
  }
  return { start: best, end: best + anchor.quote.length }
}

function commonPrefixLen(a: string, b: string): number {
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  return i
}

function commonSuffixLen(a: string, b: string): number {
  let i = 0
  while (i < a.length && i < b.length && a[a.length - 1 - i] === b[b.length - 1 - i]) i++
  return i
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/anchor.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/anchor.ts src/anchor.test.ts
git commit -m "feat: text-quote anchor matching with orphan detection"
```

---

## Task 4: Store — persistence, state, pending verdicts

The store owns the on-disk layout, in-memory artifact state, comments, and the map of pending plan-verdict promises. `clock` and `idgen` are injected for deterministic tests.

**Files:**
- Create: `src/store.ts`, `src/store.test.ts`

- [ ] **Step 1: Write failing tests `src/store.test.ts`**

```ts
import { test, expect, beforeEach } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createStore } from "./store"

function newStore() {
  const dir = mkdtempSync(join(tmpdir(), "artifacts-"))
  let now = 1000
  let n = 0
  return createStore({
    root: dir,
    clock: () => now++,
    idgen: () => `id${++n}`,
  })
}

test("publish creates artifact + revision 1 on disk", async () => {
  const store = newStore()
  const { artifact } = await store.publish({ type: "plan", title: "P", content: "# Hi" })
  expect(artifact.id).toBe("id1")
  expect(artifact.currentRevision).toBe(1)
  expect(artifact.status).toBe("awaiting_review")
  expect(await store.readRevision(artifact.id, 1)).toBe("# Hi")
})

test("publish with existing id adds a revision", async () => {
  const store = newStore()
  const { artifact } = await store.publish({ type: "plan", title: "P", content: "v1" })
  const { artifact: a2 } = await store.publish({
    type: "plan", title: "P", content: "v2", artifactId: artifact.id,
  })
  expect(a2.currentRevision).toBe(2)
  expect(await store.readRevision(artifact.id, 2)).toBe("v2")
})

test("addComment persists and is retrievable", async () => {
  const store = newStore()
  const { artifact } = await store.publish({ type: "plan", title: "P", content: "x" })
  const c = await store.addComment(artifact.id, {
    revision: 1, kind: "general", body: "fix this",
  })
  expect(c.id).toBe("id2")
  expect(c.resolved).toBe(false)
  const comments = await store.getComments(artifact.id)
  expect(comments).toHaveLength(1)
})

test("awaitVerdict resolves when resolveVerdict is called", async () => {
  const store = newStore()
  const { artifact } = await store.publish({ type: "plan", title: "P", content: "x" })
  const pending = store.awaitVerdict(artifact.id)
  store.resolveVerdict(artifact.id, { status: "approved" })
  expect(await pending).toEqual({ status: "approved" })
  expect((await store.get(artifact.id))!.status).toBe("approved")
})

test("disposeAll rejects pending verdicts", async () => {
  const store = newStore()
  const { artifact } = await store.publish({ type: "plan", title: "P", content: "x" })
  const pending = store.awaitVerdict(artifact.id)
  store.disposeAll()
  await expect(pending).rejects.toThrow()
})

test("state survives reload from disk", async () => {
  const dir = mkdtempSync(join(tmpdir(), "artifacts-"))
  const opts = { root: dir, clock: () => 1, idgen: () => "id1" }
  const s1 = createStore(opts)
  await s1.publish({ type: "report", title: "R", content: "done" })
  const s2 = createStore(opts)
  await s2.load()
  const list = await s2.list()
  expect(list).toHaveLength(1)
  expect(list[0].title).toBe("R")
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/store.test.ts`
Expected: FAIL — cannot find module `./store`.

- [ ] **Step 3: Write `src/store.ts`**

```ts
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises"
import { existsSync } from "node:fs"
import { join } from "node:path"
import type { Artifact, ArtifactType, Comment, Verdict } from "./types"

export interface StoreOptions {
  root: string
  clock?: () => number
  idgen?: () => string
}

export interface PublishInput {
  type: ArtifactType
  title: string
  content: string
  artifactId?: string
  sessionID?: string
}

interface Pending {
  resolve: (v: Verdict) => void
  reject: (e: Error) => void
}

export function createStore(opts: StoreOptions) {
  const root = opts.root
  const clock = opts.clock ?? (() => Date.now())
  let counter = 0
  const idgen = opts.idgen ?? (() => `${clock()}-${++counter}`)

  const artifacts = new Map<string, Artifact>()
  const comments = new Map<string, Comment[]>()
  const pending = new Map<string, Pending>()

  const artDir = (id: string) => join(root, id)
  const metaPath = (id: string) => join(artDir(id), "meta.json")
  const commentsPath = (id: string) => join(artDir(id), "comments.json")
  const revPath = (id: string, rev: number) =>
    join(artDir(id), "revisions", String(rev).padStart(3, "0") + ".md")

  async function persistMeta(a: Artifact) {
    await writeFile(metaPath(a.id), JSON.stringify(a, null, 2))
  }
  async function persistComments(id: string) {
    await writeFile(commentsPath(id), JSON.stringify(comments.get(id) ?? [], null, 2))
  }

  async function publish(input: PublishInput): Promise<{ artifact: Artifact }> {
    const now = clock()
    let a: Artifact
    if (input.artifactId && artifacts.has(input.artifactId)) {
      a = artifacts.get(input.artifactId)!
      a.currentRevision += 1
      a.title = input.title
      a.status = input.type === "plan" ? "awaiting_review" : "published"
      a.updatedAt = now
    } else {
      const id = input.artifactId ?? idgen()
      a = {
        id,
        type: input.type,
        title: input.title,
        status: input.type === "plan" ? "awaiting_review" : "published",
        currentRevision: 1,
        createdAt: now,
        updatedAt: now,
        sessionID: input.sessionID,
      }
      artifacts.set(id, a)
      comments.set(id, [])
    }
    await mkdir(join(artDir(a.id), "revisions"), { recursive: true })
    await writeFile(revPath(a.id, a.currentRevision), input.content)
    await persistMeta(a)
    if (!existsSync(commentsPath(a.id))) await persistComments(a.id)
    return { artifact: { ...a } }
  }

  async function readRevision(id: string, rev: number): Promise<string> {
    return readFile(revPath(id, rev), "utf8")
  }

  async function addComment(
    id: string,
    input: Omit<Comment, "id" | "resolved" | "createdAt">,
  ): Promise<Comment> {
    const c: Comment = { ...input, id: idgen(), resolved: false, createdAt: clock() }
    const list = comments.get(id) ?? []
    list.push(c)
    comments.set(id, list)
    await persistComments(id)
    return c
  }

  async function getComments(id: string): Promise<Comment[]> {
    return [...(comments.get(id) ?? [])]
  }

  function awaitVerdict(id: string): Promise<Verdict> {
    return new Promise<Verdict>((resolve, reject) => {
      pending.set(id, { resolve, reject })
    })
  }

  async function resolveVerdict(id: string, verdict: Verdict): Promise<void> {
    const a = artifacts.get(id)
    if (a) {
      a.status = verdict.status === "approved" ? "approved" : "changes_requested"
      a.updatedAt = clock()
      await persistMeta(a)
    }
    const p = pending.get(id)
    if (p) {
      pending.delete(id)
      p.resolve(verdict)
    }
  }

  function disposeAll() {
    for (const [, p] of pending) p.reject(new Error("store disposed: review abandoned"))
    pending.clear()
  }

  async function get(id: string): Promise<Artifact | undefined> {
    const a = artifacts.get(id)
    return a ? { ...a } : undefined
  }

  async function list(): Promise<Artifact[]> {
    return [...artifacts.values()].map((a) => ({ ...a }))
  }

  async function load(): Promise<void> {
    if (!existsSync(root)) return
    for (const id of await readdir(root)) {
      const mp = metaPath(id)
      if (!existsSync(mp)) continue
      const a: Artifact = JSON.parse(await readFile(mp, "utf8"))
      artifacts.set(id, a)
      const cp = commentsPath(id)
      comments.set(id, existsSync(cp) ? JSON.parse(await readFile(cp, "utf8")) : [])
    }
  }

  return {
    publish, readRevision, addComment, getComments,
    awaitVerdict, resolveVerdict, disposeAll, get, list, load,
    hasPending: (id: string) => pending.has(id),
  }
}

export type Store = ReturnType<typeof createStore>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/store.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/store.ts src/store.test.ts
git commit -m "feat: artifact store with persistence and pending verdicts"
```

---

## Task 5: SSE event broadcaster

**Files:**
- Create: `src/events.ts`, `src/events.test.ts`

- [ ] **Step 1: Write failing tests `src/events.test.ts`**

```ts
import { test, expect } from "bun:test"
import { createBroadcaster } from "./events"

test("broadcast delivers to all subscribers", () => {
  const b = createBroadcaster()
  const got: string[] = []
  const un1 = b.subscribe((d) => got.push("a:" + d))
  b.subscribe((d) => got.push("b:" + d))
  b.broadcast({ type: "artifact.published", id: "x" })
  expect(got).toEqual([
    'a:{"type":"artifact.published","id":"x"}',
    'b:{"type":"artifact.published","id":"x"}',
  ])
  un1()
  b.broadcast({ type: "ping" })
  expect(got.filter((g) => g.startsWith("a:"))).toHaveLength(1)
})

test("unsubscribe stops delivery and count tracks subscribers", () => {
  const b = createBroadcaster()
  const un = b.subscribe(() => {})
  expect(b.count()).toBe(1)
  un()
  expect(b.count()).toBe(0)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/events.test.ts`
Expected: FAIL — cannot find module `./events`.

- [ ] **Step 3: Write `src/events.ts`**

```ts
export type ServerEvent =
  | { type: "artifact.published"; id: string }
  | { type: "artifact.updated"; id: string }
  | { type: "comment.added"; id: string }
  | { type: "ping" }

type Listener = (data: string) => void

export function createBroadcaster() {
  const listeners = new Set<Listener>()

  return {
    subscribe(fn: Listener): () => void {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    broadcast(event: ServerEvent): void {
      const data = JSON.stringify(event)
      for (const fn of listeners) fn(data)
    },
    count: () => listeners.size,
  }
}

export type Broadcaster = ReturnType<typeof createBroadcaster>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/events.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/events.ts src/events.test.ts
git commit -m "feat: SSE broadcaster"
```

---

## Task 6: HTTP + SSE server

`Bun.serve` server exposing the JSON API, the SSE stream, and the static companion. `createServer` returns the bound port and a `stop()`; an injectable `staticDir` lets tests skip the prebuilt assets.

**Files:**
- Create: `src/server.ts`, `src/server.test.ts`

- [ ] **Step 1: Write failing tests `src/server.test.ts`**

```ts
import { test, expect, afterEach } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createStore } from "./store"
import { createBroadcaster } from "./events"
import { createServer } from "./server"

let stop: (() => void) | null = null
afterEach(() => { stop?.(); stop = null })

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "artifacts-"))
  const store = createStore({ root: dir, clock: () => 1, idgen: (() => { let n = 0; return () => `id${++n}` })() })
  const events = createBroadcaster()
  const refine = { called: [] as any[] }
  const srv = createServer({
    store, events, port: 0, staticDir: null,
    onRefine: (id, comments) => { refine.called.push({ id, comments }) },
  })
  stop = srv.stop
  return { store, events, srv, refine }
}

test("GET /api/artifacts lists artifacts", async () => {
  const { store, srv } = setup()
  await store.publish({ type: "plan", title: "P", content: "x" })
  const res = await fetch(`${srv.url}/api/artifacts`)
  const body = await res.json()
  expect(body).toHaveLength(1)
  expect(body[0].title).toBe("P")
})

test("GET /api/artifacts/:id returns meta, content, comments", async () => {
  const { store, srv } = setup()
  const { artifact } = await store.publish({ type: "plan", title: "P", content: "# Hello" })
  const res = await fetch(`${srv.url}/api/artifacts/${artifact.id}`)
  const body = await res.json()
  expect(body.artifact.title).toBe("P")
  expect(body.content).toBe("# Hello")
  expect(body.comments).toEqual([])
})

test("POST comment then verdict resolves a pending plan", async () => {
  const { store, srv } = setup()
  const { artifact } = await store.publish({ type: "plan", title: "P", content: "x" })
  const pending = store.awaitVerdict(artifact.id)

  await fetch(`${srv.url}/api/artifacts/${artifact.id}/comments`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ revision: 1, kind: "general", body: "tweak" }),
  })
  await fetch(`${srv.url}/api/artifacts/${artifact.id}/verdict`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: "changes_requested" }),
  })

  const verdict = await pending
  expect(verdict.status).toBe("changes_requested")
  if (verdict.status === "changes_requested") {
    expect(verdict.comments[0].body).toBe("tweak")
  }
})

test("POST verdict {refine} on a report triggers onRefine", async () => {
  const { store, srv, refine } = setup()
  const { artifact } = await store.publish({ type: "report", title: "R", content: "done" })
  await fetch(`${srv.url}/api/artifacts/${artifact.id}/verdict`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: "refine" }),
  })
  expect(refine.called).toHaveLength(1)
  expect(refine.called[0].id).toBe(artifact.id)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/server.test.ts`
Expected: FAIL — cannot find module `./server`.

- [ ] **Step 3: Write `src/server.ts`**

```ts
import { join } from "node:path"
import { existsSync } from "node:fs"
import type { Store } from "./store"
import type { Broadcaster } from "./events"
import type { Comment } from "./types"

export interface ServerOptions {
  store: Store
  events: Broadcaster
  /** 0 = pick a free port */
  port?: number
  /** directory of prebuilt companion assets, or null to disable static serving */
  staticDir?: string | null
  /** called when a report's "request refinement" verdict arrives */
  onRefine?: (artifactId: string, comments: Comment[]) => void
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  })

export function createServer(opts: ServerOptions) {
  const { store, events } = opts
  const staticDir = opts.staticDir ?? null

  const server = Bun.serve({
    port: opts.port ?? 0,
    async fetch(req) {
      const url = new URL(req.url)
      const path = url.pathname

      // --- SSE stream ---
      if (path === "/api/events") {
        const stream = new ReadableStream({
          start(controller) {
            const enc = new TextEncoder()
            const send = (data: string) =>
              controller.enqueue(enc.encode(`data: ${data}\n\n`))
            send(JSON.stringify({ type: "ping" }))
            const unsub = events.subscribe(send)
            req.signal.addEventListener("abort", () => { unsub(); controller.close() })
          },
        })
        return new Response(stream, {
          headers: {
            "content-type": "text/event-stream",
            "cache-control": "no-cache",
            connection: "keep-alive",
          },
        })
      }

      // --- API ---
      if (path === "/api/artifacts" && req.method === "GET") {
        return json(await store.list())
      }

      const detail = path.match(/^\/api\/artifacts\/([^/]+)$/)
      if (detail && req.method === "GET") {
        const id = detail[1]
        const artifact = await store.get(id)
        if (!artifact) return json({ error: "not found" }, 404)
        const content = await store.readRevision(id, artifact.currentRevision)
        const comments = await store.getComments(id)
        return json({ artifact, content, comments })
      }

      const revMatch = path.match(/^\/api\/artifacts\/([^/]+)\/revisions\/(\d+)$/)
      if (revMatch && req.method === "GET") {
        const content = await store.readRevision(revMatch[1], Number(revMatch[2]))
        return json({ content })
      }

      const commentMatch = path.match(/^\/api\/artifacts\/([^/]+)\/comments$/)
      if (commentMatch && req.method === "POST") {
        const id = commentMatch[1]
        const b = await req.json()
        const c = await store.addComment(id, {
          revision: b.revision, kind: b.kind, anchor: b.anchor, body: b.body,
        })
        events.broadcast({ type: "comment.added", id })
        return json(c, 201)
      }

      const verdictMatch = path.match(/^\/api\/artifacts\/([^/]+)\/verdict$/)
      if (verdictMatch && req.method === "POST") {
        const id = verdictMatch[1]
        const b = await req.json()
        if (b.status === "refine") {
          const comments = (await store.getComments(id)).filter((c) => !c.resolved)
          opts.onRefine?.(id, comments)
          events.broadcast({ type: "artifact.updated", id })
          return json({ ok: true })
        }
        const comments =
          b.status === "changes_requested"
            ? (await store.getComments(id)).filter((c) => !c.resolved)
            : []
        await store.resolveVerdict(
          id,
          b.status === "approved" ? { status: "approved" } : { status: "changes_requested", comments },
        )
        events.broadcast({ type: "artifact.updated", id })
        return json({ ok: true })
      }

      // --- static companion ---
      if (staticDir && !path.startsWith("/api/")) {
        const rel = path === "/" ? "index.html" : path.slice(1)
        const file = join(staticDir, rel)
        if (existsSync(file)) return new Response(Bun.file(file))
        const index = join(staticDir, "index.html")
        if (existsSync(index)) return new Response(Bun.file(index)) // SPA fallback
      }

      return json({ error: "not found" }, 404)
    },
  })

  const url = `http://localhost:${server.port}`
  return { url, port: server.port, stop: () => server.stop(true) }
}

export type ArtifactServer = ReturnType<typeof createServer>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/server.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server.ts src/server.test.ts
git commit -m "feat: HTTP + SSE server with artifact API"
```

---

## Task 7: `publish_artifact` tool

A factory that builds the tool over an injected store, server URL, broadcaster, and a `notify` callback (toast/open-browser, injected so tests stay headless). Plans block on `awaitVerdict`; reports return immediately.

**Files:**
- Create: `src/tools.ts`, `src/tools.test.ts`

- [ ] **Step 1: Write failing tests `src/tools.test.ts`**

```ts
import { test, expect } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createStore } from "./store"
import { createBroadcaster } from "./events"
import { createPublishTool } from "./tools"

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "artifacts-"))
  const store = createStore({ root: dir, clock: () => 1, idgen: (() => { let n = 0; return () => `id${++n}` })() })
  const events = createBroadcaster()
  const notes: string[] = []
  const tool = createPublishTool({
    store, events, url: "http://localhost:9999",
    notify: (m) => notes.push(m),
  })
  return { store, tool, notes }
}

test("report publish returns immediately with id + url", async () => {
  const { tool } = setup()
  const out = await tool.execute(
    { type: "report", title: "R", content: "done" },
    { sessionID: "s1" } as any,
  )
  const parsed = JSON.parse(out)
  expect(parsed.artifactId).toBe("id1")
  expect(parsed.url).toContain("/artifacts/id1")
})

test("plan publish blocks until verdict, returns approved", async () => {
  const { tool, store } = setup()
  const exec = tool.execute(
    { type: "plan", title: "P", content: "x" },
    { sessionID: "s1" } as any,
  )
  // resolve on next tick once the artifact exists
  await Promise.resolve()
  await store.resolveVerdict("id1", { status: "approved" })
  const parsed = JSON.parse(await exec)
  expect(parsed.status).toBe("approved")
})

test("plan publish returns changes_requested with comment bodies", async () => {
  const { tool, store } = setup()
  const exec = tool.execute(
    { type: "plan", title: "P", content: "x" },
    { sessionID: "s1" } as any,
  )
  await Promise.resolve()
  await store.addComment("id1", { revision: 1, kind: "general", body: "redo intro" })
  await store.resolveVerdict("id1", {
    status: "changes_requested",
    comments: await store.getComments("id1"),
  })
  const parsed = JSON.parse(await exec)
  expect(parsed.status).toBe("changes_requested")
  expect(parsed.comments[0].body).toBe("redo intro")
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/tools.test.ts`
Expected: FAIL — cannot find module `./tools`.

- [ ] **Step 3: Write `src/tools.ts`**

```ts
import { tool } from "@opencode-ai/plugin"
import type { Store } from "./store"
import type { Broadcaster } from "./events"

export interface ToolDeps {
  store: Store
  events: Broadcaster
  url: string
  /** show a toast / open the browser; injected so tests stay headless */
  notify: (message: string, artifactUrl: string) => void
}

export function createPublishTool(deps: ToolDeps) {
  const { store, events, url, notify } = deps

  return tool({
    description:
      "Publish an artifact for human review in the browser companion. " +
      "type='plan' BLOCKS until the user approves or requests changes and " +
      "returns their verdict; revise and re-publish with the same artifactId " +
      "on changes_requested. type='report' returns immediately. Content is markdown.",
    args: {
      type: tool.schema.enum(["plan", "report"]).describe("plan gates the work; report is informational"),
      title: tool.schema.string().describe("short artifact title"),
      content: tool.schema.string().describe("artifact body in markdown"),
      artifactId: tool.schema
        .string()
        .optional()
        .describe("omit to create new; pass to add a revision to an existing artifact"),
    },
    async execute(args, context) {
      const sessionID = (context as { sessionID?: string }).sessionID
      const { artifact } = await store.publish({
        type: args.type,
        title: args.title,
        content: args.content,
        artifactId: args.artifactId,
        sessionID,
      })
      const artifactUrl = `${url}/artifacts/${artifact.id}`
      events.broadcast({ type: "artifact.published", id: artifact.id })

      if (args.type === "report") {
        notify(`Report published: ${artifact.title}`, artifactUrl)
        return JSON.stringify({ artifactId: artifact.id, url: artifactUrl })
      }

      notify(`Plan awaiting review: ${artifact.title}`, artifactUrl)
      const verdict = await store.awaitVerdict(artifact.id)
      if (verdict.status === "approved") {
        return JSON.stringify({ status: "approved", artifactId: artifact.id })
      }
      return JSON.stringify({
        status: "changes_requested",
        artifactId: artifact.id,
        comments: verdict.comments.map((c) => ({
          body: c.body,
          kind: c.kind,
          quote: c.anchor?.quote,
        })),
      })
    },
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/tools.test.ts`
Expected: PASS (3 tests). If `@opencode-ai/plugin`'s `tool()` wraps execute such that direct `.execute()` calls differ, adjust the test to call the exported execute via `tool.execute` shape used by the installed version — verify against `node_modules/@opencode-ai/plugin`.

- [ ] **Step 5: Commit**

```bash
git add src/tools.ts src/tools.test.ts
git commit -m "feat: publish_artifact tool (blocking plan / non-blocking report)"
```

---

## Task 8: Plugin entry — wiring + lifecycle

Ties everything together: loads the store, starts the server pointing at the prebuilt companion, registers the tool, tracks the latest session id (for report refinement), opens the browser on first publish, and cleans up on `dispose`.

**Files:**
- Create: `src/index.ts`, `src/index.test.ts`

- [ ] **Step 1: Write failing test `src/index.test.ts`**

```ts
import { test, expect } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import ArtifactsPlugin from "./index"

test("plugin initializes, exposes publish_artifact tool, and disposes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "proj-"))
  const toasts: any[] = []
  const fakeClient = {
    tui: { showToast: async (a: any) => { toasts.push(a) } },
    session: { prompt: async () => {} },
  }
  const hooks = await ArtifactsPlugin({
    directory: dir,
    worktree: dir,
    client: fakeClient as any,
    $: (() => {}) as any,
    project: {} as any,
  })
  expect(hooks.tool?.publish_artifact).toBeDefined()
  await hooks.dispose?.()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/index.test.ts`
Expected: FAIL — cannot find module `./index`.

- [ ] **Step 3: Write `src/index.ts`**

```ts
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { existsSync } from "node:fs"
import type { Plugin } from "@opencode-ai/plugin"
import { createStore } from "./store"
import { createBroadcaster } from "./events"
import { createServer } from "./server"
import { createPublishTool } from "./tools"

const here = dirname(fileURLToPath(import.meta.url))

const ArtifactsPlugin: Plugin = async ({ directory, client }) => {
  const store = createStore({ root: join(directory, ".opencode", "artifacts") })
  await store.load()

  const events = createBroadcaster()
  let lastSessionID: string | undefined

  const staticDir = join(here, "..", "companion", "dist")
  const server = createServer({
    store,
    events,
    port: Number(process.env.OPENCODE_ARTIFACTS_PORT ?? 0),
    staticDir: existsSync(staticDir) ? staticDir : null,
    onRefine: async (id, comments) => {
      const artifact = await store.get(id)
      const sid = artifact?.sessionID ?? lastSessionID
      const summary = comments.map((c) => `- ${c.anchor?.quote ? `(re: "${c.anchor.quote}") ` : ""}${c.body}`).join("\n")
      const text = `The user requested refinement of report "${artifact?.title}". Their comments:\n${summary}\nPlease revise and re-publish with artifactId "${id}".`
      try {
        if (sid) await client.session.prompt({ path: { id: sid }, body: { parts: [{ type: "text", text }] } } as any)
        else await client.tui.appendPrompt({ body: { text } } as any)
      } catch {
        await client.tui.appendPrompt({ body: { text } } as any).catch(() => {})
      }
    },
  })

  let opened = false
  const tool = createPublishTool({
    store,
    events,
    url: server.url,
    notify: (message, artifactUrl) => {
      client.tui.showToast({ body: { message, variant: "info" } } as any).catch(() => {})
      if (!opened) {
        opened = true
        openBrowser(server.url).catch(() => {})
      }
    },
  })

  return {
    tool: { publish_artifact: tool },
    event: async ({ event }: { event: any }) => {
      const sid = event?.properties?.sessionID ?? event?.properties?.info?.sessionID
      if (sid) lastSessionID = sid
    },
    dispose: async () => {
      store.disposeAll()
      server.stop()
    },
  }
}

async function openBrowser(url: string): Promise<void> {
  const cmd =
    process.platform === "darwin" ? ["open", url]
    : process.platform === "win32" ? ["cmd", "/c", "start", "", url]
    : ["xdg-open", url]
  Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" })
}

export default ArtifactsPlugin
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/index.test.ts`
Expected: PASS. Note: this exercises init + dispose; the toast/openBrowser paths are guarded with `.catch`. If the installed SDK's `showToast`/`session.prompt` argument shapes differ from the `as any` casts here, fix the call sites against `node_modules/@opencode-ai/sdk` types and re-run.

- [ ] **Step 5: Run the full backend suite + typecheck**

Run: `bun test src && bun run typecheck`
Expected: all suites PASS; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/index.ts src/index.test.ts
git commit -m "feat: plugin entry wiring and lifecycle"
```

---

## Task 9: Companion scaffold (React + Vite)

**Files:**
- Create: `companion/package.json`, `companion/vite.config.ts`, `companion/tsconfig.json`, `companion/index.html`, `companion/src/main.tsx`, `companion/vitest.setup.ts`

- [ ] **Step 1: Create `companion/package.json`**

```json
{
  "name": "opencode-artifacts-companion",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "test": "vitest run"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-markdown": "^9.0.1"
  },
  "devDependencies": {
    "@testing-library/react": "^16.0.0",
    "@testing-library/user-event": "^14.5.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "jsdom": "^25.0.0",
    "typescript": "^5.6.0",
    "vite": "^5.4.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create `companion/vite.config.ts`**

```ts
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"

export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist" },
  server: { proxy: { "/api": "http://localhost:4799" } },
  test: { environment: "jsdom", setupFiles: ["./vitest.setup.ts"], globals: true },
} as any)
```

- [ ] **Step 3: Create `companion/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "lib": ["ESNext", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true,
    "types": ["vitest/globals", "@testing-library/jest-dom"]
  },
  "include": ["src", "vitest.setup.ts"]
}
```

- [ ] **Step 4: Create `companion/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>opencode Artifacts</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: Create `companion/vitest.setup.ts`**

```ts
import "@testing-library/jest-dom/vitest"
```

(Add `"@testing-library/jest-dom": "^6.5.0"` to `companion` devDependencies.)

- [ ] **Step 6: Create `companion/src/main.tsx`**

```tsx
import React from "react"
import { createRoot } from "react-dom/client"
import { App } from "./App"

createRoot(document.getElementById("root")!).render(<App />)
```

- [ ] **Step 7: Install**

Run: `cd companion && bun install`
Expected: dependencies installed.

- [ ] **Step 8: Commit**

```bash
git add companion/package.json companion/vite.config.ts companion/tsconfig.json companion/index.html companion/src/main.tsx companion/vitest.setup.ts
git commit -m "chore: scaffold React companion"
```

---

## Task 10: Companion API client

**Files:**
- Create: `companion/src/api.ts`, `companion/src/api.test.ts`

- [ ] **Step 1: Write failing test `companion/src/api.test.ts`**

```tsx
import { test, expect, vi, afterEach } from "vitest"
import { listArtifacts, getArtifact, postComment, postVerdict } from "./api"

afterEach(() => vi.restoreAllMocks())

test("listArtifacts GETs /api/artifacts", async () => {
  const fetchMock = vi.fn().mockResolvedValue({ json: async () => [{ id: "a" }] })
  vi.stubGlobal("fetch", fetchMock)
  const out = await listArtifacts()
  expect(fetchMock).toHaveBeenCalledWith("/api/artifacts")
  expect(out).toEqual([{ id: "a" }])
})

test("postVerdict POSTs status to verdict endpoint", async () => {
  const fetchMock = vi.fn().mockResolvedValue({ json: async () => ({ ok: true }) })
  vi.stubGlobal("fetch", fetchMock)
  await postVerdict("id1", "approved")
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/artifacts/id1/verdict",
    expect.objectContaining({ method: "POST" }),
  )
  const body = JSON.parse(fetchMock.mock.calls[0][1].body)
  expect(body.status).toBe("approved")
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd companion && bun run test src/api.test.ts`
Expected: FAIL — cannot find module `./api`.

- [ ] **Step 3: Write `companion/src/api.ts`**

```ts
export interface Anchor { quote: string; prefix: string; suffix: string }
export interface Comment {
  id: string; revision: number; kind: "anchor" | "general"
  anchor?: Anchor; body: string; resolved: boolean; createdAt: number
}
export interface Artifact {
  id: string; type: "plan" | "report"; title: string
  status: string; currentRevision: number; createdAt: number; updatedAt: number
}
export interface ArtifactDetail { artifact: Artifact; content: string; comments: Comment[] }

const jsonPost = (body: unknown) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
})

export async function listArtifacts(): Promise<Artifact[]> {
  return (await fetch("/api/artifacts")).json()
}
export async function getArtifact(id: string): Promise<ArtifactDetail> {
  return (await fetch(`/api/artifacts/${id}`)).json()
}
export async function postComment(
  id: string,
  c: { revision: number; kind: "anchor" | "general"; anchor?: Anchor; body: string },
): Promise<Comment> {
  return (await fetch(`/api/artifacts/${id}/comments`, jsonPost(c))).json()
}
export async function postVerdict(
  id: string,
  status: "approved" | "changes_requested" | "refine",
): Promise<void> {
  await fetch(`/api/artifacts/${id}/verdict`, jsonPost({ status }))
}
export function subscribeEvents(onEvent: (e: any) => void): () => void {
  const es = new EventSource("/api/events")
  es.onmessage = (m) => onEvent(JSON.parse(m.data))
  return () => es.close()
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd companion && bun run test src/api.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add companion/src/api.ts companion/src/api.test.ts
git commit -m "feat: companion API client"
```

---

## Task 11: DOM anchoring helper

Converts a user text selection inside the rendered markdown container into a text-quote anchor (matching the backend `Anchor` shape), and locates an anchor's character range within the container's text for highlighting.

**Files:**
- Create: `companion/src/anchor-dom.ts`, `companion/src/anchor-dom.test.ts`

- [ ] **Step 1: Write failing tests `companion/src/anchor-dom.test.ts`**

```tsx
import { test, expect } from "vitest"
import { anchorFromOffsets, findAnchorOffsets } from "./anchor-dom"

const TEXT = "Alpha beta gamma. Alpha beta delta. The end."

test("anchorFromOffsets builds quote + context", () => {
  const a = anchorFromOffsets(TEXT, 18, 34)
  expect(a.quote).toBe("Alpha beta delta")
  expect(a.prefix.length).toBeGreaterThan(0)
})

test("findAnchorOffsets locates the anchor again", () => {
  const a = anchorFromOffsets(TEXT, 18, 34)
  expect(findAnchorOffsets(TEXT, a)).toEqual({ start: 18, end: 34 })
})

test("findAnchorOffsets returns null when orphaned", () => {
  const a = anchorFromOffsets(TEXT, 18, 34)
  expect(findAnchorOffsets("nothing here", a)).toBeNull()
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd companion && bun run test src/anchor-dom.test.ts`
Expected: FAIL — cannot find module `./anchor-dom`.

- [ ] **Step 3: Write `companion/src/anchor-dom.ts`**

```ts
import type { Anchor } from "./api"

const CONTEXT = 32

export function anchorFromOffsets(text: string, start: number, end: number): Anchor {
  return {
    quote: text.slice(start, end),
    prefix: text.slice(Math.max(0, start - CONTEXT), start),
    suffix: text.slice(end, end + CONTEXT),
  }
}

export function findAnchorOffsets(
  text: string,
  anchor: Anchor,
): { start: number; end: number } | null {
  const idxs: number[] = []
  let i = anchor.quote ? text.indexOf(anchor.quote) : -1
  while (i !== -1) { idxs.push(i); i = text.indexOf(anchor.quote, i + 1) }
  if (idxs.length === 0) return null
  if (idxs.length === 1) return { start: idxs[0], end: idxs[0] + anchor.quote.length }

  let best = idxs[0], bestScore = -1
  for (const s of idxs) {
    const e = s + anchor.quote.length
    const before = text.slice(Math.max(0, s - anchor.prefix.length), s)
    const after = text.slice(e, e + anchor.suffix.length)
    const score = sufLen(before, anchor.prefix) + preLen(after, anchor.suffix)
    if (score > bestScore) { bestScore = score; best = s }
  }
  return { start: best, end: best + anchor.quote.length }
}

/** Compute the plain-text offset of a DOM selection within `container`. */
export function selectionOffsets(
  container: HTMLElement,
  range: Range,
): { start: number; end: number } | null {
  if (!container.contains(range.commonAncestorContainer)) return null
  const pre = range.cloneRange()
  pre.selectNodeContents(container)
  pre.setEnd(range.startContainer, range.startOffset)
  const start = pre.toString().length
  return { start, end: start + range.toString().length }
}

function preLen(a: string, b: string): number {
  let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; return i
}
function sufLen(a: string, b: string): number {
  let i = 0; while (i < a.length && i < b.length && a[a.length-1-i] === b[b.length-1-i]) i++; return i
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd companion && bun run test src/anchor-dom.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add companion/src/anchor-dom.ts companion/src/anchor-dom.test.ts
git commit -m "feat: companion DOM anchoring helper"
```

---

## Task 12: Components — list, view, comment thread, action bar

Pure presentational components driven by props, so they test without a server.

**Files:**
- Create: `companion/src/components/ArtifactList.tsx`, `ActionBar.tsx`, `CommentThread.tsx`, `ArtifactView.tsx`
- Create: `companion/src/components/ActionBar.test.tsx`, `ArtifactView.test.tsx`

- [ ] **Step 1: Write failing tests `companion/src/components/ActionBar.test.tsx`**

```tsx
import { test, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { ActionBar } from "./ActionBar"

test("plan shows Approve + Request changes and fires callbacks", async () => {
  const onApprove = vi.fn(), onChanges = vi.fn(), onRefine = vi.fn()
  render(<ActionBar type="plan" onApprove={onApprove} onRequestChanges={onChanges} onRefine={onRefine} />)
  await userEvent.click(screen.getByRole("button", { name: /approve/i }))
  expect(onApprove).toHaveBeenCalled()
  await userEvent.click(screen.getByRole("button", { name: /request changes/i }))
  expect(onChanges).toHaveBeenCalled()
})

test("report shows only Request refinement", () => {
  render(<ActionBar type="report" onApprove={() => {}} onRequestChanges={() => {}} onRefine={() => {}} />)
  expect(screen.queryByRole("button", { name: /approve/i })).toBeNull()
  expect(screen.getByRole("button", { name: /request refinement/i })).toBeInTheDocument()
})
```

- [ ] **Step 2: Write failing test `companion/src/components/ArtifactView.test.tsx`**

```tsx
import { test, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { ArtifactView } from "./ArtifactView"

test("renders markdown content as HTML", () => {
  render(<ArtifactView content={"# Title\n\nbody text"} comments={[]} onAnchor={() => {}} />)
  expect(screen.getByRole("heading", { name: "Title" })).toBeInTheDocument()
  expect(screen.getByText("body text")).toBeInTheDocument()
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd companion && bun run test src/components`
Expected: FAIL — cannot find modules.

- [ ] **Step 4: Write `companion/src/components/ActionBar.tsx`**

```tsx
import React from "react"

export function ActionBar(props: {
  type: "plan" | "report"
  onApprove: () => void
  onRequestChanges: () => void
  onRefine: () => void
}) {
  if (props.type === "report") {
    return (
      <div className="action-bar">
        <button onClick={props.onRefine}>Request refinement</button>
      </div>
    )
  }
  return (
    <div className="action-bar">
      <button onClick={props.onApprove}>Approve</button>
      <button onClick={props.onRequestChanges}>Request changes</button>
    </div>
  )
}
```

- [ ] **Step 5: Write `companion/src/components/CommentThread.tsx`**

```tsx
import React, { useState } from "react"
import type { Comment } from "../api"

export function CommentThread(props: {
  comments: Comment[]
  onAdd: (body: string) => void
  title?: string
}) {
  const [draft, setDraft] = useState("")
  return (
    <div className="comment-thread">
      {props.title && <h4>{props.title}</h4>}
      {props.comments.map((c) => (
        <div key={c.id} className="comment">
          {c.anchor?.quote && <blockquote>{c.anchor.quote}</blockquote>}
          <p>{c.body}</p>
        </div>
      ))}
      <textarea value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add a comment" />
      <button
        onClick={() => { if (draft.trim()) { props.onAdd(draft.trim()); setDraft("") } }}
      >
        Comment
      </button>
    </div>
  )
}
```

- [ ] **Step 6: Write `companion/src/components/ArtifactView.tsx`**

```tsx
import React, { useRef } from "react"
import Markdown from "react-markdown"
import type { Anchor, Comment } from "../api"
import { anchorFromOffsets, selectionOffsets } from "../anchor-dom"

export function ArtifactView(props: {
  content: string
  comments: Comment[]
  onAnchor: (anchor: Anchor) => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  function onMouseUp() {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || !ref.current) return
    const offsets = selectionOffsets(ref.current, sel.getRangeAt(0))
    if (!offsets || offsets.end <= offsets.start) return
    const text = ref.current.textContent ?? ""
    props.onAnchor(anchorFromOffsets(text, offsets.start, offsets.end))
  }

  return (
    <div className="artifact-view" ref={ref} onMouseUp={onMouseUp}>
      <Markdown>{props.content}</Markdown>
    </div>
  )
}
```

- [ ] **Step 7: Write `companion/src/components/ArtifactList.tsx`**

```tsx
import React from "react"
import type { Artifact } from "../api"

export function ArtifactList(props: {
  artifacts: Artifact[]
  selectedId?: string
  onSelect: (id: string) => void
}) {
  return (
    <ul className="artifact-list">
      {props.artifacts.map((a) => (
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
  )
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd companion && bun run test src/components`
Expected: PASS (3 tests).

- [ ] **Step 9: Commit**

```bash
git add companion/src/components
git commit -m "feat: companion presentational components"
```

---

## Task 13: App shell — wire components, data, SSE, actions

**Files:**
- Create: `companion/src/App.tsx`, `companion/src/App.css`
- Create: `companion/src/App.test.tsx`

- [ ] **Step 1: Write failing test `companion/src/App.test.tsx`**

```tsx
import { test, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import * as api from "./api"
import { App } from "./App"

beforeEach(() => {
  vi.spyOn(api, "subscribeEvents").mockReturnValue(() => {})
  vi.spyOn(api, "listArtifacts").mockResolvedValue([
    { id: "id1", type: "plan", title: "P", status: "awaiting_review", currentRevision: 1, createdAt: 0, updatedAt: 0 },
  ])
  vi.spyOn(api, "getArtifact").mockResolvedValue({
    artifact: { id: "id1", type: "plan", title: "P", status: "awaiting_review", currentRevision: 1, createdAt: 0, updatedAt: 0 },
    content: "# Plan\n\nstep one", comments: [],
  })
})

test("loads list, selects first artifact, approves", async () => {
  const verdict = vi.spyOn(api, "postVerdict").mockResolvedValue()
  render(<App />)
  await waitFor(() => screen.getByText("P"))
  await userEvent.click(screen.getByText("P"))
  await waitFor(() => screen.getByRole("heading", { name: "Plan" }))
  await userEvent.click(screen.getByRole("button", { name: /approve/i }))
  expect(verdict).toHaveBeenCalledWith("id1", "approved")
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd companion && bun run test src/App.test.tsx`
Expected: FAIL — `App` not exported / no implementation.

- [ ] **Step 3: Write `companion/src/App.tsx`**

```tsx
import React, { useEffect, useState, useCallback } from "react"
import "./App.css"
import * as api from "./api"
import type { Anchor, Artifact, ArtifactDetail } from "./api"
import { ArtifactList } from "./components/ArtifactList"
import { ArtifactView } from "./components/ArtifactView"
import { CommentThread } from "./components/CommentThread"
import { ActionBar } from "./components/ActionBar"

export function App() {
  const [artifacts, setArtifacts] = useState<Artifact[]>([])
  const [selectedId, setSelectedId] = useState<string>()
  const [detail, setDetail] = useState<ArtifactDetail>()
  const [pendingAnchor, setPendingAnchor] = useState<Anchor>()

  const refreshList = useCallback(async () => setArtifacts(await api.listArtifacts()), [])
  const refreshDetail = useCallback(async (id: string) => setDetail(await api.getArtifact(id)), [])

  useEffect(() => { refreshList() }, [refreshList])

  useEffect(() => {
    return api.subscribeEvents((e) => {
      if (e.type === "ping") return
      refreshList()
      if (selectedId && e.id === selectedId) refreshDetail(selectedId)
    })
  }, [selectedId, refreshList, refreshDetail])

  useEffect(() => {
    if (!selectedId && artifacts.length) select(artifacts[0].id)
  }, [artifacts, selectedId])

  function select(id: string) {
    setSelectedId(id)
    setPendingAnchor(undefined)
    refreshDetail(id)
  }

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

  return (
    <div className="layout">
      <aside className="rail">
        <h2>Artifacts</h2>
        <ArtifactList artifacts={artifacts} selectedId={selectedId} onSelect={select} />
      </aside>
      <main className="main">
        {detail ? (
          <>
            <header className="main-header">
              <h1>{detail.artifact.title}</h1>
              <span className={`status status-${detail.artifact.status}`}>
                {detail.artifact.status.replace(/_/g, " ")}
              </span>
            </header>
            <ArtifactView
              content={detail.content}
              comments={detail.comments}
              onAnchor={setPendingAnchor}
            />
          </>
        ) : (
          <p className="empty">Select an artifact.</p>
        )}
      </main>
      <aside className="rail comments-rail">
        {detail && (
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
        )}
      </aside>
    </div>
  )
}
```

- [ ] **Step 4: Write `companion/src/App.css`**

```css
* { box-sizing: border-box; }
body { margin: 0; font-family: system-ui, sans-serif; color: #1c1c1e; }
.layout { display: grid; grid-template-columns: 260px 1fr 320px; height: 100vh; }
.rail { border-right: 1px solid #e4e4e7; padding: 12px; overflow-y: auto; }
.comments-rail { border-right: none; border-left: 1px solid #e4e4e7; display: flex; flex-direction: column; }
.main { padding: 24px; overflow-y: auto; }
.main-header { display: flex; align-items: center; justify-content: space-between; }
.artifact-list { list-style: none; margin: 0; padding: 0; }
.artifact-list li { padding: 8px; border-radius: 6px; cursor: pointer; display: flex; flex-direction: column; gap: 2px; }
.artifact-list li.selected { background: #eef2ff; }
.badge { font-size: 11px; text-transform: uppercase; }
.badge-plan { color: #4f46e5; }
.badge-report { color: #0891b2; }
.status { font-size: 12px; color: #71717a; }
.status-awaiting_review { color: #b45309; }
.status-approved { color: #15803d; }
.status-changes_requested { color: #b91c1c; }
.artifact-view ::selection { background: #fde68a; }
.comment { border: 1px solid #e4e4e7; border-radius: 6px; padding: 8px; margin-bottom: 8px; }
.comment blockquote { margin: 0 0 4px; padding-left: 8px; border-left: 3px solid #fde68a; color: #52525b; font-size: 13px; }
.comment-thread textarea { width: 100%; min-height: 60px; margin-top: 8px; }
.pending-anchor { background: #fffbeb; padding: 8px; border-radius: 6px; margin-bottom: 8px; font-size: 13px; }
.action-bar { margin-top: auto; display: flex; gap: 8px; padding-top: 12px; }
.action-bar button { flex: 1; padding: 8px; cursor: pointer; }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd companion && bun run test src/App.test.tsx`
Expected: PASS.

- [ ] **Step 6: Run the full companion suite + build**

Run: `cd companion && bun run test && bun run build`
Expected: all tests PASS; `companion/dist/` produced.

- [ ] **Step 7: Commit**

```bash
git add companion/src/App.tsx companion/src/App.css companion/src/App.test.tsx
git commit -m "feat: companion app shell"
```

---

## Task 14: End-to-end happy path (real server + store)

A backend integration test that exercises publish → comment → approve → tool resolves through the real server and store, mirroring the browser's HTTP calls.

**Files:**
- Create: `src/e2e.test.ts`

- [ ] **Step 1: Write the test `src/e2e.test.ts`**

```ts
import { test, expect, afterEach } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createStore } from "./store"
import { createBroadcaster } from "./events"
import { createServer } from "./server"
import { createPublishTool } from "./tools"

let stop: (() => void) | null = null
afterEach(() => { stop?.(); stop = null })

test("plan: publish blocks, browser comments + approves, tool resolves approved", async () => {
  const dir = mkdtempSync(join(tmpdir(), "e2e-"))
  const store = createStore({ root: dir, clock: () => 1, idgen: (() => { let n = 0; return () => `id${++n}` })() })
  const events = createBroadcaster()
  const srv = createServer({ store, events, port: 0, staticDir: null })
  stop = srv.stop
  const tool = createPublishTool({ store, events, url: srv.url, notify: () => {} })

  const exec = tool.execute(
    { type: "plan", title: "P", content: "# Plan\n\nstep one" },
    { sessionID: "s1" } as any,
  )

  // browser: wait for the artifact to exist, comment on it, then approve
  let id = ""
  for (let i = 0; i < 50 && !id; i++) {
    const list = await (await fetch(`${srv.url}/api/artifacts`)).json()
    if (list.length) id = list[0].id
    else await new Promise((r) => setTimeout(r, 5))
  }
  expect(id).toBe("id1")

  await fetch(`${srv.url}/api/artifacts/${id}/comments`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ revision: 1, kind: "general", body: "looks good" }),
  })
  await fetch(`${srv.url}/api/artifacts/${id}/verdict`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: "approved" }),
  })

  const result = JSON.parse(await exec)
  expect(result.status).toBe("approved")
  expect((await store.get(id))!.status).toBe("approved")
})
```

- [ ] **Step 2: Run the test**

Run: `bun test src/e2e.test.ts`
Expected: PASS.

- [ ] **Step 3: Run the entire backend suite**

Run: `bun test src`
Expected: all suites PASS.

- [ ] **Step 4: Commit**

```bash
git add src/e2e.test.ts
git commit -m "test: end-to-end plan review happy path"
```

---

## Task 15: Install docs + manual verification

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write `README.md`**

````markdown
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
````

- [ ] **Step 2: Manual smoke test (documented, run by a human)**

Run: `bun run build:companion && bun test && bun run typecheck`
Expected: companion builds, all tests pass, typecheck clean.

Then in a real opencode session configured with the plugin: ask for a plan, confirm the browser opens, comment + approve, and confirm the agent receives the verdict. Record the result.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: README and verification steps"
```

---

## Self-Review Notes (for the implementer)

- **SDK call shapes:** `client.tui.showToast`, `client.session.prompt`, and `client.tui.appendPrompt` argument shapes in Tasks 7–8 are written defensively with `as any` and `.catch`. Before finishing Task 8, open `node_modules/@opencode-ai/sdk` and correct the call sites to the installed version's actual signatures; keep the graceful fallbacks.
- **`tool()` execute invocation:** Task 7 tests call `tool.execute(...)` directly. Confirm `@opencode-ai/plugin`'s `tool()` returns an object whose `execute` is callable that way; if it nests differently, adapt the test harness (not the production logic).
- **Spec coverage:** plan blocking gate (Tasks 4,7,8,14); report non-blocking + refinement (Tasks 6,8); inline anchored + general comments (Tasks 3,11,12,13); revisions (Task 4); SSE live updates (Tasks 5,6,13); browser auto-open + toast + port fallback (Task 8 / server port 0); persistence layout (Task 4); error handling — dispose rejects pending, static fallback, headless degrade (Tasks 4,6,8). Diff-view between revisions remains a documented future item (out of scope).
````
