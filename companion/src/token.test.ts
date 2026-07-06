import { test, expect, afterEach, beforeEach } from "vitest"
import { initToken, getToken } from "./token"

beforeEach(() => {
  localStorage.clear()
  window.history.replaceState(null, "", "/")
})
afterEach(() => localStorage.clear())

test("initToken captures ?token= into localStorage and strips it from the URL", () => {
  window.history.replaceState(null, "", "/artifacts/abc?token=secret123&keep=1")
  initToken()
  expect(getToken()).toBe("secret123")
  expect(localStorage.getItem("oc-artifacts-token")).toBe("secret123")
  // token removed, other params preserved
  expect(window.location.search).toBe("?keep=1")
  expect(window.location.pathname).toBe("/artifacts/abc")
})

test("getToken returns a previously stored token when no query param is present", () => {
  localStorage.setItem("oc-artifacts-token", "stored")
  initToken()
  expect(getToken()).toBe("stored")
  expect(window.location.search).toBe("")
})

test("getToken is null when nothing is provided or stored", () => {
  initToken()
  expect(getToken()).toBeNull()
})
