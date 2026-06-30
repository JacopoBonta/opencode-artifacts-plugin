import { test, expect, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { ThemeToggle } from "./ThemeToggle"

beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute("data-theme")
})

test("cycles system → light → dark, persisting and applying each choice", async () => {
  render(<ThemeToggle />)
  const btn = screen.getByRole("button", { name: /theme/i })

  // Default choice is "system"; first click → light.
  await userEvent.click(btn)
  expect(localStorage.getItem("oc-artifacts-theme")).toBe("light")
  expect(document.documentElement.dataset.theme).toBe("light")

  // → dark
  await userEvent.click(btn)
  expect(localStorage.getItem("oc-artifacts-theme")).toBe("dark")
  expect(document.documentElement.dataset.theme).toBe("dark")

  // → back to system
  await userEvent.click(btn)
  expect(localStorage.getItem("oc-artifacts-theme")).toBe("system")
})
