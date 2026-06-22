import { test, expect } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import ArtifactsPlugin from "./index"

test("plugin initializes, exposes publish_artifact tool, and disposes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "proj-"))
  const toasts: any[] = []
  const fakeClient = {
    tui: { showToast: async (a: any) => { toasts.push(a) } },
    session: { prompt: async () => {} },
  }
  const hooks = await ArtifactsPlugin({
    directory: dir,
    worktree: dir,
    client: fakeClient as any,
    $: (() => {}) as any,
    project: {} as any,
    experimental_workspace: { register: () => {} } as any,
    serverUrl: new URL("http://localhost:8080") as any,
  })
  expect(hooks.tool?.publish_artifact).toBeDefined()
  await hooks.dispose?.()
})
