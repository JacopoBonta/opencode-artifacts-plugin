/**
 * Capability token handling. The backend opens the browser at `/?token=…`; we
 * capture that token once, persist it to localStorage so new tabs/reloads in
 * this same browser profile stay authenticated, and strip it from the URL so
 * it doesn't linger in the address bar or browser history. Every API call
 * then sends it (see api.ts), which is what authenticates the companion to the
 * loopback-bound server. Incognito/private windows keep their own isolated
 * storage regardless — they need a fresh `?token=` link (e.g. from the
 * `open_companion` tool) to authenticate.
 */

const KEY = "oc-artifacts-token"

function read(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

function write(value: string): void {
  try {
    localStorage.setItem(KEY, value)
  } catch {
    /* localStorage unavailable — token stays in memory only for this load */
  }
}

let memo: string | null = null

/**
 * Capture a `?token=` query param into localStorage (and memory) and remove it
 * from the visible URL. Idempotent and safe to call when no token is present
 * (e.g. a token-less dev backend) — it simply leaves any existing stored token.
 */
export function initToken(): void {
  memo = read()
  try {
    const params = new URLSearchParams(window.location.search)
    const fromUrl = params.get("token")
    if (fromUrl) {
      memo = fromUrl
      write(fromUrl)
      params.delete("token")
      const qs = params.toString()
      const clean = window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash
      window.history.replaceState(null, "", clean)
    }
  } catch {
    /* no DOM/history (non-browser env) — nothing to capture */
  }
}

/** The current capability token, or null if none was provided. */
export function getToken(): string | null {
  return memo ?? read()
}
