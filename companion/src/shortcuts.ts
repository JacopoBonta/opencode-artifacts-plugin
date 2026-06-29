import { useEffect, useRef } from "react"

export interface ShortcutConfig {
  /** the palette owns the keyboard while open, so only Cmd/Ctrl-K + Esc pass through */
  paletteOpen?: boolean
  onPaletteToggle?: () => void
  onEscape?: () => void
  onTreeUp?: () => void
  onTreeDown?: () => void
  onOpenSelected?: () => void
  onNextTab?: () => void
  onPrevTab?: () => void
  onCloseTab?: () => void
  onApprove?: () => void
  onComment?: () => void
}

// Single-key shortcuts must not fire while the user is typing or has an
// interactive control focused (so `a` in a comment, or Enter on a button, behaves
// normally).
function shouldIgnore(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el || !el.tagName) return false
  if (el.isContentEditable) return true
  return ["INPUT", "TEXTAREA", "SELECT", "BUTTON", "A"].includes(el.tagName)
}

/**
 * Global keyboard layer. Subscribes once and reads the latest config from a ref,
 * so handlers can close over fresh state without re-binding the listener.
 */
export function useShortcuts(config: ShortcutConfig): void {
  const ref = useRef(config)
  ref.current = config

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const c = ref.current
      const mod = e.metaKey || e.ctrlKey

      if (mod && (e.key === "k" || e.key === "K")) {
        e.preventDefault()
        c.onPaletteToggle?.()
        return
      }
      if (e.key === "Escape") {
        c.onEscape?.()
        return
      }
      // The palette handles its own arrows/enter/escape; stay out of its way.
      if (c.paletteOpen) return
      if (e.metaKey || e.ctrlKey || e.altKey || shouldIgnore(e.target)) return

      switch (e.key) {
        case "j": c.onTreeDown?.(); break
        case "k": c.onTreeUp?.(); break
        case "Enter": c.onOpenSelected?.(); break
        case "]": c.onNextTab?.(); break
        case "[": c.onPrevTab?.(); break
        case "w": c.onCloseTab?.(); break
        case "a": c.onApprove?.(); break
        case "c": c.onComment?.(); break
        default: return
      }
      e.preventDefault()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])
}
