import { join } from "node:path"
import { existsSync } from "node:fs"
import type { Store } from "./store"
import type { Broadcaster } from "./events"

export interface ServerOptions {
  store: Store
  events: Broadcaster
  /** 0 = pick a free port */
  port?: number
  /** directory of prebuilt companion assets, or null to disable static serving */
  staticDir?: string | null
  /** resolve a human title for a session id (for grouping); optional */
  resolveSessionTitle?: (sessionID: string) => Promise<string | undefined>
  /** the opencode session the user is currently in, for highlighting; optional */
  getActiveSession?: () => string | undefined
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  })

/** Reject artifact ids that could escape the artifacts root on disk writes. */
const safeId = (id: string) => !id.includes("..") && !id.startsWith(".") && !id.includes("/")

export function createServer(opts: ServerOptions) {
  const { store, events } = opts
  const staticDir = opts.staticDir ?? null

  const server = Bun.serve({
    port: opts.port ?? 0,
    // The /api/events SSE stream is intentionally long-lived and mostly idle;
    // disable Bun's default 10s idle timeout so the connection isn't dropped.
    idleTimeout: 0,
    async fetch(req) {
      const url = new URL(req.url)
      const path = url.pathname

      // --- SSE stream ---
      if (path === "/api/events") {
        const stream = new ReadableStream({
          start(controller) {
            const enc = new TextEncoder()
            const send = (data: string) =>
              controller.enqueue(enc.encode(`data: ${data}\n\n`))
            send(JSON.stringify({ type: "ping" }))
            // Sync the freshly-connected client to the current session so a page
            // load/reconnect highlights the right group without waiting for the
            // next user message.
            const active = opts.getActiveSession?.()
            if (active) send(JSON.stringify({ type: "session.active", sessionID: active }))
            const unsub = events.subscribe(send)
            req.signal.addEventListener("abort", () => {
              unsub()
              try { controller.close() } catch { /* already closed */ }
            })
          },
        })
        return new Response(stream, {
          headers: {
            "content-type": "text/event-stream",
            "cache-control": "no-cache",
            connection: "keep-alive",
          },
        })
      }

      // --- API ---
      if (path === "/api/artifacts" && req.method === "GET") {
        const artifacts = await store.list()
        if (!opts.resolveSessionTitle) return json(artifacts)
        const resolve = opts.resolveSessionTitle
        const withTitles = await Promise.all(
          artifacts.map(async (a) => ({
            ...a,
            sessionTitle: a.sessionID ? await resolve(a.sessionID) : undefined,
          })),
        )
        return json(withTitles)
      }

      const detail = path.match(/^\/api\/artifacts\/([^/]+)$/)
      if (detail && req.method === "GET") {
        const id = detail[1]
        const artifact = await store.get(id)
        if (!artifact) return json({ error: "not found" }, 404)
        const content = await store.readRevision(id, artifact.currentRevision)
        const comments = await store.getComments(id)
        return json({ artifact, content, comments })
      }

      const revMatch = path.match(/^\/api\/artifacts\/([^/]+)\/revisions\/(\d+)$/)
      if (revMatch && req.method === "GET") {
        try {
          const content = await store.readRevision(revMatch[1], Number(revMatch[2]))
          return json({ content })
        } catch {
          return json({ error: "revision not found" }, 404)
        }
      }

      const commentMatch = path.match(/^\/api\/artifacts\/([^/]+)\/comments$/)
      if (commentMatch && req.method === "POST") {
        const id = commentMatch[1]
        if (!safeId(id)) return json({ error: "not found" }, 404)
        const ca = await store.get(id)
        if (ca && (ca.status === "approved" || ca.type === "report")) {
          return json({ error: "read-only artifact" }, 409)
        }
        let b: any
        try { b = await req.json() } catch { return json({ error: "invalid json" }, 400) }
        let c
        try {
          c = await store.addComment(id, {
            revision: b.revision, kind: b.kind, anchor: b.anchor, body: b.body,
          })
        } catch {
          return json({ error: "unknown artifact" }, 404)
        }
        events.broadcast({ type: "comment.added", id })
        return json(c, 201)
      }

      const verdictMatch = path.match(/^\/api\/artifacts\/([^/]+)\/verdict$/)
      if (verdictMatch && req.method === "POST") {
        const id = verdictMatch[1]
        if (!safeId(id)) return json({ error: "not found" }, 404)
        const va = await store.get(id)
        if (va && (va.status === "approved" || va.type === "report")) {
          return json({ error: "read-only artifact" }, 409)
        }
        // A draft has no agent awaiting a verdict; it must be submitted first.
        if (va && va.status === "draft") {
          return json({ error: "draft not submitted for review" }, 409)
        }
        let b: any
        try { b = await req.json() } catch { return json({ error: "invalid json" }, 400) }
        // Carry the reviewer's unresolved comments to the agent for BOTH
        // verdicts — an approval with comments means "proceed, but honor these".
        const comments = (await store.getComments(id)).filter((c) => !c.resolved)
        await store.resolveVerdict(
          id,
          b.status === "approved"
            ? { status: "approved", comments }
            : { status: "changes_requested", comments },
        )
        events.broadcast({ type: "artifact.updated", id })
        return json({ ok: true })
      }

      const archiveMatch = path.match(/^\/api\/artifacts\/([^/]+)\/archive$/)
      if (archiveMatch && req.method === "POST") {
        const id = archiveMatch[1]
        if (!safeId(id)) return json({ error: "not found" }, 404)
        let b: any
        try { b = await req.json() } catch { return json({ error: "invalid json" }, 400) }
        try {
          await store.setArchived(id, b.archived === true)
        } catch {
          return json({ error: "unknown artifact" }, 404)
        }
        events.broadcast({ type: "artifact.archived", id })
        return json({ ok: true })
      }

      const deleteMatch = path.match(/^\/api\/artifacts\/([^/]+)$/)
      if (deleteMatch && req.method === "DELETE") {
        const id = deleteMatch[1]
        if (!safeId(id)) return json({ error: "not found" }, 404)
        const da = await store.get(id)
        if (!da) return json({ error: "not found" }, 404)
        // Only archived artifacts may be deleted.
        if (!da.archived) return json({ error: "archive before deleting" }, 409)
        await store.remove(id)
        events.broadcast({ type: "artifact.deleted", id })
        return json({ ok: true })
      }

      // --- static companion ---
      if (staticDir && !path.startsWith("/api/")) {
        const rel = path === "/" ? "index.html" : path.slice(1)
        const file = join(staticDir, rel)
        if (existsSync(file)) return new Response(Bun.file(file))
        const index = join(staticDir, "index.html")
        if (existsSync(index)) return new Response(Bun.file(index)) // SPA fallback
      }

      return json({ error: "not found" }, 404)
    },
  })

  const url = `http://localhost:${server.port}`
  return { url, port: server.port, stop: () => server.stop(true) }
}

export type ArtifactServer = ReturnType<typeof createServer>
