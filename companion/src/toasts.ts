import { useCallback, useRef, useState } from "react"

export type ToastKind = "success" | "error"
export interface ToastAction { label: string; onClick: () => void }
export interface Toast { id: number; kind: ToastKind; message: string; action?: ToastAction }

/**
 * Minimal toast queue. `push` appends a transient notification; `dismiss` removes
 * one. Auto-dismiss timing lives in the Toaster component (per-item), so an
 * actionable toast (with a Retry button) can stay until the user acts.
 */
export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([])
  const seq = useRef(0)
  const dismiss = useCallback((id: number) => {
    setToasts((ts) => ts.filter((t) => t.id !== id))
  }, [])
  const push = useCallback((kind: ToastKind, message: string, action?: ToastAction) => {
    const id = ++seq.current
    setToasts((ts) => [...ts, { id, kind, message, action }])
    return id
  }, [])
  return { toasts, push, dismiss }
}
