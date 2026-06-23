import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { existsSync } from "node:fs"
import type { Plugin } from "@opencode-ai/plugin"
import { createStore } from "./store"
import { createBroadcaster } from "./events"
import { createServer } from "./server"
import { createPublishTool } from "./tools"

const here = dirname(fileURLToPath(import.meta.url))

const ArtifactsPlugin: Plugin = async ({ directory, client }) => {
  const store = createStore({ root: join(directory, ".opencode", "artifacts") })
  await store.load()

  const events = createBroadcaster()

  const staticDir = join(here, "..", "companion", "dist")
  const server = createServer({
    store,
    events,
    port: Number(process.env.OPENCODE_ARTIFACTS_PORT ?? 0),
    staticDir: existsSync(staticDir) ? staticDir : null,
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
