export type ArtifactType = "plan" | "report"

export type ArtifactStatus =
  | "draft"
  | "awaiting_review"
  | "approved"
  | "changes_requested"
  | "declined"
  | "published"

export interface Anchor {
  quote: string
  prefix: string
  suffix: string
}

export type CommentKind = "anchor" | "general"

export interface Comment {
  id: string
  revision: number
  kind: CommentKind
  anchor?: Anchor
  body: string
  resolved: boolean
  createdAt: number
}

export interface Artifact {
  id: string
  type: ArtifactType
  title: string
  status: ArtifactStatus
  currentRevision: number
  createdAt: number
  updatedAt: number
  /** opencode session that published this artifact, for report refinement */
  sessionID?: string
  /** name of the agent that created this artifact */
  agent?: string
  /**
   * The artifact this one nests under: a roadmap for phase plans, and the
   * reported-on plan for reports (set automatically when a report is published
   * against an active plan — standalone or phase). Absent on top-level plans,
   * roadmaps, and general (research) reports that have no associated plan.
   */
  parentId?: string
  /** true when this plan is a decomposition overview rather than an editable plan */
  isRoadmap?: boolean
  /** hidden from the main companion view; only archived artifacts may be deleted */
  archived?: boolean
  /**
   * true when a report has marked this (standalone) plan's work complete. A
   * completed plan no longer governs the edit gate (it's excluded from
   * getActivePlan), so the gate re-closes and new work needs a fresh plan.
   * Cleared by resubmitting the plan for a fresh review.
   */
  completed?: boolean
  /**
   * Reviewer's reason for declining the plan (optional). Set when a plan is
   * declined; surfaced to the human in the companion and injected into the
   * agent's context so a re-engaged session knows why the work was rejected.
   */
  declineReason?: string
}

export type VerdictStatus = "approved" | "changes_requested" | "declined"

export type Verdict =
  | { status: "approved"; comments?: Comment[] }
  | { status: "changes_requested"; comments: Comment[] }
  | { status: "declined"; reason?: string; comments?: Comment[] }

export function isPlan(a: Pick<Artifact, "type">): a is { type: "plan" } {
  return a.type === "plan"
}
