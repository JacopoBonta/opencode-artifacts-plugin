import { test, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { ActionBar } from "./ActionBar"

test("plan shows Approve + Request changes and fires callbacks", async () => {
  const onApprove = vi.fn(), onChanges = vi.fn(), onRefine = vi.fn()
  render(<ActionBar type="plan" onApprove={onApprove} onRequestChanges={onChanges} onRefine={onRefine} />)
  await userEvent.click(screen.getByRole("button", { name: /approve/i }))
  expect(onApprove).toHaveBeenCalled()
  await userEvent.click(screen.getByRole("button", { name: /request changes/i }))
  expect(onChanges).toHaveBeenCalled()
})

test("report shows only Request refinement", () => {
  render(<ActionBar type="report" onApprove={() => {}} onRequestChanges={() => {}} onRefine={() => {}} />)
  expect(screen.queryByRole("button", { name: /approve/i })).toBeNull()
  expect(screen.getByRole("button", { name: /request refinement/i })).toBeInTheDocument()
})
