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

test("editComment updates the body and persists", async () => {
  const store = newStore()
  const { artifact } = await store.publish({ type: "plan", title: "P", content: "x" })
  const c = await store.addComment(artifact.id, { revision: 1, kind: "general", body: "fix this" })
  const updated = await store.editComment(artifact.id, c.id, "fix this properly")
  expect(updated.body).toBe("fix this properly")
  const comments = await store.getComments(artifact.id)
  expect(comments).toHaveLength(1)
  expect(comments[0].body).toBe("fix this properly")
})

test("editComment on an unknown artifact or comment throws", async () => {
  const store = newStore()
  const { artifact } = await store.publish({ type: "plan", title: "P", content: "x" })
  await expect(store.editComment("nope", "id2", "y")).rejects.toThrow("unknown artifact")
  await expect(store.editComment(artifact.id, "nope", "y")).rejects.toThrow("unknown comment")
})

test("editComment on a resolved comment throws (already submitted)", async () => {
  const store = newStore()
  const { artifact } = await store.publish({ type: "plan", title: "P", content: "v1" })
  await store.addComment(artifact.id, { revision: 1, kind: "general", body: "note" })
  // A revision bump auto-resolves the comment.
  await store.publish({ type: "plan", title: "P", content: "v2", artifactId: artifact.id })
  const [resolved] = await store.getComments(artifact.id)
  await expect(store.editComment(artifact.id, resolved.id, "y")).rejects.toThrow("already submitted")
})

test("deleteComment removes the comment and persists", async () => {
  const store = newStore()
  const { artifact } = await store.publish({ type: "plan", title: "P", content: "x" })
  const c = await store.addComment(artifact.id, { revision: 1, kind: "general", body: "drop me" })
  await store.deleteComment(artifact.id, c.id)
  expect(await store.getComments(artifact.id)).toHaveLength(0)
})

test("deleteComment guards unknown and resolved comments", async () => {
  const store = newStore()
  const { artifact } = await store.publish({ type: "plan", title: "P", content: "v1" })
  await expect(store.deleteComment(artifact.id, "nope")).rejects.toThrow("unknown comment")
  await store.addComment(artifact.id, { revision: 1, kind: "general", body: "note" })
  await store.publish({ type: "plan", title: "P", content: "v2", artifactId: artifact.id })
  const [resolved] = await store.getComments(artifact.id)
  await expect(store.deleteComment(artifact.id, resolved.id)).rejects.toThrow("already submitted")
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
  // the roadmap is approved → frozen: re-publishing it is rejected, and the
  // active plan stays the phase
  await expect(
    store.publish({ type: "plan", title: "R", content: "r2", artifactId: road.id, ...s }),
  ).rejects.toThrow(/frozen/i)
  expect(store.getActivePlan("s1")!.id).toBe(p1.id)
})

test("a report completes the session's standalone active plan; the gate re-closes", async () => {
  const store = newStore()
  const s = { sessionID: "s1" }
  const { artifact: plan } = await store.publish({ type: "plan", title: "P", content: "v1", ...s })
  await store.resolveVerdict(plan.id, { status: "approved" })
  expect(store.getActivePlan("s1")!.id).toBe(plan.id)

  // Publishing a report in the same session nests it under the plan AND marks
  // the plan completed → no longer active.
  const { artifact: rep } = await store.publish({ type: "report", title: "R", content: "done", ...s })
  expect(rep.parentId).toBe(plan.id)
  expect(store.getActivePlan("s1")).toBeUndefined()
  expect((await store.get(plan.id))!.completed).toBe(true)
  expect(store.getLastCompletedPlan("s1")!.id).toBe(plan.id)
})

test("an approved+completed plan is frozen; resubmit re-opens it", async () => {
  const store = newStore()
  const s = { sessionID: "s1" }
  const { artifact: plan } = await store.publish({ type: "plan", title: "P", content: "v1", ...s })
  await store.resolveVerdict(plan.id, { status: "approved" })
  await store.publish({ type: "report", title: "R", content: "done", ...s })

  // The plan is approved (and completed) → frozen: re-publishing it is rejected,
  // the content is untouched, and the gate stays closed.
  await expect(
    store.publish({ type: "plan", title: "P", content: "v2", artifactId: plan.id, ...s }),
  ).rejects.toThrow(/frozen/i)
  expect((await store.get(plan.id))!.completed).toBe(true)
  expect((await store.get(plan.id))!.currentRevision).toBe(1)
  expect(store.getActivePlan("s1")).toBeUndefined()

  // resubmit clears completion and re-enters review → active again.
  const { artifact: re } = await store.publish({ type: "plan", title: "P", content: "v3", artifactId: plan.id, resubmit: true, ...s })
  expect(re.completed).toBe(false)
  expect(re.status).toBe("awaiting_review")
  expect(store.getActivePlan("s1")!.id).toBe(plan.id)
})

