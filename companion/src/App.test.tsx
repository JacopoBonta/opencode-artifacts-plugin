import { test, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
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
