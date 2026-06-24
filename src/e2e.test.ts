import { test, expect, afterEach } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createStore } from "./store"
import { createBroadcaster } from "./events"
import { createServer } from "./server"
import { createPublishTool } from "./tools"

let stop: (() => void) | null = null
afterEach(() => { stop?.(); stop = null })

test("plan: publish blocks, browser comments + approves, tool resolves approved", async () => {
  const dir = mkdtempSync(join(tmpdir(), "e2e-"))
  const store = createStore({ root: dir, clock: () => 1, idgen: (() => { let n = 0; return () => `id${++n}` })() })
  const events = createBroadcaster()
  const srv = createServer({ store, events, port: 0, staticDir: null })
  stop = srv.stop
  const tool = createPublishTool({ store, events, url: srv.url, notify: () => {} })

  const exec = tool.execute(
    {
      type: "plan",
      title: "P",
      content:
        "# Plan\n## Context\nwhy\n## Goals\n- g\n## Approach\na\n## Tasks\n- [ ] step one\n## Verification\nv\n## Status\ntodo",
    },
    { sessionID: "s1" } as any,
  )

  // browser: wait for the artifact to exist, comment on it, then approve
  let id = ""
  for (let i = 0; i < 50 && !id; i++) {
    const list = await (await fetch(`${srv.url}/api/artifacts`)).json()
    if (list.length) id = list[0].id
    else await new Promise((r) => setTimeout(r, 5))
  }
  expect(id).toBe("id1")

  await fetch(`${srv.url}/api/artifacts/${id}/comments`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ revision: 1, kind: "general", body: "looks good" }),
  })
  await fetch(`${srv.url}/api/artifacts/${id}/verdict`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: "approved" }),
  })

  const result = JSON.parse(await exec as string)
  expect(result.status).toBe("approved")
  // the reviewer's comment rides along with the approval
  expect(result.comments.map((c: any) => c.body)).toContain("looks good")
  expect((await store.get(id))!.status).toBe("approved")
})
