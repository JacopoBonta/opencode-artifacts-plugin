export type ServerEvent =
  | { type: "artifact.published"; id: string }
  | { type: "artifact.updated"; id: string }
  | { type: "artifact.archived"; id: string }
  | { type: "artifact.deleted"; id: string }
  | { type: "comment.added"; id: string }
  | { type: "comment.updated"; id: string }
  | { type: "session.active"; sessionID?: string }
  | { type: "agent.status"; sessionID: string; state: "working" | "idle"; message: string }
  | { type: "ping" }

type Listener = (data: string) => void

export function createBroadcaster() {
  const listeners = new Set<Listener>()

  return {
    subscribe(fn: Listener): () => void {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    broadcast(event: ServerEvent): void {
      const data = JSON.stringify(event)
      // Isolate listeners: one throwing listener (e.g. a closed SSE stream whose
      // enqueue fails) must not starve the others of this event. Drop a listener
      // that throws — its connection is gone.
      for (const fn of listeners) {
        try {
          fn(data)
        } catch {
          listeners.delete(fn)
        }
      }
    },
    count: () => listeners.size,
  }
}

export type Broadcaster = ReturnType<typeof createBroadcaster>
