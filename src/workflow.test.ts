import { test, expect } from "bun:test"
import {
  validatePlanStructure,
  isMutatingCall,
  gateState,
  describeGate,
  buildSessionContext,
  buildDeclineContext,
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
  if (!res.ok) expect(res.missing).toEqual(["Goals", "Approach", "Tasks", "Verification"])
})

test("validatePlanStructure ignores headings inside fenced code blocks", () => {
  // A plan whose only "## Goals" etc. live inside a code fence must NOT pass.
  const plan = `# T
## Context
Here is a template I am NOT actually using:
\`\`\`md
## Goals
## Approach
## Tasks
## Verification
## Status
\`\`\`
That code block should not count.`
  const res = validatePlanStructure(plan)
  expect(res.ok).toBe(false)
  if (!res.ok) expect(res.missing).toEqual(["Goals", "Approach", "Tasks", "Verification"])

  // Real headings after a closed fence are still detected.
  const ok = `# T
## Context
c
\`\`\`
code
\`\`\`
## Goals
g
## Approach
a
## Tasks
- [ ] x
## Verification
v
## Status
s`
  expect(validatePlanStructure(ok)).toEqual({ ok: true })
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
  expect(isMutatingCall("bash", { command: "echo hi >> file.txt" })).toBe(true)
  expect(isMutatingCall("bash", { command: "sed -i 's/a/b/' f" })).toBe(true)
  expect(isMutatingCall("bash", { command: "npm install lodash" })).toBe(true)
  // working-tree-mutating git subcommands are still gated
  expect(isMutatingCall("bash", { command: "git checkout ." })).toBe(true)
  expect(isMutatingCall("bash", { command: "git reset --hard" })).toBe(true)

  expect(isMutatingCall("bash", { command: "ls -la" })).toBe(false)
  expect(isMutatingCall("bash", { command: "grep -r foo src" })).toBe(false)
  expect(isMutatingCall("bash", { command: "git status" })).toBe(false)
  expect(isMutatingCall("bash", {})).toBe(false)
})

test("isMutatingCall does not flag git bookkeeping, fd redirects, or '->' in messages", () => {
  // VCS commands that don't touch the working tree
  expect(isMutatingCall("bash", { command: "git add file.tsx" })).toBe(false)
  expect(isMutatingCall("bash", { command: "git -c core.hooksPath=/dev/null add f 2>&1" })).toBe(false)
  expect(isMutatingCall("bash", { command: 'git commit -m "create -> challenge -> done"' })).toBe(false)
  expect(isMutatingCall("bash", { command: "git push origin main" })).toBe(false)
  // fd redirects / dups are not file writes
  expect(isMutatingCall("bash", { command: "ls 2>&1" })).toBe(false)
  expect(isMutatingCall("bash", { command: "cat f 2>/dev/null" })).toBe(false)
  // a genuine file-writing redirect still IS gated
  expect(isMutatingCall("bash", { command: "echo x > f.txt" })).toBe(true)
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
  // A plan completed by a report never unblocks edits, even though it's approved.
  expect(gateState(plan("approved", { completed: true }))).toBe("closed")
})

test("describeGate: forced open short-circuits regardless of plan state", () => {
  expect(describeGate(undefined, true)).toEqual({ state: "open", forced: true, reason: "Manually unlocked" })
  // Forced wins even over a plan the workflow would otherwise close the gate for.
  expect(describeGate(plan("awaiting_review"), true)).toEqual({
    state: "open", forced: true, reason: "Manually unlocked",
  })
  // And still reports forced:true even when the plan is ALSO genuinely approved.
  expect(describeGate(plan("approved"), true)).toEqual({
    state: "open", forced: true, reason: "Manually unlocked",
  })
})

test("describeGate: unforced reasons mirror gateState per plan state", () => {
  expect(describeGate(undefined, false)).toEqual({ state: "closed", forced: false, reason: "no plan published" })
  expect(describeGate(plan("awaiting_review"), false)).toEqual({
    state: "closed", forced: false, reason: "plan awaiting review",
  })
  expect(describeGate(plan("changes_requested"), false)).toEqual({
    state: "closed", forced: false, reason: "plan changes requested",
  })
  expect(describeGate(plan("declined"), false)).toEqual({
    state: "closed", forced: false, reason: "plan declined",
  })
  expect(describeGate(plan("approved"), false)).toEqual({
    state: "open", forced: false, reason: "plan approved",
  })
  expect(describeGate(plan("approved", { isRoadmap: true }), false)).toEqual({
    state: "closed", forced: false, reason: "roadmap approved, no phase plan active",
  })
  expect(describeGate(plan("approved", { completed: true }), false)).toEqual({
    state: "closed", forced: false, reason: "plan completed",
  })
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

test("buildDeclineContext states the rejection, the reason, and 'do not resume'", () => {
  const ctx = buildDeclineContext(plan("declined", { title: "Bad plan", declineReason: "out of scope" }))
  expect(ctx).toContain("DECLINED")
  expect(ctx).toContain("Bad plan")
  expect(ctx).toContain("out of scope")
  expect(ctx).toMatch(/do not resume/i)
})

test("buildDeclineContext handles a missing reason", () => {
  const ctx = buildDeclineContext(plan("declined", { title: "Bad plan" }))
  expect(ctx).toContain("No reason was given")
  expect(ctx).toMatch(/do not resume/i)
})
