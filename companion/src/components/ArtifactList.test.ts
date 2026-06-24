import { test, expect } from "vitest"
import { buildTree, phaseProgress } from "./ArtifactList"
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
