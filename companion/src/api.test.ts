import { test, expect, vi, afterEach } from "vitest"
import { listArtifacts, getArtifact, postComment, postVerdict, getRevision } from "./api"

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

test("getRevision GETs the revision endpoint", async () => {
  const fetchMock = vi.fn().mockResolvedValue({ json: async () => ({ content: "# rev 2" }) })
  vi.stubGlobal("fetch", fetchMock)
  const out = await getRevision("id1", 2)
  expect(fetchMock).toHaveBeenCalledWith("/api/artifacts/id1/revisions/2")
  expect(out).toEqual({ content: "# rev 2" })
})
