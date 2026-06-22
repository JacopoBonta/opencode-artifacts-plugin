import { test, expect, vi, beforeEach } from "vitest"
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

test("loads list, selects first artifact, approves", async () => {
  const verdict = vi.spyOn(api, "postVerdict").mockResolvedValue()
  render(<App />)
  await waitFor(() => screen.getByText("P"))
  await userEvent.click(screen.getByText("P"))
  await waitFor(() => screen.getByRole("heading", { name: "Plan" }))
  await userEvent.click(screen.getByRole("button", { name: /approve/i }))
  expect(verdict).toHaveBeenCalledWith("id1", "approved")
})
