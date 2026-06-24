import { test, expect, beforeEach } from "bun:test"
import { mkdtempSync, existsSync } from "node:fs"
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

test("a draft plan has status 'draft'; re-publishing without draft submits it", async () => {
  const store = newStore()
  const { artifact } = await store.publish({ type: "plan", title: "P", content: "v1", draft: true })
  expect(artifact.status).toBe("draft")
  const { artifact: submitted } = await store.publish({
    type: "plan", title: "P", content: "v2", artifactId: artifact.id,
  })
  expect(submitted.status).toBe("awaiting_review")
})

test("refining/submitting a draft does NOT auto-resolve its comments", async () => {
  const store = newStore()
  const { artifact } = await store.publish({ type: "plan", title: "P", content: "v1", draft: true })
  await store.addComment(artifact.id, { revision: 1, kind: "general", body: "early feedback" })
  // submit the draft (re-publish without draft) → comment stays unresolved
  await store.publish({ type: "plan", title: "P", content: "v2", artifactId: artifact.id })
  const comments = await store.getComments(artifact.id)
  expect(comments).toHaveLength(1)
  expect(comments[0].resolved).toBe(false)
})

test("getActivePlan skips drafts and tracks the most-recently-updated non-draft plan", async () => {
  const store = newStore()
  const s = { sessionID: "s1" }
  const { artifact: road } = await store.publish({ type: "plan", title: "R", content: "r", isRoadmap: true, ...s })
  await store.resolveVerdict(road.id, { status: "approved" })
  // scratch two phase drafts — neither should become active
  const { artifact: p1 } = await store.publish({ type: "plan", title: "P1", content: "p1", parentId: road.id, draft: true, ...s })
  await store.publish({ type: "plan", title: "P2", content: "p2", parentId: road.id, draft: true, ...s })
  // roadmaps + drafts are excluded → no active (gate-governing) plan yet
  expect(store.getActivePlan("s1")).toBeUndefined()
  expect(store.getRoadmap("s1")!.id).toBe(road.id)
  // submit phase 1 → it becomes the active plan (most recently updated non-draft)
  await store.publish({ type: "plan", title: "P1", content: "p1b", artifactId: p1.id, ...s })
  expect(store.getActivePlan("s1")!.id).toBe(p1.id)
  // a progress update to the roadmap must NOT steal "active" from the phase
  await store.publish({ type: "plan", title: "R", content: "r2", artifactId: road.id, ...s })
  expect(store.getActivePlan("s1")!.id).toBe(p1.id)
})

test("re-publishing an approved plan stays approved (progress update); resubmit re-opens review", async () => {
  const store = newStore()
  const { artifact } = await store.publish({ type: "plan", title: "P", content: "v1" })
  await store.resolveVerdict(artifact.id, { status: "approved" })

  // progress update: stays approved, bumps the revision, no re-review
  const { artifact: prog } = await store.publish({ type: "plan", title: "P", content: "v2", artifactId: artifact.id })
  expect(prog.status).toBe("approved")
  expect(prog.currentRevision).toBe(2)

  // resubmit forces a fresh review
  const { artifact: re } = await store.publish({ type: "plan", title: "P", content: "v3", artifactId: artifact.id, resubmit: true })
  expect(re.status).toBe("awaiting_review")
})

