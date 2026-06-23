import { test, expect, beforeEach } from "vitest"
import { getTheme, setTheme, initTheme } from "./theme"

beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute("data-theme")
})

test("defaults to dark with no stored value", () => {
  expect(getTheme()).toBe("dark")
})

test("setTheme persists to localStorage and applies to documentElement", () => {
  setTheme("light")
  expect(localStorage.getItem("oc-artifacts-theme")).toBe("light")
  expect(document.documentElement.dataset.theme).toBe("light")
  expect(getTheme()).toBe("light")
})

test("initTheme applies the stored value", () => {
  localStorage.setItem("oc-artifacts-theme", "light")
  initTheme()
  expect(document.documentElement.dataset.theme).toBe("light")
})

test("initTheme applies dark when nothing is stored", () => {
  initTheme()
  expect(document.documentElement.dataset.theme).toBe("dark")
})
