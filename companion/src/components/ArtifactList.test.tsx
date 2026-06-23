import { test, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { ArtifactList } from "./ArtifactList"
import type { Artifact } from "../api"

const arts: Artifact[] = [
  { id: "a1", type: "plan", title: "Plan A", status: "approved", currentRevision: 1, createdAt: 1, updatedAt: 1, sessionID: "ses_111", sessionTitle: "Build login" },
  { id: "a2", type: "report", title: "Report A", status: "published", currentRevision: 1, createdAt: 2, updatedAt: 2, sessionID: "ses_111", sessionTitle: "Build login" },
  { id: "b1", type: "plan", title: "Plan B", status: "awaiting_review", currentRevision: 1, createdAt: 3, updatedAt: 3, sessionID: "ses_222", sessionTitle: "Fix bug" },
  { id: "c1", type: "plan", title: "Plan C", status: "awaiting_review", currentRevision: 1, createdAt: 4, updatedAt: 4 },
]

test("renders a header per session (title) plus an Ungrouped section", () => {
  render(<ArtifactList artifacts={arts} selectedId="a1" onSelect={() => {}} />)
  expect(screen.getByText("Build login")).toBeInTheDocument()
  expect(screen.getByText("Fix bug")).toBeInTheDocument()
  expect(screen.getByText("Ungrouped")).toBeInTheDocument()
})

test("expands the selected artifact's group and collapses the others", () => {
  render(<ArtifactList artifacts={arts} selectedId="a1" onSelect={() => {}} />)
  expect(screen.getByText("Plan A")).toBeInTheDocument()
  expect(screen.getByText("Report A")).toBeInTheDocument()
  expect(screen.queryByText("Plan B")).toBeNull()
})

test("clicking a collapsed group header expands it", async () => {
  render(<ArtifactList artifacts={arts} selectedId="a1" onSelect={() => {}} />)
  expect(screen.queryByText("Plan B")).toBeNull()
  await userEvent.click(screen.getByText("Fix bug"))
  expect(screen.getByText("Plan B")).toBeInTheDocument()
})

test("clicking an artifact calls onSelect", async () => {
  const onSelect = vi.fn()
  render(<ArtifactList artifacts={arts} selectedId="a1" onSelect={onSelect} />)
  await userEvent.click(screen.getByText("Plan A"))
  expect(onSelect).toHaveBeenCalledWith("a1")
})
