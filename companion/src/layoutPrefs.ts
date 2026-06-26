// Persisted layout preferences (reading width + side-rail widths), following the
// same localStorage + documentElement.dataset pattern as theme.ts.

import { readStored, writeStored } from "./storage"

export type ReadingWidth = "comfortable" | "stretched"
// "session" shows only the focused session's artifacts; "all" shows every session.
export type Scope = "session" | "all"

const READING_KEY = "oc-artifacts-reading"
const SCOPE_KEY = "oc-artifacts-scope"
const LEFT_KEY = "oc-artifacts-rail-left"
const RIGHT_KEY = "oc-artifacts-rail-right"

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

// Default to "session": the rail opens focused on the current session, which is
// what the user wants most of the time. Other sessions are one click away.
export function getScope(): Scope {
  return readStored(SCOPE_KEY) === "all" ? "all" : "session"
}

export function setScope(s: Scope): void {
  writeStored(SCOPE_KEY, s)
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
