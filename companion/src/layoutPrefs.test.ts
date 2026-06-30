import { test, expect, beforeEach } from "vitest"
import {
  getReadingWidth, setReadingWidth,
  getOpenTabs, setOpenTabs, getActiveTab, setActiveTab,
  getCollapsed, setCollapsed,
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

test("open tabs default to empty and round-trip as a JSON array", () => {
  expect(getOpenTabs()).toEqual([])
  setOpenTabs(["a", "b", "c"])
  expect(getOpenTabs()).toEqual(["a", "b", "c"])
  setOpenTabs([])
  expect(getOpenTabs()).toEqual([])
})

test("a corrupt open-tabs value degrades to empty", () => {
  localStorage.setItem("oc-artifacts-open-tabs", "not json")
  expect(getOpenTabs()).toEqual([])
})

test("active tab round-trips and clears to undefined", () => {
  expect(getActiveTab()).toBeUndefined()
  setActiveTab("a")
  expect(getActiveTab()).toBe("a")
  setActiveTab(undefined)
  expect(getActiveTab()).toBeUndefined()
})

test("collapse state defaults to empty and round-trips as a JSON map", () => {
  expect(getCollapsed()).toEqual({})
  setCollapsed({ "ses:a": true, "rm:1": false })
  expect(getCollapsed()).toEqual({ "ses:a": true, "rm:1": false })
})

test("a corrupt or non-object collapse value degrades to empty", () => {
  localStorage.setItem("oc-artifacts-collapsed", "not json")
  expect(getCollapsed()).toEqual({})
  localStorage.setItem("oc-artifacts-collapsed", "[1,2]")
  expect(getCollapsed()).toEqual({})
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
