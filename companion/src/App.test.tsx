import { test, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, waitFor, act, fireEvent, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import * as api from "./api"
import { App } from "./App"

let emit: ((e: any) => void) | undefined

beforeEach(() => {
  localStorage.clear() // tabs persist to localStorage; isolate each test
  emit = undefined
  vi.spyOn(api, "subscribeEvents").mockImplementation((cb) => { emit = cb; return () => {} })
  vi.spyOn(api, "listArtifacts").mockResolvedValue([
    { id: "id1", type: "plan", title: "P", status: "awaiting_review", currentRevision: 1, createdAt: 0, updatedAt: 0 },
  ])
  vi.spyOn(api, "getArtifact").mockResolvedValue({
    artifact: { id: "id1", type: "plan", title: "P", status: "awaiting_review", currentRevision: 1, createdAt: 0, updatedAt: 0 },
    content: "# Plan\n\nstep one", comments: [],
  })
  vi.spyOn(api, "getRevision").mockResolvedValue({ content: "" })
})

afterEach(() => vi.restoreAllMocks())

/** Open an artifact via the command palette (works regardless of session focus). */
async function openViaPalette(query: string) {
  fireEvent.keyDown(document.body, { key: "k", metaKey: true })
  const input = await screen.findByPlaceholderText("Go to artifact…")
  await userEvent.clear(input)
  await userEvent.type(input, query)
  fireEvent.keyDown(input, { key: "Enter" })
}

/** Push the live opencode session over the (captured) SSE stream. */
async function focusSession(sessionID: string) {
  await waitFor(() => expect(emit).toBeTypeOf("function"))
  act(() => emit!({ type: "session.active", sessionID }))
}

test("nothing is open on load: the shortcut cheatsheet shows", async () => {
  render(<App />)
  await waitFor(() => screen.getByText(/no artifact open/i))
  expect(screen.queryByRole("heading", { name: "Plan" })).toBeNull()
})

test("opening an artifact from the palette shows it and approves", async () => {
  const verdict = vi.spyOn(api, "postVerdict").mockResolvedValue()
  render(<App />)
  await openViaPalette("P")
  await waitFor(() => screen.getByRole("heading", { name: "Plan" }))
  await userEvent.click(screen.getByRole("button", { name: /approve/i }))
  expect(verdict).toHaveBeenCalledWith("id1", "approved", undefined)
})

test("auto-opens the active session's most recently updated artifact", async () => {
  vi.mocked(api.listArtifacts).mockResolvedValue([
    { id: "old", type: "plan", title: "Old", status: "awaiting_review", currentRevision: 1, createdAt: 0, updatedAt: 100, sessionID: "ses_x" },
    { id: "new", type: "plan", title: "New", status: "awaiting_review", currentRevision: 1, createdAt: 0, updatedAt: 300, sessionID: "ses_x" },
    { id: "mid", type: "plan", title: "Mid", status: "awaiting_review", currentRevision: 1, createdAt: 0, updatedAt: 200, sessionID: "ses_x" },
  ])
  vi.mocked(api.getArtifact).mockImplementation(async (id: string) => ({
    artifact: { id, type: "plan", title: id, status: "awaiting_review", currentRevision: 1, createdAt: 0, updatedAt: 0, sessionID: "ses_x" },
    content: `# ${id} body`,
    comments: [],
  }))
  render(<App />)
  await focusSession("ses_x")
  await waitFor(() => screen.getByRole("heading", { name: "new body" }))
})

test("prefers the active session's most recent artifact over a globally-newer one elsewhere", async () => {
  let resolveList!: (a: any) => void
  vi.mocked(api.listArtifacts).mockReturnValue(new Promise((r) => { resolveList = r }))
  vi.mocked(api.getArtifact).mockImplementation(async (id: string) => ({
    artifact: { id, type: "plan", title: id, status: "awaiting_review", currentRevision: 1, createdAt: 0, updatedAt: 0 },
    content: `# ${id} body`,
    comments: [],
  }))
  render(<App />)
  await focusSession("ses_active")
  await act(async () => {
    resolveList([
      { id: "other_new", type: "plan", title: "Other New", status: "awaiting_review", currentRevision: 1, createdAt: 0, updatedAt: 500, sessionID: "ses_other" },
      { id: "active_old", type: "plan", title: "Active Old", status: "awaiting_review", currentRevision: 1, createdAt: 0, updatedAt: 100, sessionID: "ses_active" },
    ])
  })
  await waitFor(() => screen.getByRole("heading", { name: "active_old body" }))
})

test("the explorer shows only the current session; other sessions stay reachable via Cmd-K", async () => {
  vi.mocked(api.listArtifacts).mockResolvedValue([
    { id: "a1", type: "plan", title: "Plan A", status: "awaiting_review", currentRevision: 1, createdAt: 0, updatedAt: 10, sessionID: "ses_a", sessionTitle: "Alpha" },
    { id: "b1", type: "plan", title: "Plan B", status: "awaiting_review", currentRevision: 1, createdAt: 0, updatedAt: 20, sessionID: "ses_b", sessionTitle: "Beta" },
  ])
  vi.mocked(api.getArtifact).mockImplementation(async (id: string) => ({
    artifact: { id, type: "plan", title: id, status: "awaiting_review", currentRevision: 1, createdAt: 0, updatedAt: 0, sessionID: id === "b1" ? "ses_b" : "ses_a" },
    content: `# ${id} body`,
    comments: [],
  }))
  render(<App />)
  await focusSession("ses_a")
  // The explorer is scoped to ses_a (auto-opening its latest artifact)...
  await waitFor(() => screen.getByRole("heading", { name: "a1 body" }))
  const explorer = () => within(document.querySelector(".artifact-tree") as HTMLElement)
  expect(screen.getByText("Alpha")).toBeInTheDocument()
  expect(explorer().getByText("Plan A")).toBeInTheDocument()
  // ...and ses_b is NOT shown in the tree.
  expect(explorer().queryByText("Plan B")).toBeNull()
  expect(screen.queryByText("Beta")).toBeNull()
  // But the palette can still reach ses_b's artifact.
  await openViaPalette("Plan B")
  await waitFor(() => screen.getByRole("heading", { name: "b1 body" }))
  // The explorer stays anchored to the live session (Alpha), not the opened tab.
  expect(screen.getByText("Alpha")).toBeInTheDocument()
  expect(explorer().queryByText("Plan B")).toBeNull()
})

test("opening two artifacts shows two tabs; closing the active one falls back to its neighbor", async () => {
  vi.mocked(api.listArtifacts).mockResolvedValue([
    { id: "id1", type: "plan", title: "First", status: "awaiting_review", currentRevision: 1, createdAt: 0, updatedAt: 0 },
    { id: "id2", type: "report", title: "Second", status: "published", currentRevision: 1, createdAt: 0, updatedAt: 0 },
  ])
  vi.mocked(api.getArtifact).mockImplementation(async (id: string) => ({
    artifact: { id, type: id === "id2" ? "report" : "plan", title: id === "id2" ? "Second" : "First", status: id === "id2" ? "published" : "awaiting_review", currentRevision: 1, createdAt: 0, updatedAt: 0 },
    content: id === "id2" ? "# Second Body" : "# First Body",
    comments: [],
  }))
  render(<App />)
  await openViaPalette("First")
  await waitFor(() => screen.getByRole("heading", { name: "First Body" }))
  await openViaPalette("Second")
  await waitFor(() => screen.getByRole("heading", { name: "Second Body" }))
  await userEvent.click(screen.getByRole("button", { name: /close second/i }))
  await waitFor(() => screen.getByRole("heading", { name: "First Body" }))
})

test("[ and ] cycle between open tabs", async () => {
  vi.mocked(api.listArtifacts).mockResolvedValue([
    { id: "id1", type: "plan", title: "First", status: "awaiting_review", currentRevision: 1, createdAt: 0, updatedAt: 0 },
    { id: "id2", type: "plan", title: "Second", status: "awaiting_review", currentRevision: 1, createdAt: 0, updatedAt: 0 },
  ])
  vi.mocked(api.getArtifact).mockImplementation(async (id: string) => ({
    artifact: { id, type: "plan", title: id === "id2" ? "Second" : "First", status: "awaiting_review", currentRevision: 1, createdAt: 0, updatedAt: 0 },
    content: id === "id2" ? "# Second Body" : "# First Body",
    comments: [],
  }))
  render(<App />)
  await openViaPalette("First")
  await waitFor(() => screen.getByRole("heading", { name: "First Body" }))
  await openViaPalette("Second")
  await waitFor(() => screen.getByRole("heading", { name: "Second Body" }))
  fireEvent.keyDown(document.body, { key: "[" })
  await waitFor(() => screen.getByRole("heading", { name: "First Body" }))
  fireEvent.keyDown(document.body, { key: "]" })
  await waitFor(() => screen.getByRole("heading", { name: "Second Body" }))
})

test("w closes the active tab", async () => {
  render(<App />)
  await openViaPalette("P")
  await waitFor(() => screen.getByRole("heading", { name: "Plan" }))
  fireEvent.keyDown(document.body, { key: "w" })
  await waitFor(() => screen.getByText(/no artifact open/i))
})

test("'a' approves the open plan, but not while typing in the comment box", async () => {
  const verdict = vi.spyOn(api, "postVerdict").mockResolvedValue()
  render(<App />)
  await openViaPalette("P")
  await waitFor(() => screen.getByRole("heading", { name: "Plan" }))
  const box = screen.getByPlaceholderText("Add a comment")
  box.focus()
  fireEvent.keyDown(box, { key: "a" })
  expect(verdict).not.toHaveBeenCalled()
  fireEvent.keyDown(document.body, { key: "a" })
  await waitFor(() => expect(verdict).toHaveBeenCalledWith("id1", "approved", undefined))
})

test("declining reveals an optional reason field and posts the declined verdict", async () => {
  const verdict = vi.spyOn(api, "postVerdict").mockResolvedValue()
  render(<App />)
  await openViaPalette("P")
  await waitFor(() => screen.getByRole("heading", { name: "Plan" }))
  await userEvent.click(screen.getByRole("button", { name: "Decline" }))
  await userEvent.type(screen.getByPlaceholderText(/reason for declining/i), "wrong direction")
  await userEvent.click(screen.getByRole("button", { name: /confirm decline/i }))
  expect(verdict).toHaveBeenCalledWith("id1", "declined", "wrong direction")
})

test("declining without a reason posts undefined", async () => {
  const verdict = vi.spyOn(api, "postVerdict").mockResolvedValue()
  render(<App />)
  await openViaPalette("P")
  await waitFor(() => screen.getByRole("heading", { name: "Plan" }))
  await userEvent.click(screen.getByRole("button", { name: "Decline" }))
  await userEvent.click(screen.getByRole("button", { name: /confirm decline/i }))
  expect(verdict).toHaveBeenCalledWith("id1", "declined", undefined)
})

test("a declined plan is locked: no actions, no comment input, declined banner with reason", async () => {
  vi.mocked(api.getArtifact).mockResolvedValue({
    artifact: { id: "id1", type: "plan", title: "P", status: "declined", currentRevision: 1, createdAt: 0, updatedAt: 0, declineReason: "out of scope" },
    content: "# Declined Plan",
    comments: [],
  })
  render(<App />)
  await openViaPalette("P")
  await waitFor(() => screen.getByRole("heading", { name: "Declined Plan" }))
  expect(screen.getByText(/declined — the agent was stopped/i)).toBeInTheDocument()
  expect(screen.getByText(/out of scope/i)).toBeInTheDocument()
  expect(screen.queryByRole("button", { name: /approve/i })).toBeNull()
  expect(screen.queryByRole("button", { name: "Decline" })).toBeNull()
  expect(screen.queryByPlaceholderText("Add a comment")).toBeNull()
})

test("shows a connection-lost banner when the event stream errors", async () => {
  let errCb: ((e: any) => void) | undefined
  vi.mocked(api.subscribeEvents).mockImplementation((_onEvent, onError) => {
    errCb = onError
    return () => {}
  })
  const { findByText } = render(<App />)
  await waitFor(() => expect(errCb).toBeTypeOf("function"))
  errCb!(new Event("error"))
  expect(await findByText(/connection lost/i)).toBeInTheDocument()
})

test("shows an error banner when loading the artifact list fails", async () => {
  vi.mocked(api.listArtifacts).mockRejectedValue(new Error("500"))
  const { findByText } = render(<App />)
  expect(await findByText(/couldn't reach the companion server/i)).toBeInTheDocument()
})

test("switching to an older revision shows read-only history; back to latest restores actions", async () => {
  vi.mocked(api.listArtifacts).mockResolvedValue([
    { id: "id1", type: "plan", title: "P", status: "awaiting_review", currentRevision: 2, createdAt: 0, updatedAt: 0 },
  ])
  vi.mocked(api.getArtifact).mockResolvedValue({
    artifact: { id: "id1", type: "plan", title: "P", status: "awaiting_review", currentRevision: 2, createdAt: 0, updatedAt: 0 },
    content: "# Rev Two Latest",
    comments: [{ id: "c1", revision: 1, kind: "general", body: "old feedback", resolved: true, createdAt: 0 }],
  })
  vi.mocked(api.getRevision).mockResolvedValue({ content: "# Rev One Old" })

  render(<App />)
  await openViaPalette("P")
  await waitFor(() => screen.getByRole("heading", { name: "Rev Two Latest" }))
  expect(screen.getByRole("button", { name: /approve/i })).toBeInTheDocument()

  await userEvent.selectOptions(screen.getByRole("combobox", { name: /revision/i }), "1")
  await waitFor(() => screen.getByRole("heading", { name: "Rev One Old" }))
  expect(screen.getByText(/historical/i)).toBeInTheDocument()
  expect(screen.queryByRole("button", { name: /approve/i })).toBeNull()
  expect(screen.getByText("old feedback")).toBeInTheDocument()

  await userEvent.click(screen.getByRole("button", { name: /back to latest/i }))
  await waitFor(() => screen.getByRole("heading", { name: "Rev Two Latest" }))
  expect(screen.getByRole("button", { name: /approve/i })).toBeInTheDocument()
})

test("clicking a highlight in the document flashes its comment in the rail", async () => {
  vi.mocked(api.getArtifact).mockResolvedValue({
    artifact: { id: "id1", type: "plan", title: "P", status: "awaiting_review", currentRevision: 1, createdAt: 0, updatedAt: 0 },
    content: "# Plan\n\nstep one here",
    comments: [{ id: "c1", revision: 1, kind: "anchor", anchor: { quote: "step one", prefix: "", suffix: "" }, body: "fix this", resolved: false, createdAt: 0 }],
  })
  render(<App />)
  await openViaPalette("P")
  let mark: Element | null = null
  await waitFor(() => {
    mark = document.querySelector("mark.anchor-highlight")
    expect(mark).not.toBeNull()
  })
  fireEvent.click(mark!)
  await waitFor(() => {
    const comment = document.querySelector('.comment[data-comment-id="c1"]')
    expect(comment?.classList.contains("flash")).toBe(true)
  })
})

test("an approved plan is locked: no actions, no comment input, approved banner", async () => {
  vi.mocked(api.getArtifact).mockResolvedValue({
    artifact: { id: "id1", type: "plan", title: "P", status: "approved", currentRevision: 1, createdAt: 0, updatedAt: 0 },
    content: "# Approved Plan",
    comments: [{ id: "c1", revision: 1, kind: "general", body: "a note", resolved: false, createdAt: 0 }],
  })
  render(<App />)
  await openViaPalette("P")
  await waitFor(() => screen.getByRole("heading", { name: "Approved Plan" }))
  expect(screen.getByText(/approved — review closed/i)).toBeInTheDocument()
  expect(screen.queryByRole("button", { name: /approve/i })).toBeNull()
  expect(screen.queryByRole("button", { name: /request changes/i })).toBeNull()
  expect(screen.queryByPlaceholderText("Add a comment")).toBeNull()
  expect(screen.getByText("a note")).toBeInTheDocument()
})

test("a draft phase is commentable but not approvable, and shows the draft banner", async () => {
  vi.mocked(api.listArtifacts).mockResolvedValue([
    { id: "id1", type: "plan", title: "Phase 1", status: "draft", currentRevision: 1, createdAt: 0, updatedAt: 0, parentId: "road1" },
  ])
  vi.mocked(api.getArtifact).mockResolvedValue({
    artifact: { id: "id1", type: "plan", title: "Phase 1", status: "draft", currentRevision: 1, createdAt: 0, updatedAt: 0, parentId: "road1" },
    content: "# Draft Phase",
    comments: [],
  })
  render(<App />)
  await openViaPalette("Phase")
  await waitFor(() => screen.getByRole("heading", { name: "Draft Phase" }))
  expect(screen.getByPlaceholderText("Add a comment")).toBeInTheDocument()
  expect(screen.queryByRole("button", { name: /approve/i })).toBeNull()
  expect(screen.queryByRole("button", { name: /request changes/i })).toBeNull()
  expect(screen.getByText(/draft — the agent will submit/i)).toBeInTheDocument()
})

test("the header shows the creating agent's name when present", async () => {
  vi.mocked(api.getArtifact).mockResolvedValue({
    artifact: { id: "id1", type: "plan", title: "P", status: "awaiting_review", currentRevision: 1, createdAt: 0, updatedAt: 0, agent: "build" },
    content: "# Plan Body", comments: [],
  })
  render(<App />)
  await openViaPalette("P")
  await waitFor(() => screen.getByRole("heading", { name: "Plan Body" }))
  expect(screen.getByText("by build")).toBeInTheDocument()
})

test("the reading-width toggle flips the documentElement dataset", async () => {
  render(<App />)
  const toggle = await screen.findByRole("button", { name: /toggle reading width/i })
  const before = document.documentElement.dataset.reading
  await userEvent.click(toggle)
  expect(document.documentElement.dataset.reading).not.toBe(before)
})

test("the left rail shows a theme toggle that flips the theme", async () => {
  localStorage.clear()
  document.documentElement.dataset.theme = "dark"
  render(<App />)
  const btn = await screen.findByRole("button", { name: /theme/i })
  await userEvent.click(btn)
  expect(document.documentElement.dataset.theme).toBe("light")
})

test("a report is read-only: no comment input, no action buttons, shows the read-only note", async () => {
  vi.mocked(api.listArtifacts).mockResolvedValue([
    { id: "id1", type: "report", title: "R", status: "published", currentRevision: 1, createdAt: 0, updatedAt: 0 },
  ])
  vi.mocked(api.getArtifact).mockResolvedValue({
    artifact: { id: "id1", type: "report", title: "R", status: "published", currentRevision: 1, createdAt: 0, updatedAt: 0 },
    content: "# Report Body",
    comments: [],
  })
  render(<App />)
  await openViaPalette("R")
  await waitFor(() => screen.getByRole("heading", { name: "Report Body" }))
  expect(screen.queryByPlaceholderText("Add a comment")).toBeNull()
  expect(screen.queryByRole("button", { name: /approve/i })).toBeNull()
  expect(screen.queryByRole("button", { name: /request changes/i })).toBeNull()
  expect(screen.getByText(/agent report — read-only/i)).toBeInTheDocument()
})

test("the explorer badges a plan-linked report as 'result' and a general report as 'report'", async () => {
  vi.mocked(api.listArtifacts).mockResolvedValue([
    { id: "pl", type: "plan", title: "Plan", status: "approved", currentRevision: 1, createdAt: 1, updatedAt: 1, sessionID: "ses_x" },
    { id: "lr", type: "report", title: "Plan result", status: "published", currentRevision: 1, createdAt: 2, updatedAt: 2, sessionID: "ses_x", parentId: "pl" },
    { id: "gr", type: "report", title: "Research", status: "published", currentRevision: 1, createdAt: 3, updatedAt: 3, sessionID: "ses_x" },
  ])
  render(<App />)
  await focusSession("ses_x")
  // The roadmap/plan node is expanded by default, so the nested report is visible.
  await waitFor(() => expect(document.querySelector(".badge-result")).not.toBeNull())
  const tree = document.querySelector(".artifact-tree")!
  // The linked report reads as a "result"; the general report keeps "report".
  expect(within(tree as HTMLElement).getByText("result")).toBeInTheDocument()
  expect(within(tree as HTMLElement).getByText("report")).toBeInTheDocument()
})

test("agent.status drives the rail status strip for the active session only", async () => {
  render(<App />)
  await focusSession("ses_a")

  // A working status for the active session shows in the strip.
  act(() => emit!({ type: "agent.status", sessionID: "ses_a", state: "working", message: "Running tests" }))
  await waitFor(() => expect(screen.getByText("Running tests")).toBeInTheDocument())

  // A status for a different (background) session is ignored.
  act(() => emit!({ type: "agent.status", sessionID: "ses_b", state: "working", message: "Editing other.ts" }))
  expect(screen.queryByText("Editing other.ts")).toBeNull()
  expect(screen.getByText("Running tests")).toBeInTheDocument()

  // Idle returns the strip to its (always-visible) Idle line.
  act(() => emit!({ type: "agent.status", sessionID: "ses_a", state: "idle", message: "" }))
  await waitFor(() => expect(screen.queryByText("Running tests")).toBeNull())
  expect(screen.getByText("Idle")).toBeInTheDocument()
})

test("switching sessions drops a stale status strip", async () => {
  render(<App />)
  await focusSession("ses_a")
  act(() => emit!({ type: "agent.status", sessionID: "ses_a", state: "working", message: "Editing a.ts" }))
  await waitFor(() => expect(screen.getByText("Editing a.ts")).toBeInTheDocument())

  // Focus moves to another session — the previous session's phrase must clear
  // back to the Idle line until the new session reports its own status.
  act(() => emit!({ type: "session.active", sessionID: "ses_b" }))
  await waitFor(() => expect(screen.queryByText("Editing a.ts")).toBeNull())
  expect(screen.getByText("Idle")).toBeInTheDocument()
})
