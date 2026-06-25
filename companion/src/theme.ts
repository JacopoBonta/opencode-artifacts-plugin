import { readStored, writeStored } from "./storage"

export type Theme = "dark" | "light"

const KEY = "oc-artifacts-theme"

export function getTheme(): Theme {
  return readStored(KEY) === "light" ? "light" : "dark"
}

export function setTheme(t: Theme): void {
  writeStored(KEY, t)
  document.documentElement.dataset.theme = t
}

export function initTheme(): void {
  setTheme(getTheme())
}
