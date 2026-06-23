export type Theme = "dark" | "light"

const KEY = "oc-artifacts-theme"

export function getTheme(): Theme {
  return localStorage.getItem(KEY) === "light" ? "light" : "dark"
}

export function setTheme(t: Theme): void {
  localStorage.setItem(KEY, t)
  document.documentElement.dataset.theme = t
}

export function initTheme(): void {
  setTheme(getTheme())
}
