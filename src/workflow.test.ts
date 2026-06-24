import { test, expect } from "bun:test"
import {
  validatePlanStructure,
  isMutatingCall,
  gateState,
  buildSessionContext,
  buildRoadmapContext,
} from "./workflow"
import type { Artifact } from "./types"

const VALID_PLAN = `# Add feature X

## Context
We need X because Y.

## Goals
- Ship X

## Approach
Do it cleanly.

## Tasks
- [ ] Do the thing

## Verification
Run the tests.

## Status
Not started.`

test("validatePlanStructure accepts a complete plan", () => {
  expect(validatePlanStructure(VALID_PLAN)).toEqual({ ok: true })
})

test("validatePlanStructure accepts heading synonyms", () => {
  const plan = `# T
## Background
why
## Objectives
g
## Design
d
## Steps
- s
## Testing
t
## Progress
p`
  expect(validatePlanStructure(plan)).toEqual({ ok: true })
})

test("validatePlanStructure reports missing sections", () => {
  const res = validatePlanStructure("# T\n## Context\nonly context")
  expect(res.ok).toBe(false)
  if (!res.ok) expect(res.missing).toEqual(["Goals", "Approach", "Tasks", "Verification", "Status"])
})

test("validatePlanStructure roadmap profile requires Phases", () => {
  const roadmap = `# R
## Context
c
## Goals
g
## Phases
1. one
## Status
s`
  expect(validatePlanStructure(roadmap, { roadmap: true })).toEqual({ ok: true })
  // The same roadmap fails the standard profile (no Approach/Tasks/Verification).
  expect(validatePlanStructure(roadmap).ok).toBe(false)
  // A standard plan lacking Phases fails the roadmap profile.
  const res = validatePlanStructure("# R\n## Context\nc\n## Goals\ng\n## Status\ns", { roadmap: true })
  expect(res.ok).toBe(false)
  if (!res.ok) expect(res.missing).toEqual(["Phases"])
})

test("isMutatingCall gates write/edit/patch", () => {
  expect(isMutatingCall("write", {})).toBe(true)
  expect(isMutatingCall("edit", {})).toBe(true)
  expect(isMutatingCall("patch", {})).toBe(true)
})

test("isMutatingCall ignores read-only tools", () => {
  for (const t of ["read", "grep", "glob", "list", "webfetch"]) {
    expect(isMutatingCall(t, {})).toBe(false)
  }
})

test("isMutatingCall classifies bash by command content", () => {
  expect(isMutatingCall("bash", { command: "rm -rf build" })).toBe(true)
  expect(isMutatingCall("bash", { command: "echo hi > file.txt" })).toBe(true)
  expect(isMutatingCall("bash", { command: "sed -i 's/a/b/' f" })).toBe(true)
  expect(isMutatingCall("bash", { command: "git commit -m x" })).toBe(true)
  expect(isMutatingCall("bash", { command: "npm install lodash" })).toBe(true)

  expect(isMutatingCall("bash", { command: "ls -la" })).toBe(false)
  expect(isMutatingCall("bash", { command: "grep -r foo src" })).toBe(false)
  expect(isMutatingCall("bash", { command: "git status" })).toBe(false)
  expect(isMutatingCall("bash", {})).toBe(false)
})

function plan(status: Artifact["status"], extra: Partial<Artifact> = {}): Artifact {
  return {
    id: "p1", type: "plan", title: "P", status,
    currentRevision: 1, createdAt: 1, updatedAt: 1, sessionID: "s1", ...extra,
  }
}

test("gateState is open only when the active plan is an approved non-roadmap plan", () => {
  expect(gateState(undefined)).toBe("closed")
  expect(gateState(plan("awaiting_review"))).toBe("closed")
  expect(gateState(plan("changes_requested"))).toBe("closed")
  expect(gateState(plan("approved"))).toBe("open")
  // An approved roadmap does NOT unblock edits.
  expect(gateState(plan("approved", { isRoadmap: true }))).toBe("closed")
  // A draft never unblocks edits.
  expect(gateState(plan("draft"))).toBe("closed")
})

test("buildRoadmapContext enumerates phases with their statuses and progress", () => {
  const road = plan("approved", { id: "road", isRoadmap: true, title: "Roadmap" })
  const children: Artifact[] = [
    plan("approved", { id: "p1", type: "plan", title: "Phase 1", parentId: "road" }),
    plan("draft", { id: "p2", type: "plan", title: "Phase 2", parentId: "road" }),
    { ...plan("published", { id: "r1", title: "Phase 1 results", parentId: "road" }), type: "report" },
  ]
  const ctx = buildRoadmapContext(road, "ROADMAP-BODY", children)
  expect(ctx).toContain("ROADMAP-BODY")
  expect(ctx).toContain("1/2 plans approved")
  expect(ctx).toContain("p1 [plan/approved] — Phase 1")
  expect(ctx).toContain("p2 [plan/draft] — Phase 2")
  expect(ctx).toContain("r1 [report/published] — Phase 1 results")
})

test("buildSessionContext embeds plan content and status", () => {
  const ctx = buildSessionContext(plan("approved"), "BODY-MARKER")
  expect(ctx).toContain("BODY-MARKER")
  expect(ctx).toContain("APPROVED")
  expect(ctx).toContain("p1")
})
