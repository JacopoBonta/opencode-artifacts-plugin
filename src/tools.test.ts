import { test, expect } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createStore } from "./store"
import { createBroadcaster } from "./events"
import { createPublishTool } from "./tools"

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "artifacts-"))
  const store = createStore({ root: dir, clock: () => 1, idgen: (() => { let n = 0; return () => `id${++n}` })() })
  const events = createBroadcaster()
  const notes: string[] = []
  const tool = createPublishTool({
    store, events, url: "http://localhost:9999",
    notify: (m) => notes.push(m),
  })
  return { store, tool, notes }
}

test("report publish returns immediately with id + url", async () => {
  const { tool } = setup()
  const out = await tool.execute(
    { type: "report", title: "R", content: "done" },
    { sessionID: "s1" } as any,
  )
  const parsed = JSON.parse(out as string)
  expect(parsed.artifactId).toBe("id1")
  expect(parsed.url).toContain("/artifacts/id1")
})

/** Poll until the store has a pending verdict waiter for `id`, then proceed. */
async function waitPending(store: ReturnType<typeof createStore>, id: string, ms = 2000) {
  const deadline = Date.now() + ms
  while (!store.hasPending(id)) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for pending verdict on ${id}`)
    await new Promise((r) => setTimeout(r, 5))
  }
}

test("plan publish blocks until verdict, returns approved", async () => {
  const { tool, store } = setup()
  const exec = tool.execute(
    { type: "plan", title: "P", content: "x" },
    { sessionID: "s1" } as any,
  )
  await waitPending(store, "id1")
  await store.resolveVerdict("id1", { status: "approved" })
  const parsed = JSON.parse(await exec as string)
  expect(parsed.status).toBe("approved")
})

test("plan publish returns changes_requested with comment bodies", async () => {
  const { tool, store } = setup()
  const exec = tool.execute(
    { type: "plan", title: "P", content: "x" },
    { sessionID: "s1" } as any,
  )
  await waitPending(store, "id1")
  await store.addComment("id1", { revision: 1, kind: "general", body: "redo intro" })
  await store.resolveVerdict("id1", {
    status: "changes_requested",
    comments: await store.getComments("id1"),
  })
  const parsed = JSON.parse(await exec as string)
  expect(parsed.status).toBe("changes_requested")
  expect(parsed.comments[0].body).toBe("redo intro")
})
