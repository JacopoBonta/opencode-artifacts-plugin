import { test, expect } from "bun:test"
import { createBroadcaster } from "./events"

test("broadcast delivers to all subscribers", () => {
  const b = createBroadcaster()
  const got: string[] = []
  const un1 = b.subscribe((d) => got.push("a:" + d))
  b.subscribe((d) => got.push("b:" + d))
  b.broadcast({ type: "artifact.published", id: "x" })
  expect(got).toEqual([
    'a:{"type":"artifact.published","id":"x"}',
    'b:{"type":"artifact.published","id":"x"}',
  ])
  un1()
  b.broadcast({ type: "ping" })
  expect(got.filter((g) => g.startsWith("a:"))).toHaveLength(1)
})

test("unsubscribe stops delivery and count tracks subscribers", () => {
  const b = createBroadcaster()
  const un = b.subscribe(() => {})
  expect(b.count()).toBe(1)
  un()
  expect(b.count()).toBe(0)
})
