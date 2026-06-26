import { test, expect, beforeEach } from "vitest"
import {
  getReadingWidth, setReadingWidth,
  getScope, setScope,
  getRailLeft, setRailLeft, getRailRight, setRailRight,
  clampLeft, clampRight,
  RAIL_LEFT_DEFAULT, RAIL_RIGHT_DEFAULT,
  RAIL_LEFT_MIN, RAIL_LEFT_MAX, RAIL_RIGHT_MIN, RAIL_RIGHT_MAX,
} from "./layoutPrefs"

beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute("data-reading")
})

test("reading width defaults to comfortable and round-trips, applying the dataset", () => {
  expect(getReadingWidth()).toBe("comfortable")
  setReadingWidth("stretched")
  expect(getReadingWidth()).toBe("stretched")
  expect(document.documentElement.dataset.reading).toBe("stretched")
})

test("scope defaults to session and round-trips through storage", () => {
  expect(getScope()).toBe("session")
  setScope("all")
  expect(getScope()).toBe("all")
  setScope("session")
  expect(getScope()).toBe("session")
})

test("rail widths default to the original grid columns", () => {
  expect(getRailLeft()).toBe(RAIL_LEFT_DEFAULT)
  expect(getRailRight()).toBe(RAIL_RIGHT_DEFAULT)
})

test("rail widths persist and are clamped on read and write", () => {
  expect(setRailLeft(10_000)).toBe(RAIL_LEFT_MAX)
  expect(getRailLeft()).toBe(RAIL_LEFT_MAX)
  expect(setRailRight(0)).toBe(RAIL_RIGHT_MIN)
  expect(getRailRight()).toBe(RAIL_RIGHT_MIN)

  setRailLeft(300)
  expect(getRailLeft()).toBe(300)
})

test("clamp helpers respect the min/max bounds", () => {
  expect(clampLeft(50)).toBe(RAIL_LEFT_MIN)
  expect(clampLeft(9999)).toBe(RAIL_LEFT_MAX)
  expect(clampRight(50)).toBe(RAIL_RIGHT_MIN)
  expect(clampRight(9999)).toBe(RAIL_RIGHT_MAX)
})