test("a brand-new artifact's first publish leaves its (empty) comments untouched", async () => {
  const store = newStore()
  const { artifact } = await store.publish({ type: "plan", title: "P", content: "v1" })
  expect(await store.getComments(artifact.id)).toHaveLength(0)
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

test("setArchived on a roadmap cascades to its children; unarchive restores them", async () => {
  const store = newStore()
  const s = { sessionID: "s1" }
  const { artifact: road } = await store.publish({ type: "plan", title: "R", content: "r", isRoadmap: true, ...s })
  const { artifact: phase } = await store.publish({ type: "plan", title: "P1", content: "p", parentId: road.id, ...s })
  const { artifact: rep } = await store.publish({ type: "report", title: "Rep", content: "x", parentId: road.id, ...s })

  const affected = await store.setArchived(road.id, true)
  expect(affected.map((a) => a.id).sort()).toEqual([road.id, phase.id, rep.id].sort())
  expect((await store.get(road.id))!.archived).toBe(true)
  expect((await store.get(phase.id))!.archived).toBe(true)
  expect((await store.get(rep.id))!.archived).toBe(true)

  await store.setArchived(road.id, false)
  expect((await store.get(road.id))!.archived).toBe(false)
  expect((await store.get(phase.id))!.archived).toBe(false)
})

test("archived plans/roadmaps are excluded from getActivePlan/getRoadmap/getChildren", async () => {
  const store = newStore()
  const s = { sessionID: "s1" }
  const { artifact: road } = await store.publish({ type: "plan", title: "R", content: "r", isRoadmap: true, ...s })
  const { artifact: phase } = await store.publish({ type: "plan", title: "P1", content: "p", parentId: road.id, ...s })
  await store.resolveVerdict(phase.id, { status: "approved" })
  expect(store.getActivePlan("s1")!.id).toBe(phase.id)
  expect(store.getRoadmap("s1")!.id).toBe(road.id)
  expect(store.getChildren(road.id).map((c) => c.id)).toEqual([phase.id])

  await store.setArchived(road.id, true) // cascades to the phase
  expect(store.getActivePlan("s1")).toBeUndefined()
  expect(store.getRoadmap("s1")).toBeUndefined()
  expect(store.getChildren(road.id)).toHaveLength(0)
})

test("remove throws when the target is not archived", async () => {
  const store = newStore()
  const { artifact } = await store.publish({ type: "plan", title: "P", content: "x" })
  await expect(store.remove(artifact.id)).rejects.toThrow("not archived")
})

test("remove deletes the on-disk dir, cascades roadmap children + standalone same-session reports", async () => {
  const dir = mkdtempSync(join(tmpdir(), "artifacts-"))
  let now = 1000, n = 0
  const store = createStore({ root: dir, clock: () => now++, idgen: () => `id${++n}` })
  const s = { sessionID: "s1" }
  const { artifact: road } = await store.publish({ type: "plan", title: "R", content: "r", isRoadmap: true, ...s })
  const { artifact: phase } = await store.publish({ type: "plan", title: "P1", content: "p", parentId: road.id, ...s })
  const { artifact: phaseRep } = await store.publish({ type: "report", title: "PR", content: "x", parentId: road.id, ...s })
  const { artifact: looseRep } = await store.publish({ type: "report", title: "LR", content: "y", ...s })
  // a report in a different session must NOT be touched
  const { artifact: otherRep } = await store.publish({ type: "report", title: "OR", content: "z", sessionID: "s2" })

  await store.setArchived(road.id, true)
  const deleted = await store.remove(road.id)
  expect(deleted.sort()).toEqual([road.id, phase.id, phaseRep.id, looseRep.id].sort())

  for (const id of [road.id, phase.id, phaseRep.id, looseRep.id]) {
    expect(await store.get(id)).toBeUndefined()
    expect(existsSync(join(dir, id))).toBe(false)
  }
  expect(await store.get(otherRep.id)).toBeDefined()
})

test("remove rejects a pending verdict for a deleted artifact", async () => {
  const store = newStore()
  const { artifact } = await store.publish({ type: "plan", title: "P", content: "x" })
  await store.setArchived(artifact.id, true)
  // Capture the rejection reason; the catch handler is attached immediately so
  // the rejection is never unhandled.
  const reason = store.awaitVerdict(artifact.id).then(() => "resolved", (e) => e.message)
  await store.remove(artifact.id)
  expect(await reason).toBe("artifact deleted")
  expect(store.hasPending(artifact.id)).toBe(false)
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
