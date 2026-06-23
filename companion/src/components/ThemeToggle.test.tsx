import { test, expect, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { ThemeToggle } from "./ThemeToggle"

beforeEach(() => {
  localStorage.clear()
  document.documentElement.dataset.theme = "dark"
})

test("renders a toggle and flips the theme on click", async () => {
  render(<ThemeToggle />)
  const btn = screen.getByRole("button", { name: /toggle theme/i })
  await userEvent.click(btn)
  expect(document.documentElement.dataset.theme).toBe("light")
  expect(localStorage.getItem("oc-artifacts-theme")).toBe("light")
  await userEvent.click(btn)
  expect(document.documentElement.dataset.theme).toBe("dark")
})
