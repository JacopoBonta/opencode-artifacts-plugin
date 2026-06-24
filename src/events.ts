export type ServerEvent =
  | { type: "artifact.published"; id: string }
  | { type: "artifact.updated"; id: string }
  | { type: "artifact.archived"; id: string }
  | { type: "artifact.deleted"; id: string }
  | { type: "comment.added"; id: string }
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
      for (const fn of listeners) fn(data)
    },
    count: () => listeners.size,
  }
}

export type Broadcaster = ReturnType<typeof createBroadcaster>
