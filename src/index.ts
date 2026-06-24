import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { existsSync } from "node:fs"
import type { Plugin } from "@opencode-ai/plugin"
import { createStore } from "./store"
import { createBroadcaster } from "./events"
import { createServer } from "./server"
import { createPublishTool } from "./tools"
import {
  isMutatingCall,
  gateState,
  buildWorkflowContract,
  buildSessionContext,
  buildRoadmapContext,
} from "./workflow"

const here = dirname(fileURLToPath(import.meta.url))

const ArtifactsPlugin: Plugin = async ({ directory, client }) => {
  const store = createStore({ root: join(directory, ".opencode", "artifacts") })
  await store.load()

  const events = createBroadcaster()

  const sessionTitleCache = new Map<string, string | undefined>()
  async function resolveSessionTitle(sessionID: string): Promise<string | undefined> {
    if (sessionTitleCache.has(sessionID)) return sessionTitleCache.get(sessionID)
    let title: string | undefined
    try {
      const res = (await client.session.get({ path: { id: sessionID } })) as any
      title = res?.data?.title ?? res?.title
    } catch {
      title = undefined
    }
    sessionTitleCache.set(sessionID, title)
    return title
  }

  // The opencode session the user is currently in, surfaced to the companion so
  // it can highlight that session's group. Updated from the chat.message hook.
  let currentSessionID: string | undefined

  const staticDir = join(here, "..", "companion", "dist")
  const server = createServer({
    store,
    events,
    port: Number(process.env.OPENCODE_ARTIFACTS_PORT ?? 0),
    staticDir: existsSync(staticDir) ? staticDir : null,
    resolveSessionTitle,
    getActiveSession: () => currentSessionID,
  })

  let opened = false
  const tool = createPublishTool({
    store,
    events,
    url: server.url,
    notify: (message) => {
      const p = client.tui.showToast({ body: { message, variant: "info" } })
      // showToast returns a RequestResult which may or may not be a real Promise
      // in tests; guard with optional chaining
      if (p && typeof (p as any).catch === "function") {
        ;(p as any).catch(() => {})
      }
      if (!opened) {
        opened = true
        openBrowser(server.url).catch(() => {})
      }
    },
  })

  // Build the live-plan context block(s) for a session: the active plan, plus
  // the parent roadmap (with phase progress) when the active plan is a phase.
  // Shared by system.transform and the compaction hook.
  async function planContextBlocks(sessionID: string): Promise<string[]> {
    const blocks: string[] = []
    // The active (non-roadmap) plan governing the gate, if any.
    const plan = store.getActivePlan(sessionID)
    if (plan) {
      try {
        const content = await store.readRevision(plan.id, plan.currentRevision)
        blocks.push(buildSessionContext(plan, content))
      } catch {
        // active plan content unreadable — fall through to the roadmap block
      }
    }
    // Inject the roadmap (with its phase list) independently of gate state: when
    // the active plan is a phase, OR when only a roadmap exists yet (no phase
    // submitted). A standalone plan (no parent, no roadmap) gets no roadmap block.
    const roadmap =
      plan?.parentId ? await store.get(plan.parentId) : plan ? undefined : store.getRoadmap(sessionID)
    if (roadmap) {
      try {
        const rmContent = await store.readRevision(roadmap.id, roadmap.currentRevision)
        blocks.push(buildRoadmapContext(roadmap, rmContent, store.getChildren(roadmap.id)))
      } catch {
        // roadmap content unreadable — the active plan block still stands
      }
    }
    return blocks
  }

  return {
    tool: { publish_artifact: tool },

    // Track the session the user is actively in: a received user message is the
    // clearest "current session" signal. Broadcast changes so the companion can
    // move the highlight in real time.
    "chat.message": async (input) => {
      if (input.sessionID && input.sessionID !== currentSessionID) {
        currentSessionID = input.sessionID
        events.broadcast({ type: "session.active", sessionID: currentSessionID })
      }
    },

    // Hard gate: block file-mutating tools until the session has an approved
    // plan. publish_artifact and read-only/exploration calls are never gated.
    "tool.execute.before": async (input, output) => {
      if (input.tool === "publish_artifact") return
      if (!isMutatingCall(input.tool, output.args)) return
      const plan = store.getActivePlan(input.sessionID)
      if (gateState(plan) === "open") return
      const roadmap = store.getRoadmap(input.sessionID)
      let reason: string
      if (plan) {
        reason = `the active plan "${plan.title}" is ${plan.status}`
      } else if (roadmap) {
        // A roadmap is approved but no phase plan is yet approved/active.
        reason =
          `the roadmap "${roadmap.title}" is approved but no phase plan is yet ` +
          `approved — approving a roadmap does NOT unblock edits`
      } else {
        reason = "no plan has been published"
      }
      throw new Error(
        `Workflow gate: file edits are blocked because ${reason}. Publish a plan ` +
          `(or, for a roadmap, the next phase plan) with publish_artifact(type:"plan", ...) ` +
          `and get it approved in the companion before editing. On changes_requested, ` +
          `revise the same artifactId and re-publish until approved. Note: git add/commit/push ` +
          `and read-only commands are not gated.`,
      )
    },

    // Inject the workflow contract + the live plan every turn. Re-injecting the
    // plan each inference is what keeps it tracked across context compaction.
    "experimental.chat.system.transform": async (input, output) => {
      output.system.push(buildWorkflowContract())
      if (!input.sessionID) return
      output.system.push(...(await planContextBlocks(input.sessionID)))
    },

    // Belt-and-suspenders: preserve the active plan + roadmap into the compacted
    // context.
    "experimental.session.compacting": async (input, output) => {
      output.context.push(...(await planContextBlocks(input.sessionID)))
    },

    dispose: async () => {
      store.disposeAll()
      server.stop()
    },
  }
}

async function openBrowser(url: string): Promise<void> {
  const cmd =
    process.platform === "darwin"
      ? ["open", url]
      : process.platform === "win32"
        ? ["cmd", "/c", "start", "", url]
        : ["xdg-open", url]
  Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" })
}

export default ArtifactsPlugin
