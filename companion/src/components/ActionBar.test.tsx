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
