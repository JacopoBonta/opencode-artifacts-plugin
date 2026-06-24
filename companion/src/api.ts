export interface Anchor { quote: string; prefix: string; suffix: string }
export interface Comment {
  id: string; revision: number; kind: "anchor" | "general"
  anchor?: Anchor; body: string; resolved: boolean; createdAt: number
}
export interface Artifact {
  id: string; type: "plan" | "report"; title: string
  status: string; currentRevision: number; createdAt: number; updatedAt: number
  sessionID?: string; sessionTitle?: string
  parentId?: string; isRoadmap?: boolean
}
export interface ArtifactDetail { artifact: Artifact; content: string; comments: Comment[] }

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
export function subscribeEvents(
  onEvent: (e: any) => void,
  onError?: (e: Event) => void,
): () => void {
  const es = new EventSource("/api/events")
  es.onmessage = (m) => onEvent(JSON.parse(m.data))
  // EventSource auto-reconnects on error; surface it so the UI can show staleness.
  es.onerror = (e) => onError?.(e)
  return () => es.close()
}
