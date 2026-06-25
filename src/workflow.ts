import type { Artifact } from "./types"
import { isMutatingBash } from "./bash-gate"

/**
 * Workflow policy for the plan -> implement -> report flow, including
 * decomposition of large work into a roadmap + per-phase cycles.
 *
 * The plugin enforces this by:
 *  - gating file-mutating tool calls until the session has an APPROVED,
 *    non-roadmap plan (see `isMutatingCall` + `gateState`),
 *  - validating that published plans keep a canonical structure
 *    (see `validatePlanStructure`), and
 *  - injecting the contract + the live plan(s) into the model every turn
 *    (see `buildWorkflowContract` + `buildSessionContext`), which also keeps
 *    the plan in view across context compaction.
 *
 * Everything here is pure and synchronous so it can be unit-tested in isolation.
 */

interface Section {
  canonical: string
  synonyms: string[]
}

/**
 * Required `##` sections a standard plan must contain (the hard-validated
 * "core"). Each entry lists accepted heading synonyms (case-insensitive); the
 * canonical name is the first one. Richer sections (alternatives, risks, open
 * questions, affected areas) are recommended via the template/contract but not
 * hard-validated, to keep the gate from devolving into box-checking.
 */
export const REQUIRED_PLAN_SECTIONS: Section[] = [
  { canonical: "Context", synonyms: ["context", "background", "analysis", "problem", "understanding"] },
  { canonical: "Goals", synonyms: ["goals", "goal", "objectives", "acceptance criteria", "acceptance"] },
  { canonical: "Approach", synonyms: ["approach", "design", "solution", "strategy"] },
  { canonical: "Tasks", synonyms: ["tasks", "task", "steps", "implementation", "work"] },
  { canonical: "Verification", synonyms: ["verification", "testing", "test plan", "validation", "how to test", "tests"] },
  { canonical: "Status", synonyms: ["status", "progress"] },
]

/** Required `##` sections for a roadmap (decomposition overview) plan. */
export const REQUIRED_ROADMAP_SECTIONS: Section[] = [
  { canonical: "Context", synonyms: ["context", "background", "analysis", "problem", "understanding"] },
  { canonical: "Goals", synonyms: ["goals", "goal", "objectives", "acceptance criteria", "acceptance"] },
  { canonical: "Phases", synonyms: ["phases", "phase", "milestones", "breakdown", "sub-plans", "subplans", "stages"] },
  { canonical: "Status", synonyms: ["status", "progress"] },
]

/** Skeleton handed to the agent when a standard plan is missing required structure. */
export const PLAN_TEMPLATE = `# <concise plan title>

## Context / Analysis
Restate the request in your own words. What problem is being solved, why now,
and what is the intended outcome? Note explicit AND implicit requirements and
any constraints you discovered while exploring the codebase.

## Goals
Concrete, checkable goals / acceptance criteria — what must be true when done.

## Approach
The design you will follow and WHY. Reference the concrete files/modules
involved. (Recommended: an "### Alternatives considered" note explaining other
options you rejected and the reason.)

## Tasks
- [ ] Step 1 — the change and the files it touches
- [ ] Step 2 — ...

## Verification
How the change will be proven to work end-to-end (tests to run/add, manual
checks, commands).

## Status
Update this section IN PLACE as work proceeds (mark tasks done above, note
blockers here). Do NOT append "RESOLVED:" notes — edit the relevant section so
the plan always reflects the current state.

<!-- Recommended when relevant: ## Risks & Trade-offs, ## Open Questions /
Assumptions, ## Affected Areas -->`

/** Skeleton for a roadmap plan that decomposes large work into phases. */
export const ROADMAP_TEMPLATE = `# <roadmap title>

## Context / Analysis
The overall problem and why it is large enough to split into phases.

## Goals
The end-to-end outcome across all phases (acceptance criteria for "all done").

## Phases
An ordered breakdown. Each phase becomes its own plan -> implement -> results
cycle. Scratch every phase as a draft sub-plan upfront and record its artifact
id here (fill in <id> after scratching):
1. Phase 1 — <name> (artifact <id>): scope / outcome
2. Phase 2 — <name> (artifact <id>): scope / outcome
3. ...

## Status
Which phase is in progress and what is done. Update IN PLACE.`

export type PlanValidation = { ok: true } | { ok: false; missing: string[] }

/**
 * Extract the text of every `##`/`###` heading in a markdown document. Lines
 * inside fenced code blocks (``` or ~~~) are skipped so a code sample containing
 * e.g. `## Goals` can't satisfy plan validation.
 */
