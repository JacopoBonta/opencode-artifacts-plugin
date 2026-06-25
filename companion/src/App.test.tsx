import { test, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, waitFor, act, fireEvent } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import * as api from "./api"
import { App } from "./App"

beforeEach(() => {
  vi.spyOn(api, "subscribeEvents").mockReturnValue(() => {})
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

test("auto-selects the first artifact on load and approves", async () => {
  const verdict = vi.spyOn(api, "postVerdict").mockResolvedValue()
  render(<App />)
  // The markdown heading from the artifact content confirms detail auto-loaded.
  await waitFor(() => screen.getByRole("heading", { name: "Plan" }))
  await userEvent.click(screen.getByRole("button", { name: /approve/i }))
  expect(verdict).toHaveBeenCalledWith("id1", "approved")
})

test("shows a connection-lost banner when the event stream errors", async () => {
  let errCb: ((e: any) => void) | undefined
  vi.mocked(api.subscribeEvents).mockImplementation((_onEvent, onError) => {
    errCb = onError
    return () => {}
  })
  const { findByText } = render(<App />)
  // trigger the error callback
  await waitFor(() => expect(errCb).toBeTypeOf("function"))
  errCb!(new Event("error"))
  expect(await findByText(/connection lost/i)).toBeInTheDocument()
})

test("shows an error banner when loading the artifact list fails", async () => {
  vi.mocked(api.listArtifacts).mockRejectedValue(new Error("500"))
  const { findByText } = render(<App />)
  expect(await findByText(/couldn't reach the companion server/i)).toBeInTheDocument()
})

test("clicking another artifact in the list selects it", async () => {
  vi.mocked(api.listArtifacts).mockResolvedValue([
    { id: "id1", type: "plan", title: "First", status: "awaiting_review", currentRevision: 1, createdAt: 0, updatedAt: 0 },
    { id: "id2", type: "report", title: "Second", status: "published", currentRevision: 1, createdAt: 0, updatedAt: 0 },
  ])
  vi.mocked(api.getArtifact).mockImplementation(async (id: string) => ({
    artifact: { id, type: id === "id2" ? "report" : "plan", title: id === "id2" ? "Second" : "First", status: "published", currentRevision: 1, createdAt: 0, updatedAt: 0 },
    content: id === "id2" ? "# Second Body" : "# First Body",
    comments: [],
  }))
  render(<App />)
  await waitFor(() => screen.getByRole("heading", { name: "First Body" }))
  await userEvent.click(screen.getByText("Second"))
  await waitFor(() => screen.getByRole("heading", { name: "Second Body" }))
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
  await waitFor(() => screen.getByRole("heading", { name: "Draft Phase" }))
  // commentable
  expect(screen.getByPlaceholderText("Add a comment")).toBeInTheDocument()
  // not approvable
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
  await waitFor(() => screen.getByRole("heading", { name: "Plan Body" }))
  expect(screen.getByText("by build")).toBeInTheDocument()
})

test("the reading-width toggle flips the documentElement dataset", async () => {
  render(<App />)
  await waitFor(() => screen.getByRole("heading", { name: "Plan" }))
  const toggle = screen.getByRole("button", { name: /toggle reading width/i })
  const before = document.documentElement.dataset.reading
  await userEvent.click(toggle)
  expect(document.documentElement.dataset.reading).not.toBe(before)
})

test("the left rail shows a theme toggle that flips the theme", async () => {
  localStorage.clear()
  document.documentElement.dataset.theme = "dark"
  render(<App />)
  const btn = await screen.findByRole("button", { name: /toggle theme/i })
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
  await waitFor(() => screen.getByRole("heading", { name: "Report Body" }))
  expect(screen.queryByPlaceholderText("Add a comment")).toBeNull()
  expect(screen.queryByRole("button", { name: /approve/i })).toBeNull()
  expect(screen.queryByRole("button", { name: /request changes/i })).toBeNull()
  expect(screen.queryByRole("button", { name: /request refinement/i })).toBeNull()
  expect(screen.getByText(/agent report — read-only/i)).toBeInTheDocument()
})
