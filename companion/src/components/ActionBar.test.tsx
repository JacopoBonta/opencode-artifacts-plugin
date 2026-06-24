import { test, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { ActionBar } from "./ActionBar"

test("renders Approve + Request changes and fires their callbacks", async () => {
  const onApprove = vi.fn(), onChanges = vi.fn()
  render(<ActionBar onApprove={onApprove} onRequestChanges={onChanges} />)
  await userEvent.click(screen.getByRole("button", { name: /approve/i }))
  expect(onApprove).toHaveBeenCalled()
  await userEvent.click(screen.getByRole("button", { name: /request changes/i }))
  expect(onChanges).toHaveBeenCalled()
})

test("disables both buttons and shows the note when disabled", async () => {
  const onApprove = vi.fn(), onChanges = vi.fn()
  render(
    <ActionBar
      onApprove={onApprove}
      onRequestChanges={onChanges}
      disabled
      note="Changes requested — awaiting the agent's revision."
    />,
  )
  expect(screen.getByText(/awaiting the agent/i)).toBeInTheDocument()
  const approve = screen.getByRole("button", { name: /approve/i })
  expect(approve).toBeDisabled()
  await userEvent.click(approve)
  expect(onApprove).not.toHaveBeenCalled()
})