function headings(content: string): string[] {
  const out: string[] = []
  let fence: string | undefined // the opening fence marker while inside a block
  for (const line of content.split(/\r?\n/)) {
    const f = /^\s*(```+|~~~+)/.exec(line)
    if (f) {
      if (!fence) fence = f[1][0] // entering a block (track ` vs ~)
      else if (f[1][0] === fence) fence = undefined // matching close
      continue
    }
    if (fence) continue
    const m = /^#{2,3}\s+(.+?)\s*$/.exec(line)
    if (m) out.push(m[1].toLowerCase())
  }
  return out
}

/**
 * Check a plan body for the required canonical sections. A section is satisfied
 * if any heading contains one of its synonyms (so "## Goals & acceptance
 * criteria" counts for Goals). Returns the canonical names of missing sections.
 * Pass `{ roadmap: true }` to validate against the roadmap profile.
 */
export function validatePlanStructure(
  content: string,
  opts: { roadmap?: boolean } = {},
): PlanValidation {
  const required = opts.roadmap ? REQUIRED_ROADMAP_SECTIONS : REQUIRED_PLAN_SECTIONS
  const found = headings(content)
  const missing = required
    .filter((sec) => !found.some((h) => sec.synonyms.some((syn) => h.includes(syn))))
    .map((sec) => sec.canonical)
  return missing.length === 0 ? { ok: true } : { ok: false, missing }
}

/** Tools that always mutate the workspace and are gated behind an approved plan. */
export const GATED_TOOLS = new Set(["write", "edit", "patch"])

/**
 * Does this tool call mutate the workspace (and thus require an approved plan)?
 * `bash` is gated via `isMutatingBash` (a quote/operator-aware heuristic) so
 * read-only exploration (grep, ls, git status, running tests) stays unblocked
 * while planning. See `bash-gate.ts`.
 */
export function isMutatingCall(toolName: string, args: unknown): boolean {
  if (GATED_TOOLS.has(toolName)) return true
  if (toolName === "bash") {
    const command = (args as { command?: unknown } | null | undefined)?.command
    return typeof command === "string" && isMutatingBash(command)
  }
  return false
}

export type GateState = "open" | "closed"

/**
 * The gate is OPEN (edits allowed) only when the session's active plan is an
 * APPROVED, non-roadmap plan. No plan, awaiting review, or changes requested all
 * keep it CLOSED. A roadmap plan being approved means "the decomposition is
 * agreed", NOT "go edit" — the agent must publish a phase plan and get THAT
 * approved before editing, so an approved roadmap keeps the gate closed.
 */
export function gateState(plan: Artifact | undefined): GateState {
  // A completed plan (a report marked its work done) never opens the gate; the
  // live path already excludes it via getActivePlan, this keeps gateState
  // self-describing for direct callers.
  if (!plan || plan.isRoadmap || plan.completed) return "closed"
  return plan.status === "approved" ? "open" : "closed"
}

