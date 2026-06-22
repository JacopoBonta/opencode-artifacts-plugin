import { test, expect } from "vitest"
import { anchorFromOffsets, findAnchorOffsets } from "./anchor-dom"

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
