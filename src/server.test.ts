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

test("GET /api/events streams an initial ping then broadcast events", async () => {
  const { events, srv } = setup()
  const ctrl = new AbortController()
  const res = await fetch(`${srv.url}/api/events`, { signal: ctrl.signal })
  const reader = res.body!.getReader()
  const dec = new TextDecoder()

  const first = dec.decode((await reader.read()).value)
  expect(first).toContain('"type":"ping"')

  events.broadcast({ type: "artifact.published", id: "z" })
  const second = dec.decode((await reader.read()).value)
  expect(second).toContain('"artifact.published"')
  expect(second).toContain('"z"')

  ctrl.abort()
  await reader.cancel().catch(() => {})
})

test("POST comment to a traversal id (contains ..) or unknown artifact returns 404", async () => {
  const { srv } = setup()
  const trav = await fetch(`${srv.url}/api/artifacts/x..x/comments`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ revision: 1, kind: "general", body: "x" }),
  })
  expect(trav.status).toBe(404)
  const unknown = await fetch(`${srv.url}/api/artifacts/nope/comments`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ revision: 1, kind: "general", body: "x" }),
  })
  expect(unknown.status).toBe(404)
})

test("GET unknown revision returns 404, malformed verdict JSON returns 400", async () => {
  const { store, srv } = setup()
  const { artifact } = await store.publish({ type: "plan", title: "P", content: "x" })
  const r404 = await fetch(`${srv.url}/api/artifacts/${artifact.id}/revisions/99`)
  expect(r404.status).toBe(404)
  const r400 = await fetch(`${srv.url}/api/artifacts/${artifact.id}/verdict`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "not json",
  })
  expect(r400.status).toBe(400)
})
