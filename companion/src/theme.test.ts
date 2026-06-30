import { test, expect, beforeEach, afterEach, vi } from "vitest"
import { getThemeChoice, setThemeChoice, resolveTheme, initTheme } from "./theme"

beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute("data-theme")
})
afterEach(() => vi.unstubAllGlobals())

/** Stub window.matchMedia so "(prefers-color-scheme: dark)" reports `dark`. */
function stubSystemDark(dark: boolean) {
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: dark && q.includes("dark"),
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
}

test("defaults to system with no stored value", () => {
  expect(getThemeChoice()).toBe("system")
})

test("setThemeChoice persists the choice and applies the resolved theme", () => {
  setThemeChoice("light")
  expect(localStorage.getItem("oc-artifacts-theme")).toBe("light")
  expect(document.documentElement.dataset.theme).toBe("light")
  expect(getThemeChoice()).toBe("light")
})

test("system resolves via prefers-color-scheme", () => {
  stubSystemDark(true)
  expect(resolveTheme("system")).toBe("dark")
  stubSystemDark(false)
  expect(resolveTheme("system")).toBe("light")
})

test("system choice applies the OS theme on init", () => {
  stubSystemDark(true)
  initTheme()
  expect(document.documentElement.dataset.theme).toBe("dark")
})

test("resolveTheme falls back to light when matchMedia is unavailable", () => {
  // jsdom has no matchMedia by default; resolveTheme must not throw.
  expect(resolveTheme("system")).toBe("light")
})
