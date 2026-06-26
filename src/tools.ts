import { tool } from "@opencode-ai/plugin"
import type { Store } from "./store"
import type { Broadcaster } from "./events"
import { validatePlanStructure, PLAN_TEMPLATE, ROADMAP_TEMPLATE } from "./workflow"

export interface ToolDeps {
  store: Store
  events: Broadcaster
  url: string
  /** show a toast / open the browser; injected so tests stay headless */
  notify: (message: string, artifactUrl?: string) => void
}

export function createPublishTool(deps: ToolDeps) {
  const { store, events, url, notify } = deps

  return tool({
    description:
      "Publish an artifact for human review in the browser companion. " +
      "type='plan' BLOCKS: this tool call does not return until the user approves " +
      "or requests changes — do not issue any other tool call while waiting. It " +
      "returns their verdict; on changes_requested, revise and re-publish with the " +
      "same artifactId to add a revision, looping until approved. An approved " +
      "verdict may still include comments — treat them as guidance you must honor " +
      "while implementing. type='report' " +
      "returns immediately; publishing a report also COMPLETES the session's " +
      "current standalone plan and re-closes the edit gate (start new work with a " +
      "fresh plan, or resubmit the completed plan). A phase report (with parentId) " +
      "is a milestone and does NOT complete the roadmap. Content is markdown. " +
      "Required workflow: for any implementation request, do a deep analysis then " +
      "publish a plan FIRST — file edits are blocked until a plan is approved — " +
      "then implement, then publish a report. A plan MUST contain these ## " +
      "sections: Context/Analysis, Goals, Approach, Tasks (or Steps), " +
      "Verification, Status; publishing a plan without them is rejected. " +
      "For large work, set roadmap=true to publish a decomposition overview " +
      "(sections: Context, Goals, Phases, Status); approving a roadmap does NOT " +
      "unblock edits. After the roadmap is approved, scratch EVERY phase upfront " +
      "as a draft sub-plan: publish_artifact(type:'plan', draft:true, " +
      "parentId:<roadmap id>, ...) returns immediately without blocking. Record " +
      "each returned artifactId in the roadmap's Phases section. Then run each " +
      "phase as a cycle: refine its draft if needed and SUBMIT it by re-publishing " +
      "the same artifactId WITHOUT draft (this blocks until approved and unblocks " +
      "edits), implement, then publish a results report with the same parentId. " +
      "Drafts must already contain all required sections. " +
      "Across revisions, update sections IN PLACE to reflect the current state — " +
      "never append 'RESOLVED:' notes. " +
      "While implementing, keep the plan's Status section and task checkboxes " +
      "current by re-publishing the approved plan (same artifactId): re-publishing " +
      "an APPROVED plan is a non-blocking progress update that stays approved and " +
      "returns immediately — it does NOT require re-approval. Set resubmit=true " +
      "only when you change the plan's scope/approach and want a fresh review.",
    args: {
      type: tool.schema.enum(["plan", "report"]).describe("plan gates the work; report is informational"),
      title: tool.schema.string().describe("short artifact title"),
      content: tool.schema.string().describe("artifact body in markdown"),
      artifactId: tool.schema
        .string()
        .optional()
        .describe("omit to create new; pass to add a revision to an existing artifact"),
      parentId: tool.schema
        .string()
        .optional()
        .describe("roadmap artifact id this phase plan/report belongs to"),
      roadmap: tool.schema
        .boolean()
        .optional()
        .describe("true to publish a decomposition overview plan (does not unblock edits when approved)"),
      draft: tool.schema
        .boolean()
        .optional()
        .describe("scratch a phase plan as a non-blocking draft; re-publish without draft to submit it for review"),
      resubmit: tool.schema
        .boolean()
        .optional()
        .describe("force a fresh review of an already-approved plan (instead of a non-blocking progress update)"),
    },
    async execute(args, context) {
      const sessionID = context.sessionID

      if (args.type === "plan") {
        const check = validatePlanStructure(args.content, { roadmap: args.roadmap })
        if (!check.ok) {
          // Reject without creating/revising the artifact; the agent fixes the
          // structure and re-publishes.
          return JSON.stringify({
            error:
              "Plan rejected: missing required sections. Add them and re-publish.",
            missingSections: check.missing,
            template: args.roadmap ? ROADMAP_TEMPLATE : PLAN_TEMPLATE,
          })
        }
      }

      const { artifact } = await store.publish({
        type: args.type,
        title: args.title,
        content: args.content,
        artifactId: args.artifactId,
        sessionID,
        agent: context.agent,
        parentId: args.parentId,
        isRoadmap: args.type === "plan" ? args.roadmap : undefined,
        draft: args.type === "plan" ? args.draft : undefined,
        resubmit: args.resubmit,
      })
      const artifactUrl = `${url}/artifacts/${artifact.id}`
      events.broadcast({ type: "artifact.published", id: artifact.id })

      if (args.type === "report") {
        notify(`Report published: ${artifact.title}`, artifactUrl)
        return JSON.stringify({ artifactId: artifact.id, url: artifactUrl })
      }

      // A draft is non-blocking — it is scratched, not yet submitted for review.
      if (artifact.status === "draft") {
        notify(`Phase draft saved: ${artifact.title}`, artifactUrl)
        return JSON.stringify({ artifactId: artifact.id, status: "draft", url: artifactUrl })
      }

      // Re-publishing an already-approved plan is a non-blocking progress update
      // (Status/checkboxes) — it stays approved and never re-prompts for review.
      if (artifact.status === "approved") {
        notify(`Plan progress updated: ${artifact.title}`, artifactUrl)
        return JSON.stringify({
          status: "approved",
          artifactId: artifact.id,
          revision: artifact.currentRevision,
          progress: true,
        })
      }

      notify(`Plan awaiting review: ${artifact.title}`, artifactUrl)
      const verdict = await store.awaitVerdict(artifact.id)
      // Comments accompany BOTH verdicts: on changes_requested they are the
      // changes to make; on approved they are guidance to honor while building.
      const comments = (verdict.comments ?? []).map((c) => ({
        body: c.body,
        kind: c.kind,
        quote: c.anchor?.quote,
      }))
      // A declined plan is rejected outright: the session is normally aborted
      // before this returns, but if the interrupt is unavailable this terminal
      // result (with the reviewer's reason) tells the agent to stop, not loop.
      if (verdict.status === "declined") {
        return JSON.stringify({
          status: "declined",
          artifactId: artifact.id,
          reason: verdict.reason,
          comments,
          stop: "This plan was declined. Do not retry or revise it; await the user's direction.",
        })
      }
      return JSON.stringify({ status: verdict.status, artifactId: artifact.id, comments })
    },
  })
}
