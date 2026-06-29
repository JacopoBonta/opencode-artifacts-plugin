import { test, expect } from "vitest"
import {
  buildTree, phaseProgress, isOpen, visibleArtifactIds, sessionLabel,
} from "./ArtifactTree"
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
  expect(road.children.map((c) => c.artifact.id)).toEqual(["phase1", "rep1"])
  const solo = tree.find((n) => n.artifact.id === "solo")!
  expect(solo.children).toHaveLength(0)
})

test("buildTree nests a report under its plan to any depth (roadmap -> phase -> report)", () => {
  const items = [
    art({ id: "road", isRoadmap: true, createdAt: 1 }),
    art({ id: "phase1", parentId: "road", createdAt: 2 }),
    art({ id: "rep1", type: "report", parentId: "phase1", createdAt: 3 }),
    art({ id: "solo", createdAt: 4 }),
    art({ id: "soloRep", type: "report", parentId: "solo", createdAt: 5 }),
  ]
  const tree = buildTree(items)
  const road = tree.find((n) => n.artifact.id === "road")!
  const phase1 = road.children.find((c) => c.artifact.id === "phase1")!
  // The report hangs off the phase plan, not the roadmap (3 levels deep).
  expect(road.children.map((c) => c.artifact.id)).toEqual(["phase1"])
  expect(phase1.children.map((c) => c.artifact.id)).toEqual(["rep1"])
  // A standalone plan likewise owns its report (2 levels).
  const solo = tree.find((n) => n.artifact.id === "solo")!
  expect(solo.children.map((c) => c.artifact.id)).toEqual(["soloRep"])
})

test("buildTree treats a child with a missing parent as top-level (orphan)", () => {
  const tree = buildTree([art({ id: "orphan", parentId: "gone" })])
  expect(tree.map((n) => n.artifact.id)).toEqual(["orphan"])
})

test("phaseProgress counts approved phase plans, ignoring reports", () => {
  const leaf = (p: Partial<Artifact> & { id: string }) => ({ artifact: art(p), children: [] })
  const node = {
    artifact: art({ id: "road", isRoadmap: true }),
    children: [
      leaf({ id: "p1", status: "approved" }),
      leaf({ id: "p2", status: "awaiting_review" }),
      leaf({ id: "r1", type: "report", status: "published" }),
    ],
  }
  expect(phaseProgress(node)).toEqual({ done: 1, total: 2 })
  // non-roadmap nodes have no progress
  expect(phaseProgress({ artifact: art({ id: "x" }), children: [] })).toBeNull()
})

test("sessionLabel prefers a session title, falls back to a short id, names the ungrouped bucket", () => {
  expect(sessionLabel([art({ id: "a1", sessionID: "ses_abcdef", sessionTitle: "Build login" })], "ses_abcdef")).toBe("Build login")
  expect(sessionLabel([art({ id: "a1", sessionID: "ses_abcdef" })], "ses_abcdef")).toBe("Session abcdef")
  expect(sessionLabel([], "__ungrouped__")).toBe("Ungrouped")
})

test("isOpen defaults roadmaps to open and the archived bucket to closed", () => {
  expect(isOpen({}, "rm:road")).toBe(true)
  expect(isOpen({ "rm:road": true }, "rm:road")).toBe(false) // stored pre-toggle value
  expect(isOpen({}, "__archived__")).toBe(false)
  expect(isOpen({ __archived__: false }, "__archived__")).toBe(true)
})

test("visibleArtifactIds lists only the focused session's artifacts in tree order", () => {
  const arts = [
    art({ id: "road", sessionID: "ses_a", isRoadmap: true, createdAt: 1 }),
    art({ id: "phase1", sessionID: "ses_a", parentId: "road", createdAt: 2 }),
    art({ id: "old", sessionID: "ses_a", archived: true }),
    art({ id: "b1", sessionID: "ses_b", createdAt: 3 }),
  ]
  // Focused on ses_a: its roadmap + phase, archived excluded; ses_b not present.
  expect(visibleArtifactIds(arts, {}, "ses_a")).toEqual(["road", "phase1"])
  // Collapse the roadmap: its phase disappears from the selectable list.
  expect(visibleArtifactIds(arts, { "rm:road": true }, "ses_a")).toEqual(["road"])
  // A different session shows only its own artifact.
  expect(visibleArtifactIds(arts, {}, "ses_b")).toEqual(["b1"])
  // No focused session → nothing selectable.
  expect(visibleArtifactIds(arts, {}, undefined)).toEqual([])
})

test("visibleArtifactIds recurses 3 levels and honors collapse at each level", () => {
  const arts = [
    art({ id: "road", sessionID: "ses_a", isRoadmap: true, createdAt: 1 }),
    art({ id: "phase1", sessionID: "ses_a", parentId: "road", createdAt: 2 }),
    art({ id: "rep1", sessionID: "ses_a", type: "report", parentId: "phase1", createdAt: 3 }),
  ]
  // Fully expanded: roadmap → phase → its report.
  expect(visibleArtifactIds(arts, {}, "ses_a")).toEqual(["road", "phase1", "rep1"])
  // Collapsing the phase plan hides its nested report but keeps the phase.
  expect(visibleArtifactIds(arts, { "rm:phase1": true }, "ses_a")).toEqual(["road", "phase1"])
  // Collapsing the roadmap hides the whole subtree.
  expect(visibleArtifactIds(arts, { "rm:road": true }, "ses_a")).toEqual(["road"])
})
