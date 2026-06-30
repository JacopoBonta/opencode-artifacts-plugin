import { readStored, writeStored } from "./storage"

/** The user's choice. "system" follows the OS via prefers-color-scheme. */
export type ThemeChoice = "system" | "light" | "dark"
type Resolved = "light" | "dark"

const KEY = "oc-artifacts-theme"

export function getThemeChoice(): ThemeChoice {
  const v = readStored(KEY)
  return v === "light" || v === "dark" || v === "system" ? v : "system"
}

/** The current OS preference, defaulting to light where matchMedia is absent. */
function systemTheme(): Resolved {
  return typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light"
}

/** Resolve a choice to a concrete theme to apply. */
export function resolveTheme(choice: ThemeChoice = getThemeChoice()): Resolved {
  return choice === "system" ? systemTheme() : choice
}

export function setThemeChoice(choice: ThemeChoice): void {
  writeStored(KEY, choice)
  document.documentElement.dataset.theme = resolveTheme(choice)
}

export function initTheme(): void {
  setThemeChoice(getThemeChoice())
  // Track OS changes live while the choice is "system" (no FOUC: the initial
  // value was applied synchronously above, before React renders).
  if (typeof matchMedia !== "undefined") {
    const mq = matchMedia("(prefers-color-scheme: dark)")
    mq.addEventListener?.("change", () => {
      if (getThemeChoice() === "system") document.documentElement.dataset.theme = systemTheme()
    })
  }
}
