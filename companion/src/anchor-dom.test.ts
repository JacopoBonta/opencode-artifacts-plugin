import { test, expect } from "vitest"
import { anchorFromOffsets, findAnchorOffsets, selectionOffsets } from "./anchor-dom"

const TEXT = "Alpha beta gamma. Alpha beta delta. The end."

test("anchorFromOffsets builds quote + context", () => {
  const a = anchorFromOffsets(TEXT, 18, 34)
  expect(a.quote).toBe("Alpha beta delta")
  expect(a.prefix.length).toBeGreaterThan(0)
})

test("findAnchorOffsets locates the anchor again", () => {
  const a = anchorFromOffsets(TEXT, 18, 34)
  expect(findAnchorOffsets(TEXT, a)).toEqual({ start: 18, end: 34 })
})

test("findAnchorOffsets returns null when orphaned", () => {
  const a = anchorFromOffsets(TEXT, 18, 34)
  expect(findAnchorOffsets("nothing here", a)).toBeNull()
})

test("selectionOffsets computes plain-text offset across multiple nodes", () => {
  const container = document.createElement("div")
  container.innerHTML = "<p>Alpha beta</p><p>gamma delta</p>"
  document.body.appendChild(container)
  // container.textContent === "Alpha betagamma delta"; "delta" starts at 16
  const secondP = container.querySelectorAll("p")[1].firstChild!
  const range = document.createRange()
  range.setStart(secondP, 6) // start of "delta" within "gamma delta"
  range.setEnd(secondP, 11)
  expect(selectionOffsets(container, range)).toEqual({ start: 16, end: 21 })
  document.body.removeChild(container)
})

test("selectionOffsets returns null when selection is outside the container", () => {
  const container = document.createElement("div")
  container.textContent = "inside"
  const outside = document.createElement("div")
  outside.textContent = "outside"
  document.body.append(container, outside)
  const range = document.createRange()
  range.selectNodeContents(outside.firstChild!)
  expect(selectionOffsets(container, range)).toBeNull()
  document.body.removeChild(container)
  document.body.removeChild(outside)
})
