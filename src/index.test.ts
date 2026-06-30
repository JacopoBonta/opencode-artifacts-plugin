import { test, expect } from "bun:test"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import ArtifactsPlugin from "./index"
import type { Artifact } from "./types"

const fakeClient = {
  tui: { showToast: async () => {} },
  session: { prompt: async () => {} },
} as any

function init(dir: string) {
  return ArtifactsPlugin({
    directory: dir,
    worktree: dir,
    client: fakeClient,
    $: (() => {}) as any,
    project: {} as any,
    experimental_workspace: { register: () => {} } as any,
    serverUrl: new URL("http://localhost:8080") as any,
  })
}

/** Pre-seed an artifact on disk so the plugin's store loads it on init. */
function seedArtifact(dir: string, a: Artifact, content: string) {
  const base = join(dir, ".opencode", "artifacts", a.id)
  mkdirSync(join(base, "revisions"), { recursive: true })
  writeFileSync(join(base, "meta.json"), JSON.stringify(a))
  writeFileSync(join(base, "comments.json"), "[]")
  writeFileSync(join(base, "revisions", "001.md"), content)
}

const PLAN: Omit<Artifact, "status"> = {
  id: "p1", type: "plan", title: "P",
  currentRevision: 1, createdAt: 1, updatedAt: 1, sessionID: "s1",
}

test("plugin initializes, exposes tool + workflow hooks, and disposes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "proj-"))
  const hooks = await init(dir)
  expect(hooks.tool?.publish_artifact).toBeDefined()
  expect(hooks["tool.execute.before"]).toBeDefined()
  expect(hooks["chat.message"]).toBeDefined()
  expect(hooks.event).toBeDefined()
  expect(hooks["experimental.chat.system.transform"]).toBeDefined()
  expect(hooks["experimental.session.compacting"]).toBeDefined()
  await hooks.dispose?.()
})

test("chat.message tracks the active session (idempotent, no throw on repeat/empty)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "proj-"))
  const hooks = await init(dir)
  const onMessage = hooks["chat.message"]!
  // First message sets the active session; a repeat of the same id is a no-op;
  // switching sessions updates it; an empty id is ignored. None should throw.
  await onMessage({ sessionID: "s1" } as any, {} as any)
  await onMessage({ sessionID: "s1" } as any, {} as any)
  await onMessage({ sessionID: "s2" } as any, {} as any)
  await onMessage({ sessionID: "" } as any, {} as any)
  await hooks.dispose?.()
})

test("event hook handles reasoning parts and idle (and ignores others) without throwing", async () => {
  const dir = mkdtempSync(join(tmpdir(), "proj-"))
  const hooks = await init(dir)
  const onEvent = hooks.event!
  // A reasoning part drives the "Thinking…" status; session.idle clears it.
  await onEvent({
    event: { type: "message.part.updated", properties: { part: { type: "reasoning", sessionID: "s1" } } },
  } as any)
  await onEvent({ event: { type: "session.idle", properties: { sessionID: "s1" } } } as any)
  // Unrelated events (a text part, an arbitrary event) are no-ops, not errors.
  await onEvent({
    event: { type: "message.part.updated", properties: { part: { type: "text", sessionID: "s1" } } },
  } as any)
  await onEvent({ event: { type: "message.updated", properties: { info: {} } } } as any)
  await hooks.dispose?.()
})

test("gate blocks a mutating tool when the session has no approved plan", async () => {
  const dir = mkdtempSync(join(tmpdir(), "proj-"))
  const hooks = await init(dir)
  const call = hooks["tool.execute.before"]!(
    { tool: "edit", sessionID: "s1", callID: "c1" } as any,
    { args: {} } as any,
  )
  await expect(call).rejects.toThrow(/Workflow gate/)
  await hooks.dispose?.()
})

test("gate never blocks publish_artifact or read-only tools", async () => {
  const dir = mkdtempSync(join(tmpdir(), "proj-"))
  const hooks = await init(dir)
  const before = hooks["tool.execute.before"]!
  await before({ tool: "publish_artifact", sessionID: "s1", callID: "c1" } as any, { args: {} } as any)
  await before({ tool: "read", sessionID: "s1", callID: "c2" } as any, { args: {} } as any)
  await before({ tool: "bash", sessionID: "s1", callID: "c3" } as any, { args: { command: "ls" } } as any)
  // no throw => pass
  await hooks.dispose?.()
})

test("gate allows mutating tools once the session's plan is approved", async () => {
  const dir = mkdtempSync(join(tmpdir(), "proj-"))
  seedArtifact(dir, { ...PLAN, status: "approved" }, "# P\n## Context\nc")
  const hooks = await init(dir)
  await hooks["tool.execute.before"]!(
    { tool: "edit", sessionID: "s1", callID: "c1" } as any,
    { args: {} } as any,
  )
  // a different session is still gated
  await expect(
    hooks["tool.execute.before"]!(
      { tool: "edit", sessionID: "s2", callID: "c2" } as any,
      { args: {} } as any,
    ),
  ).rejects.toThrow(/Workflow gate/)
  await hooks.dispose?.()
})

