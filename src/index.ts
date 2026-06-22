import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { existsSync } from "node:fs"
import type { Plugin } from "@opencode-ai/plugin"
import type { Event } from "@opencode-ai/sdk"
import { createStore } from "./store"
import { createBroadcaster } from "./events"
import { createServer } from "./server"
import { createPublishTool } from "./tools"

const here = dirname(fileURLToPath(import.meta.url))

const ArtifactsPlugin: Plugin = async ({ directory, client }) => {
  const store = createStore({ root: join(directory, ".opencode", "artifacts") })
  await store.load()

  const events = createBroadcaster()
  let lastSessionID: string | undefined

  const staticDir = join(here, "..", "companion", "dist")
  const server = createServer({
    store,
    events,
    port: Number(process.env.OPENCODE_ARTIFACTS_PORT ?? 0),
    staticDir: existsSync(staticDir) ? staticDir : null,
    onRefine: async (id, comments) => {
      const artifact = await store.get(id)
      const sid = artifact?.sessionID ?? lastSessionID
      const summary = comments
        .map((c) =>
          `- ${c.anchor?.quote ? `(re: "${c.anchor.quote}") ` : ""}${c.body}`,
        )
        .join("\n")
      const text =
        `The user requested refinement of report "${artifact?.title}". Their comments:\n${summary}\nPlease revise and re-publish with artifactId "${id}".`

      try {
        if (sid) {
          await client.session.prompt({
            path: { id: sid },
            body: { parts: [{ type: "text", text }] },
          })
        } else {
          await client.tui.appendPrompt({ body: { text } })
        }
      } catch {
        await (client.tui.appendPrompt?.({ body: { text } }) ?? Promise.resolve()).catch(() => {})
      }
    },
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

  return {
    tool: { publish_artifact: tool },
    event: async ({ event }: { event: Event }) => {
      // Extract sessionID from the many event shapes that carry one.
      // Most events put it directly on properties; session.created/updated/deleted
      // put it on properties.info.id (Session.id).
      const props = (event as any).properties
      if (!props) return
      const sid: string | undefined =
        props.sessionID ??
        props.info?.sessionID ??
        props.info?.id
      if (sid) lastSessionID = sid
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
