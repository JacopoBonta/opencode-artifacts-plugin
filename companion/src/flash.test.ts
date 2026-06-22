import { test, expect, vi, beforeEach, afterEach } from "vitest"
import { flashElement } from "./flash"

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

test("adds .flash then removes it after the timer", () => {
  const el = document.createElement("div")
  flashElement(el)
  expect(el.classList.contains("flash")).toBe(true)
  vi.advanceTimersByTime(1200)
  expect(el.classList.contains("flash")).toBe(false)
})

test("is a no-op for null", () => {
  expect(() => flashElement(null)).not.toThrow()
})

test("calls scrollIntoView when available", () => {
  const el = document.createElement("div")
  const spy = vi.fn()
  ;(el as unknown as { scrollIntoView: () => void }).scrollIntoView = spy
  flashElement(el)
  expect(spy).toHaveBeenCalled()
})
