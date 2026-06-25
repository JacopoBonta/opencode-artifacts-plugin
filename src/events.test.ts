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

test("a throwing listener does not starve others and is dropped", () => {
  const b = createBroadcaster()
  const got: string[] = []
  // First listener throws (e.g. a closed SSE stream); the second must still get it.
  b.subscribe(() => {
    throw new Error("dead stream")
  })
  b.subscribe((d) => got.push(d))
  b.broadcast({ type: "ping" })
  expect(got).toHaveLength(1)
  // The throwing listener was dropped, leaving only the healthy one.
  expect(b.count()).toBe(1)
  b.broadcast({ type: "ping" })
  expect(got).toHaveLength(2)
})

test("unsubscribe stops delivery and count tracks subscribers", () => {
  const b = createBroadcaster()
  const un = b.subscribe(() => {})
  expect(b.count()).toBe(1)
  un()
  expect(b.count()).toBe(0)
})
