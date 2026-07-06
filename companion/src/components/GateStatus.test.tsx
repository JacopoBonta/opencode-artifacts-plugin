import { test, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { GateStatus } from "./GateStatus"

test("renders nothing while gate info hasn't loaded yet", () => {
  const { container } = render(<GateStatus info={undefined} onUnlock={vi.fn()} onRelock={vi.fn()} />)
  expect(container).toBeEmptyDOMElement()
})

test("closed: shows the reason and an Unlock button that fires onUnlock", async () => {
  const onUnlock = vi.fn()
  render(
    <GateStatus
      info={{ state: "closed", forced: false, reason: "no plan published" }}
      onUnlock={onUnlock}
      onRelock={vi.fn()}
    />,
  )
  expect(screen.getByRole("status")).toHaveClass("gate-closed")
  expect(screen.getByText(/gate closed — no plan published/i)).toBeInTheDocument()
  expect(screen.queryByRole("button", { name: /re-lock/i })).toBeNull()
  await userEvent.click(screen.getByRole("button", { name: /unlock/i }))
  expect(onUnlock).toHaveBeenCalled()
})

test("open + forced: shows a Re-lock button that fires onRelock", async () => {
  const onRelock = vi.fn()
  render(
    <GateStatus
      info={{ state: "open", forced: true, reason: "Manually unlocked" }}
      onUnlock={vi.fn()}
      onRelock={onRelock}
    />,
  )
  expect(screen.getByRole("status")).toHaveClass("gate-open")
  expect(screen.getByText(/gate open — manually unlocked/i)).toBeInTheDocument()
  expect(screen.queryByRole("button", { name: /unlock/i })).toBeNull()
  await userEvent.click(screen.getByRole("button", { name: /re-lock/i }))
  expect(onRelock).toHaveBeenCalled()
})

test("open + not forced: no button at all — a genuinely approved gate can't be locked from here", () => {
  render(
    <GateStatus
      info={{ state: "open", forced: false, reason: "plan approved" }}
      onUnlock={vi.fn()}
      onRelock={vi.fn()}
    />,
  )
  expect(screen.getByText(/gate open — plan approved/i)).toBeInTheDocument()
  expect(screen.queryByRole("button")).toBeNull()
})

test("busy disables the visible action button", () => {
  render(
    <GateStatus
      info={{ state: "closed", forced: false, reason: "no plan published" }}
      onUnlock={vi.fn()}
      onRelock={vi.fn()}
      busy
    />,
  )
  expect(screen.getByRole("button", { name: /unlock/i })).toBeDisabled()
})
