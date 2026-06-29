// Persisted layout preferences (reading width + side-rail widths), following the
// same localStorage + documentElement.dataset pattern as theme.ts.

import { readStored, writeStored } from "./storage"

export type ReadingWidth = "comfortable" | "stretched"

const READING_KEY = "oc-artifacts-reading"
const LEFT_KEY = "oc-artifacts-rail-left"
const RIGHT_KEY = "oc-artifacts-rail-right"
const TABS_KEY = "oc-artifacts-open-tabs"
const ACTIVE_TAB_KEY = "oc-artifacts-active-tab"

// Defaults match the original fixed grid columns.
export const RAIL_LEFT_DEFAULT = 264
export const RAIL_RIGHT_DEFAULT = 340
export const RAIL_LEFT_MIN = 200
export const RAIL_LEFT_MAX = 480
export const RAIL_RIGHT_MIN = 260
export const RAIL_RIGHT_MAX = 560

export function clampLeft(px: number): number {
  return Math.min(RAIL_LEFT_MAX, Math.max(RAIL_LEFT_MIN, Math.round(px)))
}
export function clampRight(px: number): number {
  return Math.min(RAIL_RIGHT_MAX, Math.max(RAIL_RIGHT_MIN, Math.round(px)))
}

export function getReadingWidth(): ReadingWidth {
  return readStored(READING_KEY) === "stretched" ? "stretched" : "comfortable"
}

export function setReadingWidth(w: ReadingWidth): void {
  writeStored(READING_KEY, w)
  document.documentElement.dataset.reading = w
}

// Open editor tabs (artifact ids, in open order) and the active tab — persisted
// so reopening the companion restores the workspace, IDE-style. Ids that no
// longer exist are pruned by App once the artifact list loads.
export function getOpenTabs(): string[] {
  const raw = readStored(TABS_KEY)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : []
  } catch {
    return []
  }
}

export function setOpenTabs(ids: string[]): void {
  writeStored(TABS_KEY, JSON.stringify(ids))
}

export function getActiveTab(): string | undefined {
  return readStored(ACTIVE_TAB_KEY) || undefined
}

export function setActiveTab(id: string | undefined): void {
  writeStored(ACTIVE_TAB_KEY, id ?? "")
}

function readWidth(key: string, fallback: number, clamp: (n: number) => number): number {
  const raw = Number(readStored(key))
  return Number.isFinite(raw) && raw > 0 ? clamp(raw) : fallback
}

export function getRailLeft(): number {
  return readWidth(LEFT_KEY, RAIL_LEFT_DEFAULT, clampLeft)
}
export function getRailRight(): number {
  return readWidth(RIGHT_KEY, RAIL_RIGHT_DEFAULT, clampRight)
}
export function setRailLeft(px: number): number {
  const v = clampLeft(px)
  writeStored(LEFT_KEY, String(v))
  return v
}
export function setRailRight(px: number): number {
  const v = clampRight(px)
  writeStored(RIGHT_KEY, String(v))
  return v
}

/** Apply persisted reading width on startup (rail widths are applied by App). */
export function initLayoutPrefs(): void {
  setReadingWidth(getReadingWidth())
}
