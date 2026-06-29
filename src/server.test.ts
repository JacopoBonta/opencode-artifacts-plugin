import { test, expect, afterEach } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
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
  const srv = createServer({ store, events, port: 0, staticDir: null })
  stop = srv.stop
  return { store, events, srv }
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

test("PATCH a comment edits its body", async () => {
  const { store, srv } = setup()
  const { artifact } = await store.publish({ type: "plan", title: "P", content: "x" })
  const c = await store.addComment(artifact.id, { revision: 1, kind: "general", body: "old" })
  const res = await fetch(`${srv.url}/api/artifacts/${artifact.id}/comments/${c.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ body: "new" }),
  })
  expect(res.status).toBe(200)
  expect((await res.json()).body).toBe("new")
  expect((await store.getComments(artifact.id))[0].body).toBe("new")
})

test("DELETE removes a comment", async () => {
  const { store, srv } = setup()
  const { artifact } = await store.publish({ type: "plan", title: "P", content: "x" })
  const c = await store.addComment(artifact.id, { revision: 1, kind: "general", body: "drop" })
  const res = await fetch(`${srv.url}/api/artifacts/${artifact.id}/comments/${c.id}`, {
    method: "DELETE",
  })
  expect(res.status).toBe(200)
  expect(await store.getComments(artifact.id)).toHaveLength(0)
})

test("PATCH/DELETE a missing comment returns 404", async () => {
  const { store, srv } = setup()
  const { artifact } = await store.publish({ type: "plan", title: "P", content: "x" })
  const patch = await fetch(`${srv.url}/api/artifacts/${artifact.id}/comments/nope`, {
    method: "PATCH", headers: { "content-type": "application/json" },
    body: JSON.stringify({ body: "y" }),
  })
  expect(patch.status).toBe(404)
  const del = await fetch(`${srv.url}/api/artifacts/${artifact.id}/comments/nope`, { method: "DELETE" })
  expect(del.status).toBe(404)
})

test("editing a comment on an approved plan returns 409", async () => {
  const { store, srv } = setup()
  const { artifact } = await store.publish({ type: "plan", title: "P", content: "x" })
  const c = await store.addComment(artifact.id, { revision: 1, kind: "general", body: "note" })
  await store.resolveVerdict(artifact.id, { status: "approved", comments: [] })
  const res = await fetch(`${srv.url}/api/artifacts/${artifact.id}/comments/${c.id}`, {
    method: "PATCH", headers: { "content-type": "application/json" },
    body: JSON.stringify({ body: "y" }),
  })
  expect(res.status).toBe(409)
})

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

test("GET /api/events emits session.active on connect when getActiveSession is set", async () => {
  const dir = mkdtempSync(join(tmpdir(), "artifacts-"))
  const store = createStore({ root: dir, clock: () => 1, idgen: (() => { let n = 0; return () => `id${++n}` })() })
  const events = createBroadcaster()
  const srv = createServer({
    store, events, port: 0, staticDir: null,
    getActiveSession: () => "ses_live",
  })
  stop = srv.stop

  const ctrl = new AbortController()
  const res = await fetch(`${srv.url}/api/events`, { signal: ctrl.signal })
  const reader = res.body!.getReader()
  const dec = new TextDecoder()

  // The ping and the session.active frame may arrive in one or two chunks.
  let buf = dec.decode((await reader.read()).value)
  if (!buf.includes("session.active")) buf += dec.decode((await reader.read()).value)
  expect(buf).toContain('"type":"ping"')
  expect(buf).toContain('"type":"session.active"')
  expect(buf).toContain('"ses_live"')

  ctrl.abort()
  await reader.cancel().catch(() => {})
})

test("GET /api/events omits session.active on connect when no active session", async () => {
  const { srv } = setup()
  const ctrl = new AbortController()
  const res = await fetch(`${srv.url}/api/events`, { signal: ctrl.signal })
  const reader = res.body!.getReader()
  const dec = new TextDecoder()
  const first = dec.decode((await reader.read()).value)
  expect(first).toContain('"type":"ping"')
  expect(first).not.toContain("session.active")
  ctrl.abort()
  await reader.cancel().catch(() => {})
})

test("broadcasting session.active reaches an SSE subscriber", async () => {
  const { events, srv } = setup()
  const ctrl = new AbortController()
  const res = await fetch(`${srv.url}/api/events`, { signal: ctrl.signal })
  const reader = res.body!.getReader()
  const dec = new TextDecoder()
  dec.decode((await reader.read()).value) // ping

  events.broadcast({ type: "session.active", sessionID: "ses_next" })
  const frame = dec.decode((await reader.read()).value)
  expect(frame).toContain('"type":"session.active"')
  expect(frame).toContain('"ses_next"')

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

test("GET detail and revision routes also reject traversal ids", async () => {
  const { srv } = setup()
  expect((await fetch(`${srv.url}/api/artifacts/x..x`)).status).toBe(404)
  expect((await fetch(`${srv.url}/api/artifacts/x..x/revisions/1`)).status).toBe(404)
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

test("declining a plan resolves the verdict, records the reason, and interrupts the session", async () => {
  const dir = mkdtempSync(join(tmpdir(), "artifacts-"))
  const store = createStore({ root: dir, clock: () => 1, idgen: (() => { let n = 0; return () => `id${++n}` })() })
  const events = createBroadcaster()
  const interrupted: string[] = []
  const srv = createServer({
    store, events, port: 0, staticDir: null,
    interruptSession: (id) => interrupted.push(id),
  })
  stop = srv.stop

  const { artifact } = await store.publish({ type: "plan", title: "P", content: "x", sessionID: "ses_xyz" })
  const pending = store.awaitVerdict(artifact.id)
  const res = await fetch(`${srv.url}/api/artifacts/${artifact.id}/verdict`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: "declined", reason: "wrong direction" }),
  })
  expect(res.status).toBe(200)

  const verdict = await pending
  expect(verdict.status).toBe("declined")
  if (verdict.status === "declined") expect(verdict.reason).toBe("wrong direction")
  const a = (await store.get(artifact.id))!
  expect(a.status).toBe("declined")
  expect(a.declineReason).toBe("wrong direction")
  // The agent's parked turn is aborted via the artifact's session.
  expect(interrupted).toEqual(["ses_xyz"])
})

test("declining an approved plan returns 409 and does not interrupt", async () => {
  const dir = mkdtempSync(join(tmpdir(), "artifacts-"))
  const store = createStore({ root: dir, clock: () => 1, idgen: (() => { let n = 0; return () => `id${++n}` })() })
  const events = createBroadcaster()
  const interrupted: string[] = []
  const srv = createServer({
    store, events, port: 0, staticDir: null,
    interruptSession: (id) => interrupted.push(id),
  })
  stop = srv.stop

  const { artifact } = await store.publish({ type: "plan", title: "P", content: "x", sessionID: "ses_xyz" })
  await store.resolveVerdict(artifact.id, { status: "approved" })
  const res = await fetch(`${srv.url}/api/artifacts/${artifact.id}/verdict`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: "declined", reason: "too late" }),
  })
  expect(res.status).toBe(409)
  expect((await store.get(artifact.id))!.status).toBe("approved")
  expect(interrupted).toEqual([])
})

test("declining a draft plan returns 409 (must be submitted first)", async () => {
  const { store, srv } = setup()
  const { artifact } = await store.publish({ type: "plan", title: "P", content: "x", draft: true })
  const res = await fetch(`${srv.url}/api/artifacts/${artifact.id}/verdict`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: "declined" }),
  })
  expect(res.status).toBe(409)
})

// --- input validation (MEDIUM-1) ---

test("posting a comment with a malformed body returns 400", async () => {
  const { store, srv } = setup()
  const { artifact } = await store.publish({ type: "plan", title: "P", content: "x" })
  const bad = async (body: unknown) =>
    (await fetch(`${srv.url}/api/artifacts/${artifact.id}/comments`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    })).status
  expect(await bad({ revision: "1", kind: "general", body: "b" })).toBe(400) // revision not a number
  expect(await bad({ revision: 1, kind: "bogus", body: "b" })).toBe(400) // invalid kind
  expect(await bad({ revision: 1, kind: "general", body: "" })).toBe(400) // empty body
  expect(await bad({ revision: 1, kind: "anchor", body: "b" })).toBe(400) // anchor without an anchor
  // a malformed comment must not be stored
  expect(await store.getComments(artifact.id)).toHaveLength(0)
})

test("posting a verdict with an invalid status returns 400", async () => {
  const { store, srv } = setup()
  const { artifact } = await store.publish({ type: "plan", title: "P", content: "x" })
  const res = await fetch(`${srv.url}/api/artifacts/${artifact.id}/verdict`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: "yolo" }),
  })
  expect(res.status).toBe(400)
  expect((await store.get(artifact.id))!.status).toBe("awaiting_review")
})

test("archiving with a non-boolean returns 400", async () => {
  const { store, srv } = setup()
  const { artifact } = await store.publish({ type: "plan", title: "P", content: "x" })
  const res = await fetch(`${srv.url}/api/artifacts/${artifact.id}/archive`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ archived: "yes" }),
  })
  expect(res.status).toBe(400)
})

test("posting a verdict to an unknown (but safe) id returns 404, not a phantom success", async () => {
  const { srv } = setup()
  const res = await fetch(`${srv.url}/api/artifacts/does-not-exist/verdict`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: "approved" }),
  })
  expect(res.status).toBe(404)
})

// --- capability token auth (HIGH-1 / HIGH-2) ---

function authSetup(token: string) {
  const dir = mkdtempSync(join(tmpdir(), "artifacts-"))
  const store = createStore({ root: dir, clock: () => 1, idgen: (() => { let n = 0; return () => `id${++n}` })() })
  const events = createBroadcaster()
  const srv = createServer({ store, events, port: 0, staticDir: null, token })
  stop = srv.stop
  return { store, events, srv }
}

test("with a token configured, /api requests without it are rejected (401)", async () => {
  const { srv } = authSetup("secret")
  expect((await fetch(`${srv.url}/api/artifacts`)).status).toBe(401)
  expect((await fetch(`${srv.url}/api/artifacts`, { headers: { "x-artifacts-token": "wrong" } })).status).toBe(401)
})

test("with a token configured, the correct header is accepted (200)", async () => {
  const { store, srv } = authSetup("secret")
  await store.publish({ type: "plan", title: "P", content: "x" })
  const res = await fetch(`${srv.url}/api/artifacts`, { headers: { "x-artifacts-token": "secret" } })
  expect(res.status).toBe(200)
  expect(await res.json()).toHaveLength(1)
})

test("the SSE stream authenticates via the token query param", async () => {
  const { srv } = authSetup("secret")
  // wrong/missing token → 401
  expect((await fetch(`${srv.url}/api/events?token=nope`)).status).toBe(401)
  // correct token → an event-stream opens; abort right after connecting
  const ctrl = new AbortController()
  const ok = await fetch(`${srv.url}/api/events?token=secret`, { signal: ctrl.signal })
  expect(ok.status).toBe(200)
  expect(ok.headers.get("content-type")).toContain("text/event-stream")
  ctrl.abort()
})

test("a cross-origin state-changing request is rejected (403) even with the token", async () => {
  const { store, srv } = authSetup("secret")
  const { artifact } = await store.publish({ type: "plan", title: "P", content: "x" })
  const res = await fetch(`${srv.url}/api/artifacts/${artifact.id}/verdict`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-artifacts-token": "secret",
      origin: "http://evil.example",
    },
    body: JSON.stringify({ status: "approved" }),
  })
  expect(res.status).toBe(403)
})

// --- static serving + path containment (LOW-3) ---

test("static serving returns files under staticDir and falls back to index.html", async () => {
  const dir = mkdtempSync(join(tmpdir(), "static-"))
  writeFileSync(join(dir, "index.html"), "<!doctype html><title>app</title>")
  const store = createStore({ root: mkdtempSync(join(tmpdir(), "artifacts-")), clock: () => 1, idgen: () => "id" })
  const events = createBroadcaster()
  const srv = createServer({ store, events, port: 0, staticDir: dir })
  stop = srv.stop

  const root = await fetch(`${srv.url}/`)
  expect(root.status).toBe(200)
  expect(await root.text()).toContain("<title>app</title>")
  // an unknown non-API route falls back to the SPA index
  const spa = await fetch(`${srv.url}/artifacts/whatever`)
  expect(spa.status).toBe(200)
  expect(await spa.text()).toContain("<title>app</title>")
})
