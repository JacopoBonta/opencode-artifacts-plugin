import { test, expect, vi, afterEach } from "vitest"
import { render, screen, act } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { Toaster } from "./Toaster"
import type { Toast } from "../toasts"

afterEach(() => vi.useRealTimers())

test("renders toasts inside a polite aria-live region", () => {
  render(<Toaster toasts={[{ id: 1, kind: "success", message: "Saved" }]} onDismiss={() => {}} />)
  expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite")
  expect(screen.getByText("Saved")).toBeInTheDocument()
})

test("auto-dismisses an informational toast after its timeout", () => {
  vi.useFakeTimers()
  const onDismiss = vi.fn()
  render(<Toaster toasts={[{ id: 1, kind: "success", message: "Saved" }]} onDismiss={onDismiss} />)
  act(() => { vi.advanceTimersByTime(3500) })
  expect(onDismiss).toHaveBeenCalledWith(1)
})

test("an actionable toast does not auto-dismiss and fires its action on click", async () => {
  const onDismiss = vi.fn()
  const onClick = vi.fn()
  render(
    <Toaster
      toasts={[{ id: 2, kind: "error", message: "Failed", action: { label: "Retry", onClick } }]}
      onDismiss={onDismiss}
    />,
  )
  await userEvent.click(screen.getByRole("button", { name: /retry/i }))
  expect(onClick).toHaveBeenCalled()
  expect(onDismiss).toHaveBeenCalledWith(2)
})

test("the dismiss button removes the toast", async () => {
  const onDismiss = vi.fn()
  render(<Toaster toasts={[{ id: 3, kind: "success", message: "Hi" }]} onDismiss={onDismiss} />)
  await userEvent.click(screen.getByRole("button", { name: /dismiss/i }))
  expect(onDismiss).toHaveBeenCalledWith(3)
})
