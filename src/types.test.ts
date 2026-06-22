import { test, expect } from "bun:test"
import { isPlan, type Artifact } from "./types"

test("isPlan narrows by type", () => {
  const a: Artifact = {
    id: "x", type: "plan", title: "T", status: "awaiting_review",
    currentRevision: 1, createdAt: 0, updatedAt: 0,
  }
  expect(isPlan(a)).toBe(true)
  expect(isPlan({ ...a, type: "report" })).toBe(false)
})
