import { tool } from "@opencode-ai/plugin"
import type { Store } from "./store"
import type { Broadcaster } from "./events"
import { validatePlanStructure, PLAN_TEMPLATE, ROADMAP_TEMPLATE } from "./workflow"

export interface ToolDeps {
  store: Store
  events: Broadcaster
  url: string
  /** capability token appended to deep links so the companion can authenticate */
  token?: string
  /** show a toast / open the browser; injected so tests stay headless */
  notify: (message: string, artifactUrl?: string) => void
}

export function createPublishTool(deps: ToolDeps) {
  const { store, events, url, token, notify } = deps
  // Carry the token on deep links (the companion reads `?token=` on any route).
  const tokenQuery = token ? `?token=${encodeURIComponent(token)}` : ""

  return tool({
    description:
      "Publish an artifact for human review in the browser companion. " +
      "type='plan' BLOCKS: this tool call does not return until the user approves " +
      "or requests changes — do not issue any other tool call while waiting. It " +
      "returns their verdict; on changes_requested, revise and re-publish with the " +
      "same artifactId to add a revision, looping until approved. An approved " +
      "verdict may still include comments — treat them as guidance you must honor " +
      "while implementing. type='report' " +
      "returns immediately. A report is automatically LINKED to (and nested " +
      "under) the session's active plan — you do NOT pass parentId for a report. " +
      "Publishing a report against a STANDALONE plan also COMPLETES it and " +
      "re-closes the edit gate (start new work with a fresh plan, or resubmit the " +
      "completed plan). A report against a roadmap PHASE plan nests under that " +
      "phase as a milestone and does NOT complete the roadmap. Content is markdown. " +
      "Required workflow: for any implementation request, do a deep analysis then " +
      "publish a plan FIRST — file edits are blocked until a plan is approved — " +
      "then implement, then publish a report. A plan MUST contain these ## " +
      "sections: Context/Analysis, Goals, Approach, Tasks (or Steps), " +
      "Verification; publishing a plan without them is rejected. " +
      "For large work, set roadmap=true to publish a decomposition overview " +
      "(sections: Context, Goals, Phases); approving a roadmap does NOT " +
      "unblock edits. After the roadmap is approved, scratch EVERY phase upfront " +
      "as a draft sub-plan: publish_artifact(type:'plan', draft:true, " +
      "parentId:<roadmap id>, ...) returns immediately without blocking; their " +
      "artifact IDs and statuses are tracked for you automatically — do NOT edit " +
      "the approved roadmap to record them. Then run each " +
      "phase as a cycle: refine its draft if needed and SUBMIT it by re-publishing " +
      "the same artifactId WITHOUT draft (this blocks until approved and unblocks " +
      "edits), implement, then publish a results report (it auto-nests under " +
      "that phase plan — no parentId needed). " +
      "Drafts must already contain all required sections. " +
      "While a plan is still in review, update sections IN PLACE across revisions " +
      "to reflect the current state — never append 'RESOLVED:' notes. " +
      "Once a plan is APPROVED it is FROZEN: re-publishing it is rejected. Do NOT " +
      "re-publish an approved plan to record progress — track implementation " +
      "progress with the todo tool instead. Set resubmit=true ONLY when you change " +
      "the plan's scope/approach and want to send it back for a fresh review.",
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
        .describe("roadmap artifact id a phase PLAN belongs to (reports auto-link to the active plan; do not pass for reports)"),
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
        .describe("re-publish an approved (frozen) plan by sending it back for a fresh review; required to edit an approved plan"),
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

        // An approved plan is FROZEN. Re-publishing it (without resubmit) is
        // rejected with an actionable message instead of a raw thrown error —
        // the store also guards this, but catching it here keeps the agent's
        // tool result structured. resubmit:true falls through to a fresh review.
        if (args.artifactId && !args.resubmit) {
          const existing = await store.get(args.artifactId)
          if (existing?.status === "approved") {
            return JSON.stringify({
              error:
                "This plan is approved and frozen — it cannot be edited. Track " +
                "implementation progress with the todo tool. To change its scope " +
                "or approach, re-publish with resubmit:true for a fresh review.",
              artifactId: args.artifactId,
              status: "approved",
            })
          }
        }
      }

      const { artifact } = await store.publish({
        type: args.type,
        title: args.title,
        content: args.content,
        artifactId: args.artifactId,
        sessionID,
        agent: context.agent,
        // Only plans carry a caller-supplied parent (a phase plan's roadmap).
        // A report's parent is derived by the store from the active plan, so it
        // nests under the plan it reports on — no need to pass one.
        parentId: args.type === "plan" ? args.parentId : undefined,
        isRoadmap: args.type === "plan" ? args.roadmap : undefined,
        draft: args.type === "plan" ? args.draft : undefined,
        resubmit: args.resubmit,
      })
      const artifactUrl = `${url}/artifacts/${artifact.id}${tokenQuery}`
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
