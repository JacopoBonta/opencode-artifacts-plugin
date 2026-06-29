import { test, expect, vi, afterEach, beforeEach } from "vitest"
import { listArtifacts, getArtifact, postComment, patchComment, deleteComment, postVerdict, getRevision, subscribeEvents } from "./api"

// All API calls carry the capability token; seed one for the default cases.
beforeEach(() => sessionStorage.setItem("oc-artifacts-token", "tok"))
afterEach(() => {
  vi.restoreAllMocks()
  sessionStorage.clear()
})

const hasToken = expect.objectContaining({
  headers: expect.objectContaining({ "x-artifacts-token": "tok" }),
})

test("listArtifacts GETs /api/artifacts with the token header", async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [{ id: "a" }] })
  vi.stubGlobal("fetch", fetchMock)
  const out = await listArtifacts()
  expect(fetchMock).toHaveBeenCalledWith("/api/artifacts", hasToken)
  expect(out).toEqual([{ id: "a" }])
})

test("postVerdict POSTs status to verdict endpoint", async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
  vi.stubGlobal("fetch", fetchMock)
  await postVerdict("id1", "approved")
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/artifacts/id1/verdict",
    expect.objectContaining({ method: "POST" }),
  )
  const body = JSON.parse(fetchMock.mock.calls[0][1].body)
  expect(body.status).toBe("approved")
})

test("postVerdict includes the reason when declining", async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
  vi.stubGlobal("fetch", fetchMock)
  await postVerdict("id1", "declined", "out of scope")
  const body = JSON.parse(fetchMock.mock.calls[0][1].body)
  expect(body.status).toBe("declined")
  expect(body.reason).toBe("out of scope")
})

test("postVerdict omits the reason key when none is given", async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
  vi.stubGlobal("fetch", fetchMock)
  await postVerdict("id1", "declined")
  const body = JSON.parse(fetchMock.mock.calls[0][1].body)
  expect(body.status).toBe("declined")
  expect("reason" in body).toBe(false)
})

test("patchComment PATCHes the comment endpoint with the new body", async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "c1", body: "new" }) })
  vi.stubGlobal("fetch", fetchMock)
  await patchComment("id1", "c1", "new")
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/artifacts/id1/comments/c1",
    expect.objectContaining({ method: "PATCH" }),
  )
  expect(JSON.parse(fetchMock.mock.calls[0][1].body).body).toBe("new")
})

test("deleteComment DELETEs the comment endpoint", async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
  vi.stubGlobal("fetch", fetchMock)
  await deleteComment("id1", "c1")
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/artifacts/id1/comments/c1",
    expect.objectContaining({ method: "DELETE" }),
  )
})

test("getRevision GETs the revision endpoint with the token header", async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ content: "# rev 2" }) })
  vi.stubGlobal("fetch", fetchMock)
  const out = await getRevision("id1", 2)
  expect(fetchMock).toHaveBeenCalledWith("/api/artifacts/id1/revisions/2", hasToken)
  expect(out).toEqual({ content: "# rev 2" })
})

test("requests attach the x-artifacts-token header when a token is present", async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
  vi.stubGlobal("fetch", fetchMock)
  await postComment("id1", { revision: 1, kind: "general", body: "x" })
  const init = fetchMock.mock.calls[0][1]
  expect(init.headers["x-artifacts-token"]).toBe("tok")
})

test("no token header is sent when none is stored", async () => {
  sessionStorage.clear()
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [] })
  vi.stubGlobal("fetch", fetchMock)
  await listArtifacts()
  // No token → req() passes through the original init (undefined for a GET).
  expect(fetchMock).toHaveBeenCalledWith("/api/artifacts", undefined)
})

test("subscribeEvents opens the SSE stream with the token query param", async () => {
  const instances: { url: string; close: () => void }[] = []
  class FakeES {
    onmessage: ((m: { data: string }) => void) | null = null
    onerror: ((e: unknown) => void) | null = null
    close = vi.fn()
    constructor(public url: string) { instances.push(this) }
  }
  vi.stubGlobal("EventSource", FakeES as unknown as typeof EventSource)
  const stop = subscribeEvents(() => {})
  expect(instances[0].url).toBe("/api/events?token=tok")
  stop()
})

test("a non-2xx response rejects instead of returning a bad body", async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })
  vi.stubGlobal("fetch", fetchMock)
  await expect(getArtifact("id1")).rejects.toThrow(/500/)
  await expect(postComment("id1", { revision: 1, kind: "general", body: "x" })).rejects.toThrow(/500/)
})
