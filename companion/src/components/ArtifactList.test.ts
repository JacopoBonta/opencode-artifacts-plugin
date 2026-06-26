import { test, expect } from "vitest"
import { buildTree, phaseProgress, recentSessions } from "./ArtifactList"
import type { Artifact } from "../api"

function art(p: Partial<Artifact> & { id: string }): Artifact {
  return {
    type: "plan", title: p.id, status: "approved",
    currentRevision: 1, createdAt: 0, updatedAt: 0,
    ...p,
  } as Artifact
}

test("buildTree nests children under their roadmap and keeps standalone items top-level", () => {
  const items = [
    art({ id: "road", isRoadmap: true, createdAt: 1 }),
    art({ id: "phase1", parentId: "road", createdAt: 2 }),
    art({ id: "rep1", type: "report", parentId: "road", createdAt: 3 }),
    art({ id: "solo", createdAt: 4 }),
  ]
  const tree = buildTree(items)
  // Top-level is newest-first: solo (createdAt 4) before road (createdAt 1).
  expect(tree.map((n) => n.artifact.id)).toEqual(["solo", "road"])
  const road = tree.find((n) => n.artifact.id === "road")!
  expect(road.children.map((c) => c.id)).toEqual(["phase1", "rep1"])
  const solo = tree.find((n) => n.artifact.id === "solo")!
  expect(solo.children).toHaveLength(0)
})

test("buildTree treats a child with a missing parent as top-level (orphan)", () => {
  const tree = buildTree([art({ id: "orphan", parentId: "gone" })])
  expect(tree.map((n) => n.artifact.id)).toEqual(["orphan"])
})

test("recentSessions groups by session, newest first, excluding archived", () => {
  const sessions = recentSessions([
    art({ id: "a1", sessionID: "ses_a", sessionTitle: "Alpha", updatedAt: 10 }),
    art({ id: "a2", sessionID: "ses_a", sessionTitle: "Alpha", updatedAt: 30 }),
    art({ id: "b1", sessionID: "ses_b", sessionTitle: "Beta", updatedAt: 20 }),
    art({ id: "old", sessionID: "ses_a", sessionTitle: "Alpha", updatedAt: 99, archived: true }),
    art({ id: "u1", updatedAt: 5 }),
  ])
  // Ordered by latest activity desc: ses_a (30) > ses_b (20) > ungrouped (5).
  expect(sessions.map((s) => s.key)).toEqual(["ses_a", "ses_b", "__ungrouped__"])
  const alpha = sessions[0]
  expect(alpha.label).toBe("Alpha")
  // The archived artifact is excluded from the count and the latest timestamp.
  expect(alpha.count).toBe(2)
  expect(alpha.latest).toBe(30)
  expect(sessions[2].label).toBe("Ungrouped")
})

test("recentSessions flags sessions that contain an unseen artifact", () => {
  const sessions = recentSessions(
    [
      art({ id: "a1", sessionID: "ses_a", updatedAt: 10 }),
      art({ id: "b1", sessionID: "ses_b", updatedAt: 20 }),
    ],
    new Set(["a1"]),
  )
  expect(sessions.find((s) => s.key === "ses_a")!.hasUnseen).toBe(true)
  expect(sessions.find((s) => s.key === "ses_b")!.hasUnseen).toBe(false)
})

test("phaseProgress counts approved phase plans, ignoring reports", () => {
  const node = {
    artifact: art({ id: "road", isRoadmap: true }),
    children: [
      art({ id: "p1", status: "approved" }),
      art({ id: "p2", status: "awaiting_review" }),
      art({ id: "r1", type: "report", status: "published" }),
    ],
  }
  expect(phaseProgress(node)).toEqual({ done: 1, total: 2 })
  // non-roadmap nodes have no progress
  expect(phaseProgress({ artifact: art({ id: "x" }), children: [] })).toBeNull()
})
