import { join, resolve, sep } from "node:path"
import { existsSync } from "node:fs"
import type { Store } from "./store"
import type { Broadcaster } from "./events"
import {
  validateCommentInput,
  validateCommentEdit,
  validateVerdictInput,
  validateArchiveInput,
  validateGateInput,
} from "./validate"
import { describeGate } from "./workflow"

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
  /** interrupt (abort) an opencode session's current turn; used to stop the agent on a declined plan */
  interruptSession?: (sessionID: string) => void
  /**
   * Per-session capability token. When set, every `/api/*` request must present
   * it (header `x-artifacts-token`, or `?token=` for the SSE stream, which can't
   * send headers); mismatches get 401. When omitted, the API is unauthenticated
   * — used by unit tests and a token-less dev backend (so the Vite dev proxy
   * keeps working). Production (src/index.ts) always sets one.
   */
  token?: string
}

/** Cap concurrent SSE streams so a misbehaving/abusive client can't exhaust them. */
const MAX_SSE = 32

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
    // Bind to loopback only. Bun's default (no hostname) listens on ALL
    // interfaces (`*:port`) — which would expose the companion, and the agent's
    // approval gate, to the whole LAN. 127.0.0.1 keeps it on this machine.
    hostname: "127.0.0.1",
    // The /api/events SSE stream is intentionally long-lived and mostly idle;
    // disable Bun's default 10s idle timeout so the connection isn't dropped.
    idleTimeout: 0,
    async fetch(req) {
      const url = new URL(req.url)
      const path = url.pathname

      // --- auth: capability token + same-origin guard for /api/* ---
      // Static (non-/api/) requests are NOT token-gated: the companion bundle is
      // non-sensitive and must load to bootstrap (it then reads the token from
      // the URL and sends it on API calls). Skipped entirely when no token is
      // configured (tests / dev backend).
      if (opts.token && path.startsWith("/api/")) {
        const presented =
          path === "/api/events"
            ? url.searchParams.get("token") // EventSource can't set headers
            : req.headers.get("x-artifacts-token")
        if (presented !== opts.token) return json({ error: "unauthorized" }, 401)
        // CSRF defense-in-depth: a cross-origin state-changing request carries an
        // Origin that won't match ours. (The token already blocks attackers who
        // can't read it; this is belt-and-suspenders.)
        if (req.method === "POST" || req.method === "PATCH" || req.method === "DELETE") {
          const origin = req.headers.get("origin")
          if (origin && origin !== url.origin) return json({ error: "forbidden" }, 403)
        }
      }

      // --- SSE stream ---
      if (path === "/api/events") {
        if (events.count() >= MAX_SSE) return json({ error: "too many connections" }, 503)
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
        if (!safeId(id)) return json({ error: "not found" }, 404)
        const artifact = await store.get(id)
        if (!artifact) return json({ error: "not found" }, 404)
        const content = await store.readRevision(id, artifact.currentRevision)
        const comments = await store.getComments(id)
        return json({ artifact, content, comments })
      }

      const revMatch = path.match(/^\/api\/artifacts\/([^/]+)\/revisions\/(\d+)$/)
      if (revMatch && req.method === "GET") {
        if (!safeId(revMatch[1])) return json({ error: "not found" }, 404)
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
        let b: unknown
        try { b = await req.json() } catch { return json({ error: "invalid json" }, 400) }
        const v = validateCommentInput(b)
        if (!v.ok) return json({ error: v.error }, 400)
        let c
        try {
          c = await store.addComment(id, v.value)
        } catch {
          return json({ error: "unknown artifact" }, 404)
        }
        events.broadcast({ type: "comment.added", id })
        return json(c, 201)
      }

      const commentItemMatch = path.match(/^\/api\/artifacts\/([^/]+)\/comments\/([^/]+)$/)
      if (commentItemMatch && (req.method === "PATCH" || req.method === "DELETE")) {
        const id = commentItemMatch[1]
        const cid = commentItemMatch[2]
        if (!safeId(id)) return json({ error: "not found" }, 404)
        const ca = await store.get(id)
        if (ca && (ca.status === "approved" || ca.type === "report")) {
          return json({ error: "read-only artifact" }, 409)
        }
        if (req.method === "DELETE") {
          try {
            await store.deleteComment(id, cid)
          } catch {
            return json({ error: "not found" }, 404)
          }
          events.broadcast({ type: "comment.updated", id })
          return json({ ok: true })
        }
        let b: unknown
        try { b = await req.json() } catch { return json({ error: "invalid json" }, 400) }
        const v = validateCommentEdit(b)
        if (!v.ok) return json({ error: v.error }, 400)
        let c
        try {
          c = await store.editComment(id, cid, v.value.body)
        } catch {
          return json({ error: "not found" }, 404)
        }
        events.broadcast({ type: "comment.updated", id })
        return json(c)
      }

      const verdictMatch = path.match(/^\/api\/artifacts\/([^/]+)\/verdict$/)
      if (verdictMatch && req.method === "POST") {
        const id = verdictMatch[1]
        if (!safeId(id)) return json({ error: "not found" }, 404)
        const va = await store.get(id)
        // Unknown artifact: reject explicitly rather than silently "succeeding"
        // (broadcasting an update for a phantom id).
        if (!va) return json({ error: "not found" }, 404)
        if (va.status === "approved" || va.type === "report") {
          return json({ error: "read-only artifact" }, 409)
        }
        // A draft has no agent awaiting a verdict; it must be submitted first.
        if (va.status === "draft") {
          return json({ error: "draft not submitted for review" }, 409)
        }
        let b: unknown
        try { b = await req.json() } catch { return json({ error: "invalid json" }, 400) }
        const v = validateVerdictInput(b)
        if (!v.ok) return json({ error: v.error }, 400)
        // Carry the reviewer's unresolved comments to the agent for ALL
        // verdicts — an approval with comments means "proceed, but honor these".
        const comments = (await store.getComments(id)).filter((c) => !c.resolved)
        await store.resolveVerdict(
          id,
          v.value.status === "approved"
            ? { status: "approved", comments }
            : v.value.status === "declined"
              ? { status: "declined", reason: v.value.reason, comments }
              : { status: "changes_requested", comments },
        )
        // Declining rejects the work outright: interrupt the agent's parked turn
        // so it stops instead of waiting on (or acting on) the resolved tool call.
        if (v.value.status === "declined" && va.sessionID) opts.interruptSession?.(va.sessionID)
        events.broadcast({ type: "artifact.updated", id })
        // Approve/changes_requested/decline all change what the session's
        // gate looks like (getActivePlan's result), so let the companion
        // know to refetch it.
        if (va.sessionID) events.broadcast({ type: "session.gate", sessionID: va.sessionID })
        return json({ ok: true })
      }

      const archiveMatch = path.match(/^\/api\/artifacts\/([^/]+)\/archive$/)
      if (archiveMatch && req.method === "POST") {
        const id = archiveMatch[1]
        if (!safeId(id)) return json({ error: "not found" }, 404)
        let b: unknown
        try { b = await req.json() } catch { return json({ error: "invalid json" }, 400) }
        const v = validateArchiveInput(b)
        if (!v.ok) return json({ error: v.error }, 400)
        try {
          await store.setArchived(id, v.value.archived)
        } catch {
          return json({ error: "unknown artifact" }, 404)
        }
        events.broadcast({ type: "artifact.archived", id })
        return json({ ok: true })
      }

      // A session isn't a stored entity (no session registry exists — only
      // artifact.sessionID groupings), so there's no existence check here:
      // any sessionID is valid, including one with zero artifacts published
      // yet (force-opening the gate before any plan exists is supported).
      const gateMatch = path.match(/^\/api\/sessions\/([^/]+)\/gate$/)
      if (gateMatch && req.method === "GET") {
        const sessionID = gateMatch[1]
        return json(describeGate(store.getActivePlan(sessionID), store.isGateForced(sessionID)))
      }
      if (gateMatch && req.method === "POST") {
        const sessionID = gateMatch[1]
        let b: unknown
        try { b = await req.json() } catch { return json({ error: "invalid json" }, 400) }
        const v = validateGateInput(b)
        if (!v.ok) return json({ error: v.error }, 400)
        store.setGateForced(sessionID, v.value.forced)
        events.broadcast({ type: "session.gate", sessionID })
        return json(describeGate(store.getActivePlan(sessionID), store.isGateForced(sessionID)))
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
        // Containment: never serve a path that resolves outside staticDir. URL
        // normalization already collapses `/../`, but enforce it explicitly so
        // safety doesn't depend on parser behavior (defense in depth).
        const rootDir = resolve(staticDir)
        const resolved = resolve(file)
        const contained = resolved === rootDir || resolved.startsWith(rootDir + sep)
        if (contained && existsSync(file)) return new Response(Bun.file(file))
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
