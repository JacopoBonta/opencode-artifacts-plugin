import { test, expect } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createStore } from "./store"
import { createBroadcaster } from "./events"
import { createPublishTool } from "./tools"
import { gateState } from "./workflow"

const ROADMAP = `# R
## Context
big multi-part change
## Goals
- ship it all
## Phases
1. phase one
2. phase two
## Status
not started`

const PHASE = `# Phase
## Context
why
## Goals
- g
## Approach
a
## Tasks
- [ ] t
## Verification
v
## Status
todo`

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "decomp-"))
  const store = createStore({
    root: dir,
    // monotonic clock so artifacts get increasing createdAt (mirrors Date.now);
    // getActivePlan picks the latest plan by createdAt.
    clock: (() => { let t = 0; return () => ++t })(),
    idgen: (() => { let n = 0; return () => `id${++n}` })(),
  })
  const tool = createPublishTool({
    store, events: createBroadcaster(), url: "http://localhost:9999", notify: () => {},
  })
  return { store, tool }
}

/** Poll until the store has a pending verdict waiter for `id`. */
async function waitPending(store: ReturnType<typeof createStore>, id: string, ms = 2000) {
  const deadline = Date.now() + ms
  while (!store.hasPending(id)) {
    if (Date.now() > deadline) throw new Error(`timed out waiting on ${id}`)
    await new Promise((r) => setTimeout(r, 5))
  }
}

/** Publish a (blocking) plan and resolve it as approved; returns the tool result. */
async function publishAndApprove(
  store: ReturnType<typeof createStore>,
  tool: ReturnType<typeof createPublishTool>,
  args: Record<string, unknown>,
  id: string,
) {
  const exec = tool.execute(args as any, { sessionID: "s1" } as any)
  await waitPending(store, id)
  await store.resolveVerdict(id, { status: "approved" })
  return JSON.parse((await exec) as string)
}

// The gate the plugin enforces is `gateState(store.getActivePlan(sessionID))`.
const gate = (store: ReturnType<typeof createStore>) =>
  gateState(store.getActivePlan("s1"))

test("full roadmap -> phase -> report decomposition drives the gate correctly", async () => {
  const { store, tool } = setup()

  // 0. Nothing published yet → edits blocked.
  expect(gate(store)).toBe("closed")

  // 1. Roadmap approved → still blocked (decomposition agreed, not "go edit").
  await publishAndApprove(store, tool, { type: "plan", title: "R", content: ROADMAP, roadmap: true }, "id1")
  expect(store.getActivePlan("s1")!.isRoadmap).toBe(true)
  expect(gate(store)).toBe("closed")

  // 2. Phase 1 plan (child of the roadmap) approved → edits UNBLOCKED.
  await publishAndApprove(
    store, tool,
    { type: "plan", title: "Phase 1", content: PHASE, parentId: "id1" }, "id2",
  )
  expect(store.getActivePlan("s1")!.parentId).toBe("id1")
  expect(gate(store)).toBe("open")

  // 3. Phase 1 results report (non-blocking) → gate stays open, report linked.
  await tool.execute(
    { type: "report", title: "Phase 1 results", content: "done", parentId: "id1" } as any,
    { sessionID: "s1" } as any,
  )
  expect(gate(store)).toBe("open")

  // 4. Phase 2 plan published but NOT yet approved → gate re-arms (blocked).
  const exec = tool.execute(
    { type: "plan", title: "Phase 2", content: PHASE, parentId: "id1" } as any,
    { sessionID: "s1" } as any,
  )
  await waitPending(store, "id4")
  expect(gate(store)).toBe("closed")

  // 5. Approve phase 2 → unblocked again.
  await store.resolveVerdict("id4", { status: "approved" })
  await exec
  expect(gate(store)).toBe("open")

  // The roadmap owns all three phase artifacts (2 plans + 1 report).
  const children = store.getChildren("id1")
  expect(children.map((c) => c.id)).toEqual(["id2", "id3", "id4"])
  expect(children.filter((c) => c.type === "plan")).toHaveLength(2)
})

test("scratch-upfront variant: drafts created first, then submitted per phase", async () => {
  const { store, tool } = setup()
  const phase = (title: string, id: string) =>
    tool.execute(
      { type: "plan", title, content: PHASE, parentId: "id1", draft: true } as any,
      { sessionID: "s1" } as any,
    ).then((o) => JSON.parse(o as string))

  // 1. Roadmap approved → blocked.
  await publishAndApprove(store, tool, { type: "plan", title: "R", content: ROADMAP, roadmap: true }, "id1")
  expect(gate(store)).toBe("closed")

  // 2. Scratch BOTH phases as drafts upfront (non-blocking) → still blocked,
  //    and neither draft is ever the active plan.
  const d1 = await phase("Phase 1", "id2")
  const d2 = await phase("Phase 2", "id3")
  expect(d1.status).toBe("draft")
  expect(d2.status).toBe("draft")
  expect(store.getChildren("id1").map((c) => c.id)).toEqual(["id2", "id3"])
  expect(gate(store)).toBe("closed")
  expect(store.getActivePlan("s1")!.id).toBe("id1") // roadmap, not a draft

  // 3. Submit phase 1 (re-publish its draft WITHOUT draft) → blocks → approve → open.
  const submit = tool.execute(
    { type: "plan", title: "Phase 1", content: PHASE, artifactId: "id2" } as any,
    { sessionID: "s1" } as any,
  )
  await waitPending(store, "id2")
  expect(gate(store)).toBe("closed")
  await store.resolveVerdict("id2", { status: "approved" })
  await submit
  expect(gate(store)).toBe("open")
  expect(store.getActivePlan("s1")!.id).toBe("id2")
})
