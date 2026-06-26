import { test, expect, vi } from "vitest"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { SessionsIntro } from "./SessionsIntro"
import type { SessionSummary } from "./ArtifactList"

const sessions: SessionSummary[] = [
  { key: "s1", label: "First session", count: 2, latest: 2, hasUnseen: false },
  { key: "s2", label: "Second session", count: 1, latest: 1, hasUnseen: false },
]

test("highlights the active session and marks it with a current badge", () => {
  render(<SessionsIntro sessions={sessions} onPick={vi.fn()} activeSessionID="s2" />)

  const active = screen.getByRole("button", { name: /second session/i })
  const other = screen.getByRole("button", { name: /first session/i })

  expect(active.className).toContain("current")
  expect(within(active).getByText("current")).toBeInTheDocument()

  expect(other.className).not.toContain("current")
  expect(within(other).queryByText("current")).not.toBeInTheDocument()
})

test("no card is highlighted when the active session is unknown or absent from the list", () => {
  render(<SessionsIntro sessions={sessions} onPick={vi.fn()} activeSessionID="missing" />)
  for (const label of [/first session/i, /second session/i]) {
    expect(screen.getByRole("button", { name: label }).className).not.toContain("current")
  }
})

test("picking a session still fires onPick", async () => {
  const onPick = vi.fn()
  render(<SessionsIntro sessions={sessions} onPick={onPick} activeSessionID="s1" />)
  await userEvent.click(screen.getByRole("button", { name: /second session/i }))
  expect(onPick).toHaveBeenCalledWith("s2")
})