test("gate blocks after a report completed the plan, with a 'completed by a report' reason", async () => {
  const dir = mkdtempSync(join(tmpdir(), "proj-"))
  // A plan that was approved then completed by a report → gate re-closed.
  seedArtifact(dir, { ...PLAN, status: "approved", completed: true }, "# P\n## Context\nc")
  const hooks = await init(dir)
  const call = hooks["tool.execute.before"]!(
    { tool: "edit", sessionID: "s1", callID: "c1" } as any,
    { args: {} } as any,
  )
  await expect(call).rejects.toThrow(/completed by a report/)
  await hooks.dispose?.()
})

test("system.transform injects the contract and the active plan content", async () => {
  const dir = mkdtempSync(join(tmpdir(), "proj-"))
  seedArtifact(dir, { ...PLAN, status: "approved" }, "PLAN-BODY-MARKER")
  const hooks = await init(dir)
  const output = { system: [] as string[] }
  await hooks["experimental.chat.system.transform"]!({ sessionID: "s1" } as any, output as any)
  const joined = output.system.join("\n")
  expect(joined).toContain("Artifact workflow")
  expect(joined).toContain("PLAN-BODY-MARKER")
  await hooks.dispose?.()
})

test("an approved roadmap does not unblock edits", async () => {
  const dir = mkdtempSync(join(tmpdir(), "proj-"))
  seedArtifact(dir, { ...PLAN, status: "approved", isRoadmap: true }, "# R\n## Phases\n1. a")
  const hooks = await init(dir)
  await expect(
    hooks["tool.execute.before"]!(
      { tool: "edit", sessionID: "s1", callID: "c1" } as any,
      { args: {} } as any,
    ),
  ).rejects.toThrow(/Workflow gate/)
  await hooks.dispose?.()
})

test("an approved phase plan unblocks edits and injects its parent roadmap", async () => {
  const dir = mkdtempSync(join(tmpdir(), "proj-"))
  // roadmap (older) + an approved phase plan (more recently updated => active)
  seedArtifact(dir, { ...PLAN, id: "road1", status: "approved", isRoadmap: true, createdAt: 1, updatedAt: 1 }, "ROADMAP-MARKER")
  seedArtifact(
    dir,
    { ...PLAN, id: "phase1", status: "approved", parentId: "road1", createdAt: 2, updatedAt: 2 },
    "PHASE-MARKER",
  )
  const hooks = await init(dir)
  // gate is open (active plan = approved non-roadmap phase plan)
  await hooks["tool.execute.before"]!(
    { tool: "edit", sessionID: "s1", callID: "c1" } as any,
    { args: {} } as any,
  )
  const output = { system: [] as string[] }
  await hooks["experimental.chat.system.transform"]!({ sessionID: "s1" } as any, output as any)
  const joined = output.system.join("\n")
  expect(joined).toContain("PHASE-MARKER")
  expect(joined).toContain("ROADMAP-MARKER")
  expect(joined).toContain("Parent roadmap")
  await hooks.dispose?.()
})

test("scratched phase drafts do not unblock edits and are listed under the roadmap", async () => {
  const dir = mkdtempSync(join(tmpdir(), "proj-"))
  // approved roadmap + two scratched phase drafts (no phase submitted yet)
  seedArtifact(dir, { ...PLAN, id: "road1", status: "approved", isRoadmap: true, createdAt: 1, updatedAt: 1 }, "ROADMAP-MARKER")
  seedArtifact(dir, { ...PLAN, id: "phase1", status: "draft", parentId: "road1", title: "Phase 1", createdAt: 2, updatedAt: 2 }, "P1")
  seedArtifact(dir, { ...PLAN, id: "phase2", status: "draft", parentId: "road1", title: "Phase 2", createdAt: 3, updatedAt: 3 }, "P2")
  const hooks = await init(dir)
  // active plan is the roadmap (drafts excluded) → edits stay blocked
  await expect(
    hooks["tool.execute.before"]!(
      { tool: "edit", sessionID: "s1", callID: "c1" } as any,
      { args: {} } as any,
    ),
  ).rejects.toThrow(/Workflow gate/)
  // the injected context lists the scratched phases so they survive compaction
  const output = { system: [] as string[] }
  await hooks["experimental.chat.system.transform"]!({ sessionID: "s1" } as any, output as any)
  const joined = output.system.join("\n")
  expect(joined).toContain("phase1 [plan/draft] — Phase 1")
  expect(joined).toContain("phase2 [plan/draft] — Phase 2")
  await hooks.dispose?.()
})

test("session.compacting preserves the active plan content", async () => {
  const dir = mkdtempSync(join(tmpdir(), "proj-"))
  seedArtifact(dir, { ...PLAN, status: "approved" }, "PLAN-BODY-MARKER")
  const hooks = await init(dir)
  const output = { context: [] as string[] }
  await hooks["experimental.session.compacting"]!({ sessionID: "s1" } as any, output as any)
  expect(output.context.join("\n")).toContain("PLAN-BODY-MARKER")
  await hooks.dispose?.()
})