/** Static rules text injected into the system prompt every turn. */
export function buildWorkflowContract(): string {
  return `# Artifact workflow (enforced)

You operate under a plan -> implement -> report workflow backed by the artifacts
companion. This is enforced by the runtime, not optional:

1. ANALYZE, THEN PLAN. For any request that involves implementing or changing
   code, your first step is to publish a plan with
   \`publish_artifact(type: "plan", ...)\`. File-mutating tools (write, edit,
   patch, and mutating bash commands) are BLOCKED until this session has an
   approved plan — attempting them before approval fails.

   Before writing the plan, do a DEEP ANALYSIS of the request — a shallow plan
   that just lists steps is not acceptable:
   - Restate the problem in your own words; identify explicit AND implicit
     requirements and the acceptance criteria.
   - Surface assumptions, ambiguities, and open questions.
   - Explore the codebase to find the affected areas and reusable patterns;
     reference concrete files in the plan.
   - Consider at least one alternative approach and justify the one you chose.
   The published plan must reflect that analysis.

2. GET IT APPROVED. The plan blocks until the human approves or requests changes.
   On changes_requested, revise the SAME artifact (pass its artifactId) and
   re-publish, looping until approved.
3. IMPLEMENT THE PLAN. Once approved, edits are unblocked. Follow the approved
   plan; keep its "Status" section and task checkboxes current as you go by
   re-publishing the approved plan (same artifactId). Re-publishing an approved
   plan is a non-blocking PROGRESS UPDATE — it stays approved, returns
   immediately, and does NOT require re-approval. Only set resubmit:true if you
   change the plan's scope or approach and want a fresh review.
4. REPORT. When the planned work is complete, publish a report with
   \`publish_artifact(type: "report", ...)\` summarizing what was done and what
   was not. Publishing a report COMPLETES the current plan and RE-CLOSES the edit
   gate — file edits are blocked again afterward. (A report on a roadmap phase,
   i.e. with a \`parentId\`, is a phase milestone and does NOT complete the
   roadmap; continue to the next phase.)

Standard plan structure — every plan MUST contain these \`##\` sections:
Context/Analysis, Goals, Approach, Tasks (or Steps), Verification, Status.
When relevant, also include: Alternatives considered, Risks & Trade-offs, Open
Questions / Assumptions, Affected Areas. Template:

${PLAN_TEMPLATE}

DECOMPOSING LARGE WORK. If a request is large or multi-part, do NOT cram it into
one plan. First publish a ROADMAP overview with
\`publish_artifact(type: "plan", roadmap: true, ...)\` that breaks the work into
ordered phases (see roadmap template below). Approving a roadmap does NOT unblock
edits — it only agrees the decomposition.

Once the roadmap is approved, SCRATCH EVERY PHASE UPFRONT as a draft sub-plan:
\`publish_artifact(type: "plan", draft: true, parentId: <roadmap id>, ...)\`. A
draft returns immediately (non-blocking) and does NOT unblock edits, so you can
scratch them all in a row; this persists the whole breakdown so it survives a
context compaction. Each draft must already contain the full plan structure.
Record each returned artifactId in the roadmap's Phases section.

Then run EACH phase as its own cycle, in order:
1. Refine that phase's draft if needed, then SUBMIT it for review by re-publishing
   the SAME artifactId WITHOUT draft (\`publish_artifact(type: "plan",
   artifactId: <phase id>, ...)\`). This blocks until approved and unblocks edits
   for that phase.
2. Implement the phase.
3. Publish a results report with the same \`parentId\`.
Move to the next phase and repeat.

${ROADMAP_TEMPLATE}

Preserve structure across revisions. UPDATE SECTIONS IN PLACE to reflect the
current state — mark tasks done, edit the Status section. Never append
"RESOLVED: ..." notes or leave stale text; a plan must always read as the single
current source of truth.

After a report completes a plan, any further edits require a FRESH plan for the
new work — or, to continue the same plan, re-publish it with \`resubmit: true\`
for a fresh approval. A normal progress-update re-publish does NOT reopen the
gate. For a brand-new implementation request later in the session, always publish
a FRESH plan (or roadmap) rather than reusing an already-approved one.`
}

/**
 * Dynamic per-session block describing the active plan and embedding its current
 * content, so the model always has the live plan available — including after a
 * context compaction.
 */
export function buildSessionContext(plan: Artifact, content: string): string {
  const kind = plan.isRoadmap ? "roadmap" : "plan"
  const gate =
    gateState(plan) === "open"
      ? "APPROVED — edits unblocked"
      : plan.isRoadmap && plan.status === "approved"
        ? "approved roadmap — publish/approve a phase plan to edit"
        : `${plan.status} — edits BLOCKED`
  return `# Active ${kind} for this session

- id: ${plan.id}
- title: ${plan.title}
- revision: ${plan.currentRevision}
- status: ${gate}

Current ${kind} content (the source of truth — keep it updated in place):

${content}`
}

/**
 * Enumerate a roadmap's phase artifacts (id / title / status) plus progress, so
 * the full plan-of-record — including scratched drafts of upcoming phases —
 * survives a context compaction.
 */
export function buildPhaseList(children: Artifact[]): string {
  const phasePlans = children.filter((c) => c.type === "plan")
  const done = phasePlans.filter((c) => c.status === "approved").length
  const lines = children.map(
    (c) => `- ${c.id} [${c.type}/${c.status}] — ${c.title}`,
  )
  return `## Phases of this roadmap (${done}/${phasePlans.length} plans approved)

${lines.join("\n") || "(none scratched yet)"}`
}

/**
 * Context block for the parent roadmap of the active phase, embedding the
 * roadmap content and the enumerated phase list, so the agent always sees the
 * overall plan alongside the current phase.
 */
export function buildRoadmapContext(
  roadmap: Artifact,
  content: string,
  children: Artifact[],
): string {
  return `# Parent roadmap

- id: ${roadmap.id}
- title: ${roadmap.title}

${buildPhaseList(children)}

Roadmap content:

${content}`
}
