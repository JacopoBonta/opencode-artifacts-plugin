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

test("publish with an unknown artifactId throws (no silent reset)", async () => {
  const store = newStore()
  await expect(
    store.publish({ type: "plan", title: "P", content: "x", artifactId: "does-not-exist" }),
  ).rejects.toThrow("unknown artifactId")
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

test("addComment to an unknown artifact throws", async () => {
  const store = newStore()
  await expect(
    store.addComment("nope", { revision: 1, kind: "general", body: "x" }),
  ).rejects.toThrow("unknown artifact")
})

test("re-publish derives status from the existing artifact type, not the passed type", async () => {
  const store = newStore()
  const { artifact } = await store.publish({ type: "report", title: "R", content: "v1" })
  expect(artifact.status).toBe("published")
  // Re-publish passing a mismatched type="plan" must NOT flip status to awaiting_review.
  const { artifact: a2 } = await store.publish({
    type: "plan", title: "R", content: "v2", artifactId: artifact.id,
  })
  expect(a2.type).toBe("report")
  expect(a2.status).toBe("published")
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
