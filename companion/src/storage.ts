// localStorage access can throw (privacy mode, sandboxed iframe with storage
// disabled). These wrappers degrade to a no-op / null so a storage failure never
// crashes the app at mount (getTheme/getRailLeft run in useState initializers).

export function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* storage unavailable — ignore */
  }
}
