import { test, expect, vi, afterEach } from "vitest"
import { listArtifacts, getArtifact, postComment, postVerdict, getRevision } from "./api"

afterEach(() => vi.restoreAllMocks())

test("listArtifacts GETs /api/artifacts", async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [{ id: "a" }] })
  vi.stubGlobal("fetch", fetchMock)
  const out = await listArtifacts()
  expect(fetchMock).toHaveBeenCalledWith("/api/artifacts")
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

test("getRevision GETs the revision endpoint", async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ content: "# rev 2" }) })
  vi.stubGlobal("fetch", fetchMock)
  const out = await getRevision("id1", 2)
  expect(fetchMock).toHaveBeenCalledWith("/api/artifacts/id1/revisions/2")
  expect(out).toEqual({ content: "# rev 2" })
})

test("a non-2xx response rejects instead of returning a bad body", async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })
  vi.stubGlobal("fetch", fetchMock)
  await expect(getArtifact("id1")).rejects.toThrow(/500/)
  await expect(postComment("id1", { revision: 1, kind: "general", body: "x" })).rejects.toThrow(/500/)
})
