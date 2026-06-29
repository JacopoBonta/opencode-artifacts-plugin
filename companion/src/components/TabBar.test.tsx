import { test, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { TabBar } from "./TabBar"
import type { Artifact } from "../api"

const art = (id: string, title: string, type: "plan" | "report" = "plan"): Artifact => ({
  id, type, title, status: "awaiting_review", currentRevision: 1, createdAt: 0, updatedAt: 0,
})

test("renders a tab per artifact and marks the active one", () => {
  render(<TabBar tabs={[art("1", "Alpha"), art("2", "Beta")]} activeId="2" onActivate={() => {}} onClose={() => {}} />)
  expect(screen.getByText("Alpha")).toBeInTheDocument()
  const active = document.querySelector(".tab.active")
  expect(active?.textContent).toContain("Beta")
})

test("clicking a tab activates it; clicking its × closes it", async () => {
  const onActivate = vi.fn()
  const onClose = vi.fn()
  render(<TabBar tabs={[art("1", "Alpha")]} activeId="1" onActivate={onActivate} onClose={onClose} />)
  await userEvent.click(screen.getByText("Alpha"))
  expect(onActivate).toHaveBeenCalledWith("1")
  await userEvent.click(screen.getByRole("button", { name: /close alpha/i }))
  expect(onClose).toHaveBeenCalledWith("1")
})

test("shows a single unseen dot for an updated inactive tab", () => {
  const { container } = render(
    <TabBar
      tabs={[art("1", "Alpha"), art("2", "Beta")]}
      activeId="1"
      unseenIds={new Set(["2"])}
      onActivate={() => {}}
      onClose={() => {}}
    />,
  )
  expect(container.querySelectorAll(".activity-dot")).toHaveLength(1)
})