test("a phase report (parentId) does NOT complete its phase plan", async () => {
  const store = newStore()
  const s = { sessionID: "s1" }
  const { artifact: road } = await store.publish({ type: "plan", title: "R", content: "r", isRoadmap: true, ...s })
  await store.resolveVerdict(road.id, { status: "approved" })
  const { artifact: phase } = await store.publish({ type: "plan", title: "P1", content: "p", parentId: road.id, ...s })
  await store.resolveVerdict(phase.id, { status: "approved" })
  expect(store.getActivePlan("s1")!.id).toBe(phase.id)

  // A report auto-nests under the active PHASE plan and is a milestone, not a
  // completion: the phase plan keeps governing the gate.
  const { artifact: rep } = await store.publish({ type: "report", title: "PR", content: "x", ...s })
  expect(rep.parentId).toBe(phase.id)
  expect((await store.get(phase.id))!.completed).toBeFalsy()
  expect(store.getActivePlan("s1")!.id).toBe(phase.id)
})

test("a report with no active plan is a no-op; multiple reports are idempotent", async () => {
  const store = newStore()
  const s = { sessionID: "s1" }
  // No plan in the session → nothing to complete.
  await store.publish({ type: "report", title: "R1", content: "a", ...s })
  expect(store.getLastCompletedPlan("s1")).toBeUndefined()

  const { artifact: plan } = await store.publish({ type: "plan", title: "P", content: "v1", ...s })
  await store.resolveVerdict(plan.id, { status: "approved" })
  await store.publish({ type: "report", title: "R2", content: "b", ...s })
  // Second report finds no active plan → still just the one completed plan.
  await store.publish({ type: "report", title: "R3", content: "c", ...s })
  expect((await store.get(plan.id))!.completed).toBe(true)
  expect(store.getActivePlan("s1")).toBeUndefined()
})

test("an approved plan is frozen: re-publish without resubmit is rejected; resubmit re-opens review", async () => {
  const store = newStore()
  const { artifact } = await store.publish({ type: "plan", title: "P", content: "v1" })
  await store.resolveVerdict(artifact.id, { status: "approved" })

  // frozen: re-publishing without resubmit is rejected and leaves content untouched
  await expect(
    store.publish({ type: "plan", title: "P", content: "v2", artifactId: artifact.id }),
  ).rejects.toThrow(/frozen/i)
  const a = (await store.get(artifact.id))!
  expect(a.status).toBe("approved")
  expect(a.currentRevision).toBe(1)
  expect(await store.readRevision(artifact.id, 1)).toBe("v1")

  // resubmit forces a fresh review and adds a revision
  const { artifact: re } = await store.publish({ type: "plan", title: "P", content: "v3", artifactId: artifact.id, resubmit: true })
  expect(re.status).toBe("awaiting_review")
  expect(re.currentRevision).toBe(2)
})

