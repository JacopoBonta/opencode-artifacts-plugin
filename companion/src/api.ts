export interface Anchor { quote: string; prefix: string; suffix: string }
export interface Comment {
  id: string; revision: number; kind: "anchor" | "general"
  anchor?: Anchor; body: string; resolved: boolean; createdAt: number
}
export interface Artifact {
  id: string; type: "plan" | "report"; title: string
  status: string; currentRevision: number; createdAt: number; updatedAt: number
  sessionID?: string; sessionTitle?: string
  parentId?: string; isRoadmap?: boolean; agent?: string; archived?: boolean
}
export interface ArtifactDetail { artifact: Artifact; content: string; comments: Comment[] }

/** Events pushed over the /api/events SSE stream. */
export type ServerEvent =
  | { type: "artifact.published"; id: string }
  | { type: "artifact.updated"; id: string }
  | { type: "artifact.archived"; id: string }
  | { type: "artifact.deleted"; id: string }
  | { type: "comment.added"; id: string }
  | { type: "session.active"; sessionID?: string }
  | { type: "ping" }

const jsonPost = (body: unknown) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
})

export async function listArtifacts(): Promise<Artifact[]> {
  return (await fetch("/api/artifacts")).json()
}
export async function getArtifact(id: string): Promise<ArtifactDetail> {
  return (await fetch(`/api/artifacts/${id}`)).json()
}
export async function getRevision(id: string, n: number): Promise<{ content: string }> {
  return (await fetch(`/api/artifacts/${id}/revisions/${n}`)).json()
}
export async function postComment(
  id: string,
  c: { revision: number; kind: "anchor" | "general"; anchor?: Anchor; body: string },
): Promise<Comment> {
  return (await fetch(`/api/artifacts/${id}/comments`, jsonPost(c))).json()
}
export async function postVerdict(
  id: string,
  status: "approved" | "changes_requested",
): Promise<void> {
  await fetch(`/api/artifacts/${id}/verdict`, jsonPost({ status }))
}
export async function setArchived(id: string, archived: boolean): Promise<void> {
  await fetch(`/api/artifacts/${id}/archive`, jsonPost({ archived }))
}
export async function deleteArtifact(id: string): Promise<void> {
  await fetch(`/api/artifacts/${id}`, { method: "DELETE" })
}
export function subscribeEvents(
  onEvent: (e: ServerEvent) => void,
  onError?: (e: Event) => void,
): () => void {
  const es = new EventSource("/api/events")
  es.onmessage = (m) => onEvent(JSON.parse(m.data))
  // EventSource auto-reconnects on error; surface it so the UI can show staleness.
  es.onerror = (e) => onError?.(e)
  return () => es.close()
}
