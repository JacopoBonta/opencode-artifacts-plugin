import { test, expect } from "bun:test"
import { makeAnchor, matchAnchor } from "./anchor"

const TEXT = "Alpha beta gamma. Alpha beta delta. The end."

test("makeAnchor captures quote with surrounding context", () => {
  const a = makeAnchor(TEXT, 18, 34) // "Alpha beta delta"
  expect(a.quote).toBe("Alpha beta delta")
  expect(TEXT.endsWith(a.suffix) || TEXT.includes(a.suffix)).toBe(true)
  expect(a.prefix.length).toBeGreaterThan(0)
})

test("matchAnchor finds unique quote", () => {
  const a = makeAnchor(TEXT, 18, 34)
  const m = matchAnchor(TEXT, a)
  expect(m).toEqual({ start: 18, end: 34 })
})

test("matchAnchor disambiguates duplicate quotes via context", () => {
  const a = makeAnchor(TEXT, 0, 10) // first "Alpha beta"
  const m = matchAnchor(TEXT, a)
  expect(m).toEqual({ start: 0, end: 10 })
})

test("matchAnchor returns null (orphaned) when quote is gone", () => {
  const a = makeAnchor(TEXT, 0, 10)
  expect(matchAnchor("completely different content", a)).toBeNull()
})
