import { test, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { ArtifactTree } from "./ArtifactTree"
import type { Artifact } from "../api"

const arts: Artifact[] = [
  { id: "a1", type: "plan", title: "Plan A", status: "approved", currentRevision: 1, createdAt: 1, updatedAt: 1, sessionID: "ses_111", sessionTitle: "Build login" },
  { id: "a2", type: "report", title: "Report A", status: "published", currentRevision: 1, createdAt: 2, updatedAt: 2, sessionID: "ses_111", sessionTitle: "Build login" },
  { id: "b1", type: "plan", title: "Plan B", status: "awaiting_review", currentRevision: 1, createdAt: 3, updatedAt: 3, sessionID: "ses_222", sessionTitle: "Fix bug" },
]

function tree(extra: Partial<React.ComponentProps<typeof ArtifactTree>> = {}) {
  return render(
    <ArtifactTree artifacts={arts} focusedSessionID="ses_111" collapsed={{}} onToggle={() => {}} onOpen={() => {}} {...extra} />,
  )
}

test("shows only the focused session's artifacts (others are reachable elsewhere)", () => {
  tree()
  expect(screen.getByText("Build login")).toBeInTheDocument()
  expect(screen.getByText("Plan A")).toBeInTheDocument()
  expect(screen.getByText("Report A")).toBeInTheDocument()
  // ses_222 belongs to another session and must not appear in the explorer.
  expect(screen.queryByText("Plan B")).toBeNull()
  expect(screen.queryByText("Fix bug")).toBeNull()
})

test("clicking an artifact calls onOpen", async () => {
  const onOpen = vi.fn()
  tree({ onOpen })
  await userEvent.click(screen.getByText("Plan A"))
  expect(onOpen).toHaveBeenCalledWith("a1")
})

test("shows a live dot only when the focused session is the live one", () => {
  const { container, rerender } = tree({ isLive: true })
  expect(container.querySelector(".session-heading.live")).not.toBeNull()
  expect(container.querySelector(".live-dot")).not.toBeNull()
  rerender(
    <ArtifactTree artifacts={arts} focusedSessionID="ses_111" isLive={false} collapsed={{}} onToggle={() => {}} onOpen={() => {}} />,
  )
  expect(container.querySelector(".live-dot")).toBeNull()
})

test("marks the active artifact and the keyboard-selected row", () => {
  const { container } = tree({ activeId: "a1", keyboardId: "a2" })
  expect(container.querySelector(".tree-leaf.active")?.textContent).toContain("Plan A")
  expect(container.querySelector(".tree-leaf.kbd")?.textContent).toContain("Report A")
})

test("with no focused session, shows the Cmd-K hint", () => {
  render(<ArtifactTree artifacts={arts} collapsed={{}} onToggle={() => {}} onOpen={() => {}} />)
  expect(screen.getByText(/no active session/i)).toBeInTheDocument()
  expect(screen.queryByText("Plan A")).toBeNull()
})