test("an approved roadmap is frozen too: re-publish without resubmit is rejected", async () => {
  const store = newStore()
  const { artifact: road } = await store.publish({ type: "plan", title: "R", content: "r1", isRoadmap: true })
  await store.resolveVerdict(road.id, { status: "approved" })
  await expect(
    store.publish({ type: "plan", title: "R", content: "r2", artifactId: road.id, isRoadmap: true }),
  ).rejects.toThrow(/frozen/i)
  expect((await store.get(road.id))!.currentRevision).toBe(1)
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

test("resolveVerdict declined sets status + reason and resolves the pending promise", async () => {
  const store = newStore()
  const { artifact } = await store.publish({ type: "plan", title: "P", content: "x" })
  const pending = store.awaitVerdict(artifact.id)
  await store.resolveVerdict(artifact.id, { status: "declined", reason: "out of scope" })
  expect(await pending).toEqual({ status: "declined", reason: "out of scope" })
  const a = (await store.get(artifact.id))!
  expect(a.status).toBe("declined")
  expect(a.declineReason).toBe("out of scope")
})

test("resolveVerdict declined without a reason leaves declineReason undefined", async () => {
  const store = newStore()
  const { artifact } = await store.publish({ type: "plan", title: "P", content: "x" })
  await store.resolveVerdict(artifact.id, { status: "declined" })
  const a = (await store.get(artifact.id))!
  expect(a.status).toBe("declined")
  expect(a.declineReason).toBeUndefined()
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

test("getDescendants returns the full subtree (roadmap -> phase plan -> report)", async () => {
  const store = newStore()
  const s = { sessionID: "s1" }
  const { artifact: road } = await store.publish({ type: "plan", title: "R", content: "r", isRoadmap: true, ...s })
  await store.resolveVerdict(road.id, { status: "approved" })
  const { artifact: phase } = await store.publish({ type: "plan", title: "P1", content: "p", parentId: road.id, ...s })
  await store.resolveVerdict(phase.id, { status: "approved" })
  // Auto-nests under the active phase plan.
  const { artifact: rep } = await store.publish({ type: "report", title: "PR", content: "x", ...s })
  expect(rep.parentId).toBe(phase.id)

  // Direct children stop at the phase plan; descendants walk through to the report.
  expect(store.getChildren(road.id).map((c) => c.id)).toEqual([phase.id])
  expect(store.getDescendants(road.id).map((c) => c.id)).toEqual([phase.id, rep.id])
  expect(store.getDescendants(phase.id).map((c) => c.id)).toEqual([rep.id])
})

test("remove throws when the target is not archived", async () => {
  const store = newStore()
  const { artifact } = await store.publish({ type: "plan", title: "P", content: "x" })
  await expect(store.remove(artifact.id)).rejects.toThrow("not archived")
})

test("remove cascades a roadmap's archived subtree but PRESERVES un-archived loose reports", async () => {
  const dir = mkdtempSync(join(tmpdir(), "artifacts-"))
  let now = 1000, n = 0
  const store = createStore({ root: dir, clock: () => now++, idgen: () => `id${++n}` })
  const s = { sessionID: "s1" }
  const { artifact: road } = await store.publish({ type: "plan", title: "R", content: "r", isRoadmap: true, ...s })
  // No active plan yet (the roadmap is not gate-governing), so this report stays
  // loose — it is NOT part of the roadmap subtree and must survive the cascade.
  const { artifact: looseRep } = await store.publish({ type: "report", title: "LR", content: "y", ...s })
  const { artifact: phase } = await store.publish({ type: "plan", title: "P1", content: "p", parentId: road.id, ...s })
  // With the phase plan active, this report auto-nests under the PHASE PLAN.
  const { artifact: phaseRep } = await store.publish({ type: "report", title: "PR", content: "x", ...s })
  expect(phaseRep.parentId).toBe(phase.id)
  // a report in a different session must NOT be touched
  const { artifact: otherRep } = await store.publish({ type: "report", title: "OR", content: "z", sessionID: "s2" })

  // Archiving the roadmap cascades to its whole subtree (phase + phaseRep), but
  // not the loose report (no parent) nor the other-session report.
  await store.setArchived(road.id, true)
  expect((await store.get(phaseRep.id))!.archived).toBe(true)
  expect((await store.get(looseRep.id))!.archived).toBeFalsy()
  const deleted = await store.remove(road.id)
  expect(deleted.sort()).toEqual([road.id, phase.id, phaseRep.id].sort())

  for (const id of [road.id, phase.id, phaseRep.id]) {
    expect(await store.get(id)).toBeUndefined()
    expect(existsSync(join(dir, id))).toBe(false)
  }
  // The un-archived loose report and the other-session report both survive.
  expect(await store.get(looseRep.id)).toBeDefined()
  expect(await store.get(otherRep.id)).toBeDefined()
})

test("remove cascades an ARCHIVED standalone same-session report", async () => {
  const dir = mkdtempSync(join(tmpdir(), "artifacts-"))
  let now = 1000, n = 0
  const store = createStore({ root: dir, clock: () => now++, idgen: () => `id${++n}` })
  const s = { sessionID: "s1" }
  const { artifact: road } = await store.publish({ type: "plan", title: "R", content: "r", isRoadmap: true, ...s })
  const { artifact: looseRep } = await store.publish({ type: "report", title: "LR", content: "y", ...s })

  // Archive BOTH (the loose report individually, since the roadmap cascade skips it).
  await store.setArchived(road.id, true)
  await store.setArchived(looseRep.id, true)
  const deleted = await store.remove(road.id)
  expect(deleted.sort()).toEqual([road.id, looseRep.id].sort())
  expect(await store.get(looseRep.id)).toBeUndefined()
})

test("archiving a standalone plan cascades to its report, but a later loose report survives", async () => {
  const dir = mkdtempSync(join(tmpdir(), "artifacts-"))
  let now = 1000, n = 0
  const store = createStore({ root: dir, clock: () => now++, idgen: () => `id${++n}` })
  const s = { sessionID: "s1" }
  const { artifact: plan } = await store.publish({ type: "plan", title: "P", content: "p", ...s })
  // Reports on the active standalone plan: nests under it AND completes it.
  const { artifact: rep } = await store.publish({ type: "report", title: "R", content: "y", ...s })
  expect(rep.parentId).toBe(plan.id)
  expect((await store.get(plan.id))!.completed).toBe(true)
  // The plan is now completed → no active plan → this report stays loose.
  const { artifact: looseRep } = await store.publish({ type: "report", title: "LR", content: "z", ...s })
  expect(looseRep.parentId).toBeUndefined()

  // Archiving the plan archives its report too (as a unit); the loose one is left.
  await store.setArchived(plan.id, true)
  expect((await store.get(rep.id))!.archived).toBe(true)
  const deleted = await store.remove(plan.id)
  expect(deleted.sort()).toEqual([plan.id, rep.id].sort())
  expect(await store.get(looseRep.id)).toBeDefined()
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
