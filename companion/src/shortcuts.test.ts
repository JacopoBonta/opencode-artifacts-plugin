import { test, expect, vi, afterEach } from "vitest"
import { renderHook, fireEvent } from "@testing-library/react"
import { useShortcuts } from "./shortcuts"

afterEach(() => { document.body.replaceChildren() })

test("'?' triggers onHelp", () => {
  const onHelp = vi.fn()
  renderHook(() => useShortcuts({ onHelp }))
  fireEvent.keyDown(window, { key: "?" })
  expect(onHelp).toHaveBeenCalledTimes(1)
})

test("single-key shortcuts are ignored while typing in an input", () => {
  const onHelp = vi.fn()
  renderHook(() => useShortcuts({ onHelp }))
  const input = document.createElement("input")
  document.body.appendChild(input)
  input.focus()
  fireEvent.keyDown(input, { key: "?" })
  expect(onHelp).not.toHaveBeenCalled()
})

test("while the palette is open only Cmd/Ctrl-K and Escape pass through", () => {
  const onHelp = vi.fn()
  const onEscape = vi.fn()
  renderHook(() => useShortcuts({ paletteOpen: true, onHelp, onEscape }))
  fireEvent.keyDown(window, { key: "?" })
  expect(onHelp).not.toHaveBeenCalled()
  fireEvent.keyDown(window, { key: "Escape" })
  expect(onEscape).toHaveBeenCalled()
})
