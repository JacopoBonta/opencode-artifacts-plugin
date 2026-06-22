import { test, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { RevisionSwitcher } from "./RevisionSwitcher"

test("renders an option per revision and fires onSelect", async () => {
  const onSelect = vi.fn()
  render(<RevisionSwitcher total={3} viewing={3} onSelect={onSelect} />)
  const select = screen.getByRole("combobox", { name: /revision/i })
  expect(screen.getAllByRole("option")).toHaveLength(3)
  await userEvent.selectOptions(select, "1")
  expect(onSelect).toHaveBeenCalledWith(1)
})

test("renders nothing when there is only one revision", () => {
  const { container } = render(<RevisionSwitcher total={1} viewing={1} onSelect={() => {}} />)
  expect(container.firstChild).toBeNull()
})
