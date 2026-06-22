export type ArtifactType = "plan" | "report"

export type ArtifactStatus =
  | "awaiting_review"
  | "approved"
  | "changes_requested"
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
}

export type Verdict =
  | { status: "approved" }
  | { status: "changes_requested"; comments: Comment[] }

export function isPlan(a: Pick<Artifact, "type">): a is { type: "plan" } {
  return a.type === "plan"
}
