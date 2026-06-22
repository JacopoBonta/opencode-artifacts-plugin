import { tool } from "@opencode-ai/plugin"
import type { Store } from "./store"
import type { Broadcaster } from "./events"

export interface ToolDeps {
  store: Store
  events: Broadcaster
  url: string
  /** show a toast / open the browser; injected so tests stay headless */
  notify: (message: string, artifactUrl?: string) => void
}

export function createPublishTool(deps: ToolDeps) {
  const { store, events, url, notify } = deps

  return tool({
    description:
      "Publish an artifact for human review in the browser companion. " +
      "type='plan' BLOCKS: this tool call does not return until the user approves " +
      "or requests changes — do not issue any other tool call while waiting. It " +
      "returns their verdict; on changes_requested, revise and re-publish with the " +
      "same artifactId to add a revision, looping until approved. type='report' " +
      "returns immediately. Content is markdown.",
    args: {
      type: tool.schema.enum(["plan", "report"]).describe("plan gates the work; report is informational"),
      title: tool.schema.string().describe("short artifact title"),
      content: tool.schema.string().describe("artifact body in markdown"),
      artifactId: tool.schema
        .string()
        .optional()
        .describe("omit to create new; pass to add a revision to an existing artifact"),
    },
    async execute(args, context) {
      const sessionID = context.sessionID
      const { artifact } = await store.publish({
        type: args.type,
        title: args.title,
        content: args.content,
        artifactId: args.artifactId,
        sessionID,
      })
      const artifactUrl = `${url}/artifacts/${artifact.id}`
      events.broadcast({ type: "artifact.published", id: artifact.id })

      if (args.type === "report") {
        notify(`Report published: ${artifact.title}`, artifactUrl)
        return JSON.stringify({ artifactId: artifact.id, url: artifactUrl })
      }

      notify(`Plan awaiting review: ${artifact.title}`, artifactUrl)
      const verdict = await store.awaitVerdict(artifact.id)
      if (verdict.status === "approved") {
        return JSON.stringify({ status: "approved", artifactId: artifact.id })
      }
      return JSON.stringify({
        status: "changes_requested",
        artifactId: artifact.id,
        comments: verdict.comments.map((c) => ({
          body: c.body,
          kind: c.kind,
          quote: c.anchor?.quote,
        })),
      })
    },
  })
}
