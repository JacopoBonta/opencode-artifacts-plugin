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

test("marks the active session's group as current", () => {
  const { container } = render(
    <ArtifactList artifacts={arts} selectedId="a1" activeSessionID="ses_222" onSelect={() => {}} />,
  )
  // The current badge sits on the active session's header (not the selected one).
  expect(screen.getByText("current")).toBeInTheDocument()
  const current = container.querySelector(".group-header.current")
  expect(current?.textContent).toContain("Fix bug")
})

test("shows an activity dot on an unseen artifact in an open group", () => {
  const { container } = render(
    <ArtifactList
      artifacts={arts}
      selectedId="a1"
      unseenIds={new Set(["a2"])}
      onSelect={() => {}}
    />,
  )
  // a2 (Report A) is in the open (selected) group, so its dot renders inline.
  expect(container.querySelectorAll(".activity-dot")).toHaveLength(1)
})

test("bubbles an activity dot to a collapsed group's header", () => {
  const { container } = render(
    <ArtifactList
      artifacts={arts}
      selectedId="a1"
      unseenIds={new Set(["b1"])}
      onSelect={() => {}}
    />,
  )
  // b1 lives in the collapsed "Fix bug" group; the dot shows on its header.
  const dot = container.querySelector(".group-header .activity-dot")
  expect(dot).not.toBeNull()
  // Plan B itself stays hidden because the group is collapsed.
  expect(screen.queryByText("Plan B")).toBeNull()
})

test("session scope shows only the focused session and counts the rest", () => {
  render(
    <ArtifactList
      artifacts={arts}
      scope="session"
      focusedSessionID="ses_111"
      onSelect={() => {}}
    />,
  )
  // Focused session's artifacts are visible...
  expect(screen.getByText("Plan A")).toBeInTheDocument()
  expect(screen.getByText("Report A")).toBeInTheDocument()
  // ...other sessions are hidden behind the hint (a2 is the only other-session
  // sibling besides b1 and c1 → 2 artifacts in other sessions).
  expect(screen.queryByText("Plan B")).toBeNull()
  expect(screen.queryByText("Plan C")).toBeNull()
  expect(screen.getByText("2 in other sessions →")).toBeInTheDocument()
})

test("session scope hint switches to the all view", async () => {
  const onShowAll = vi.fn()
  render(
    <ArtifactList
      artifacts={arts}
      scope="session"
      focusedSessionID="ses_111"
      onSelect={() => {}}
      onShowAll={onShowAll}
    />,
  )
  await userEvent.click(screen.getByText("2 in other sessions →"))
  expect(onShowAll).toHaveBeenCalled()
})

test("session scope header returns to the sessions list", async () => {
  const onShowSessions = vi.fn()
  render(
    <ArtifactList
      artifacts={arts}
      scope="session"
      focusedSessionID="ses_111"
      onSelect={() => {}}
      onShowSessions={onShowSessions}
    />,
  )
  await userEvent.click(screen.getByText("Build login"))
  expect(onShowSessions).toHaveBeenCalled()
})

test("session scope with no focused session prompts to pick one", () => {
  render(<ArtifactList artifacts={arts} scope="session" onSelect={() => {}} />)
  expect(screen.getByText("Pick a session →")).toBeInTheDocument()
  expect(screen.queryByText("Plan A")).toBeNull()
})

test("all scope pins the focused session to the top", () => {
  const { container } = render(
    <ArtifactList
      artifacts={arts}
      scope="all"
      focusedSessionID="ses_222"
      onSelect={() => {}}
    />,
  )
  const headers = Array.from(container.querySelectorAll(".group-title")).map((e) => e.textContent)
  // ses_222 ("Fix bug") is pinned first despite ses_111 having later activity.
  expect(headers[0]).toBe("Fix bug")
})

const withArchived: Artifact[] = [
  ...arts,
  { id: "z1", type: "plan", title: "Old Plan", status: "approved", currentRevision: 1, createdAt: 5, updatedAt: 5, sessionID: "ses_111", sessionTitle: "Build login", archived: true },
]

test("archived artifacts are excluded from session groups and shown under Archived", async () => {
  render(<ArtifactList artifacts={withArchived} selectedId="a1" onSelect={() => {}} />)
  // Not rendered inline in its session group...
  expect(screen.queryByText("Old Plan")).toBeNull()
  // ...but the Archived section exists; expanding it reveals the item.
  await userEvent.click(screen.getByText("Archived"))
  expect(screen.getByText("Old Plan")).toBeInTheDocument()
})

test("Archived section offers Unarchive and Delete (Delete needs confirm)", async () => {
  const onUnarchive = vi.fn()
  const onDelete = vi.fn()
  const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true)
  render(
    <ArtifactList
      artifacts={withArchived}
      selectedId="a1"
      onSelect={() => {}}
      onUnarchive={onUnarchive}
      onDelete={onDelete}
    />,
  )
  await userEvent.click(screen.getByText("Archived"))
  await userEvent.click(screen.getByText("Unarchive"))
  expect(onUnarchive).toHaveBeenCalledWith("z1")
  await userEvent.click(screen.getByText("Delete"))
  expect(confirmSpy).toHaveBeenCalled()
  expect(onDelete).toHaveBeenCalledWith("z1")
  confirmSpy.mockRestore()
})
