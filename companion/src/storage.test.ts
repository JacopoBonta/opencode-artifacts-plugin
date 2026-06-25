import { test, expect, vi, afterEach } from "vitest"
import { readStored, writeStored } from "./storage"

afterEach(() => vi.restoreAllMocks())

test("readStored/writeStored round-trip a value", () => {
  writeStored("k", "v")
  expect(readStored("k")).toBe("v")
})

test("readStored returns null when localStorage throws", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("SecurityError")
  })
  expect(readStored("k")).toBeNull()
})

test("writeStored does not throw when localStorage throws", () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("SecurityError")
  })
  expect(() => writeStored("k", "v")).not.toThrow()
})
