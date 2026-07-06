import { test, expect } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createStore } from "./store"
import { createBroadcaster } from "./events"
import { createPublishTool, createOpenCompanionTool } from "./tools"

const VALID_PLAN = `# P
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

const VALID_ROADMAP = `# R
## Context
why
## Goals
- g
## Phases
1. phase one
## Status
todo`

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "artifacts-"))
  const store = createStore({ root: dir, clock: () => 1, idgen: (() => { let n = 0; return () => `id${++n}` })() })
  const events = createBroadcaster()
  const notes: string[] = []
  const tool = createPublishTool({
    store, events, url: "http://localhost:9999",
    notify: (m) => notes.push(m),
  })
  return { store, tool, notes, events }
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

/** Collects every event broadcast during the subscription's lifetime. */
function collectEvents(events: ReturnType<typeof createBroadcaster>) {
  const seen: any[] = []
  events.subscribe((data) => seen.push(JSON.parse(data)))
  return seen
}

test("publishing a report broadcasts session.gate (it can complete the active plan)", async () => {
  const { tool, events } = setup()
  const seen = collectEvents(events)
  await tool.execute({ type: "report", title: "R", content: "done" }, { sessionID: "s1" } as any)
  expect(seen).toContainEqual({ type: "session.gate", sessionID: "s1" })
})

test("submitting a plan for review broadcasts session.gate", async () => {
  const { tool, events, store } = setup()
  const seen = collectEvents(events)
  const exec = tool.execute({ type: "plan", title: "P", content: VALID_PLAN }, { sessionID: "s1" } as any)
  await waitPending(store, "id1")
  expect(seen).toContainEqual({ type: "session.gate", sessionID: "s1" })
  await store.resolveVerdict("id1", { status: "approved" })
  await exec
})

test("scratching a draft phase plan does NOT broadcast session.gate (drafts never govern the gate)", async () => {
  const { tool, events } = setup()
  const seen = collectEvents(events)
  const out = await tool.execute(
    { type: "plan", title: "P", content: VALID_PLAN, draft: true },
    { sessionID: "s1" } as any,
  )
  expect(JSON.parse(out as string).status).toBe("draft")
  expect(seen.find((e) => e.type === "session.gate")).toBeUndefined()
})

test("a publish with no sessionID never broadcasts session.gate", async () => {
  const { tool, events } = setup()
  const seen = collectEvents(events)
  await tool.execute({ type: "report", title: "R", content: "done" }, {} as any)
  expect(seen.find((e) => e.type === "session.gate")).toBeUndefined()
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
    { type: "plan", title: "P", content: VALID_PLAN },
    { sessionID: "s1" } as any,
  )
  await waitPending(store, "id1")
  await store.resolveVerdict("id1", { status: "approved" })
  const parsed = JSON.parse(await exec as string)
  expect(parsed.status).toBe("approved")
})

test("re-publishing an approved plan is rejected (frozen), leaving it untouched", async () => {
  const { tool, store } = setup()
  // get a plan approved (id1)
  const first = tool.execute(
    { type: "plan", title: "P", content: VALID_PLAN },
    { sessionID: "s1" } as any,
  )
  await waitPending(store, "id1")
  await store.resolveVerdict("id1", { status: "approved" })
  await first

  // re-publish without resubmit → frozen error, no new revision, no pending verdict
  const out = await tool.execute(
    { type: "plan", title: "P", content: VALID_PLAN + "\nprogress!", artifactId: "id1" },
    { sessionID: "s1" } as any,
  )
  const parsed = JSON.parse(out as string)
  expect(parsed.error).toMatch(/frozen/i)
  expect(parsed.status).toBe("approved")
  expect(store.hasPending("id1")).toBe(false)
  const a = (await store.get("id1"))!
  expect(a.status).toBe("approved")
  expect(a.currentRevision).toBe(1) // content was NOT rewritten
})

test("an approved plan can be re-published with resubmit:true for a fresh review", async () => {
  const { tool, store } = setup()
  const first = tool.execute(
    { type: "plan", title: "P", content: VALID_PLAN },
    { sessionID: "s1" } as any,
  )
  await waitPending(store, "id1")
  await store.resolveVerdict("id1", { status: "approved" })
  await first

  // resubmit re-enters review → blocks until a new verdict arrives
  const exec = tool.execute(
    { type: "plan", title: "P", content: VALID_PLAN + "\nnew scope", artifactId: "id1", resubmit: true },
    { sessionID: "s1" } as any,
  )
  await waitPending(store, "id1")
  expect((await store.get("id1"))!.status).toBe("awaiting_review")
  await store.resolveVerdict("id1", { status: "approved" })
  const parsed = JSON.parse(await exec as string)
  expect(parsed.status).toBe("approved")
  expect((await store.get("id1"))!.currentRevision).toBe(2)
})

test("resubmit re-opens review on an approved plan (blocks until verdict)", async () => {
  const { tool, store } = setup()
  const first = tool.execute(
    { type: "plan", title: "P", content: VALID_PLAN },
    { sessionID: "s1" } as any,
  )
  await waitPending(store, "id1")
  await store.resolveVerdict("id1", { status: "approved" })
  await first

  // resubmit → blocks again for a fresh verdict
  const exec = tool.execute(
    { type: "plan", title: "P", content: VALID_PLAN, artifactId: "id1", resubmit: true },
    { sessionID: "s1" } as any,
  )
  await waitPending(store, "id1")
  expect((await store.get("id1"))!.status).toBe("awaiting_review")
  await store.resolveVerdict("id1", { status: "approved" })
  expect(JSON.parse(await exec as string).status).toBe("approved")
})

test("resubmit:true is rejected once a plan is completed by a report — start a fresh plan instead", async () => {
  const { tool, store } = setup()
  const first = tool.execute(
    { type: "plan", title: "P", content: VALID_PLAN },
    { sessionID: "s1" } as any,
  )
  await waitPending(store, "id1")
  await store.resolveVerdict("id1", { status: "approved" })
  await first
  await tool.execute({ type: "report", title: "R", content: "done" }, { sessionID: "s1" } as any)
  expect((await store.get("id1"))!.completed).toBe(true)

  const out = await tool.execute(
    { type: "plan", title: "P", content: VALID_PLAN + "\nnew scope", artifactId: "id1", resubmit: true },
    { sessionID: "s1" } as any,
  )
  const parsed = JSON.parse(out as string)
  expect(parsed.error).toMatch(/completed/i)
  expect(store.hasPending("id1")).toBe(false)
  const a = (await store.get("id1"))!
  expect(a.completed).toBe(true)
  expect(a.currentRevision).toBe(1)
})

test("approved verdict carries the reviewer's comments to the agent", async () => {
  const { tool, store } = setup()
  const exec = tool.execute(
    { type: "plan", title: "P", content: VALID_PLAN },
    { sessionID: "s1" } as any,
  )
  await waitPending(store, "id1")
  await store.addComment("id1", { revision: 1, kind: "general", body: "use the existing util" })
  await store.resolveVerdict("id1", {
    status: "approved",
    comments: await store.getComments("id1"),
  })
  const parsed = JSON.parse(await exec as string)
  expect(parsed.status).toBe("approved")
  expect(parsed.comments[0].body).toBe("use the existing util")
})

test("plan publish returns changes_requested with comment bodies", async () => {
  const { tool, store } = setup()
  const exec = tool.execute(
    { type: "plan", title: "P", content: VALID_PLAN },
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

test("declined verdict returns a terminal stop payload carrying the reason", async () => {
  const { tool, store } = setup()
  const exec = tool.execute(
    { type: "plan", title: "P", content: VALID_PLAN },
    { sessionID: "s1" } as any,
  )
  await waitPending(store, "id1")
  await store.resolveVerdict("id1", { status: "declined", reason: "abandon this" })
  const parsed = JSON.parse(await exec as string)
  expect(parsed.status).toBe("declined")
  expect(parsed.reason).toBe("abandon this")
  expect(parsed.stop).toBeDefined()
})

test("plan missing required sections is rejected and creates no artifact", async () => {
  const { tool, store } = setup()
  const out = await tool.execute(
    { type: "plan", title: "P", content: "# P\njust prose, no sections" },
    { sessionID: "s1" } as any,
  )
  const parsed = JSON.parse(out as string)
  expect(parsed.error).toContain("missing required sections")
  expect(parsed.missingSections).toEqual([
    "Context", "Goals", "Approach", "Tasks", "Verification",
  ])
  expect(await store.list()).toHaveLength(0)
})

test("roadmap plan is validated against the roadmap profile and marked isRoadmap", async () => {
  const { tool, store } = setup()
  // A standard plan body (no Phases) is rejected when roadmap=true.
  const bad = await tool.execute(
    { type: "plan", title: "R", content: VALID_PLAN, roadmap: true },
    { sessionID: "s1" } as any,
  )
  expect(JSON.parse(bad as string).missingSections).toEqual(["Phases"])
  expect(await store.list()).toHaveLength(0)

  // A proper roadmap publishes and is persisted with isRoadmap.
  const exec = tool.execute(
    { type: "plan", title: "R", content: VALID_ROADMAP, roadmap: true },
    { sessionID: "s1" } as any,
  )
  await waitPending(store, "id1")
  await store.resolveVerdict("id1", { status: "approved" })
  await exec
  expect((await store.get("id1"))!.isRoadmap).toBe(true)
})

test("a draft plan publishes non-blocking and returns status 'draft'", async () => {
  const { tool, store } = setup()
  // Does not block on a verdict — resolves immediately.
  const out = await tool.execute(
    { type: "plan", title: "Phase 1", content: VALID_PLAN, parentId: "road1", draft: true },
    { sessionID: "s1" } as any,
  )
  const parsed = JSON.parse(out as string)
  expect(parsed.status).toBe("draft")
  expect((await store.get(parsed.artifactId))!.status).toBe("draft")
  expect((await store.get(parsed.artifactId))!.parentId).toBe("road1")
})

test("a draft is still validated strictly for required sections", async () => {
  const { tool, store } = setup()
  const out = await tool.execute(
    { type: "plan", title: "P", content: "# P\nrough", draft: true },
    { sessionID: "s1" } as any,
  )
  expect(JSON.parse(out as string).missingSections).toContain("Tasks")
  expect(await store.list()).toHaveLength(0)
})

test("a phase plan carries its parentId through to the store", async () => {
  const { tool, store } = setup()
  await tool.execute(
    { type: "plan", title: "phase 1", content: VALID_PLAN, parentId: "road1", draft: true },
    { sessionID: "s1" } as any,
  )
  expect((await store.get("id1"))!.parentId).toBe("road1")
})

test("a report ignores a caller-passed parentId (it is derived from the active plan)", async () => {
  const { tool, store } = setup()
  // No active plan in this session, so the report stays loose (general report)
  // even though a parentId was supplied — the tool does not plumb it for reports.
  await tool.execute(
    { type: "report", title: "research", content: "findings", parentId: "road1" },
    { sessionID: "s1" } as any,
  )
  expect((await store.get("id1"))!.parentId).toBeUndefined()
})

test("the creating agent name is persisted on the artifact", async () => {
  const { tool, store } = setup()
  await tool.execute(
    { type: "report", title: "R", content: "done" },
    { sessionID: "s1", agent: "build" } as any,
  )
  expect((await store.get("id1"))!.agent).toBe("build")
})

test("open_companion opens the browser at the URL with the token and returns it", async () => {
  const opened: string[] = []
  const tool = createOpenCompanionTool({
    url: "http://localhost:9999",
    token: "secret",
    openBrowser: (url) => {
      opened.push(url)
    },
  })
  const out = await tool.execute({}, {} as any)
  expect(opened).toEqual(["http://localhost:9999/?token=secret"])
  expect(JSON.parse(out as string)).toEqual({ url: "http://localhost:9999/?token=secret" })
})

test("open_companion omits the token query when no token is configured", async () => {
  const opened: string[] = []
  const tool = createOpenCompanionTool({
    url: "http://localhost:9999",
    openBrowser: (url) => {
      opened.push(url)
    },
  })
  await tool.execute({}, {} as any)
  expect(opened).toEqual(["http://localhost:9999"])
})
