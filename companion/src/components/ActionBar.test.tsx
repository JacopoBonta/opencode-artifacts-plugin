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

test("report shows only Request refinement and fires onRefine", async () => {
  const onRefine = vi.fn()
  render(<ActionBar type="report" onApprove={() => {}} onRequestChanges={() => {}} onRefine={onRefine} />)
  expect(screen.queryByRole("button", { name: /approve/i })).toBeNull()
  const btn = screen.getByRole("button", { name: /request refinement/i })
  expect(btn).toBeInTheDocument()
  await userEvent.click(btn)
  expect(onRefine).toHaveBeenCalled()
})
