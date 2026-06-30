import React, { useEffect } from "react"
import type { Toast } from "../toasts"

function ToastItem({ t, onDismiss }: { t: Toast; onDismiss: (id: number) => void }) {
  useEffect(() => {
    // Actionable toasts (with a Retry) stay until the user acts or dismisses;
    // informational ones auto-dismiss (errors linger a little longer).
    if (t.action) return
    const ms = t.kind === "error" ? 6000 : 3500
    const timer = setTimeout(() => onDismiss(t.id), ms)
    return () => clearTimeout(timer)
  }, [t, onDismiss])

  return (
    <div className={`toast toast-${t.kind}`}>
      <span className="toast-msg">{t.message}</span>
      {t.action && (
        <button
          type="button"
          className="toast-action"
          onClick={() => { t.action!.onClick(); onDismiss(t.id) }}
        >
          {t.action.label}
        </button>
      )}
      <button type="button" className="toast-close" aria-label="Dismiss" onClick={() => onDismiss(t.id)}>
        ×
      </button>
    </div>
  )
}

/** Fixed, screen-reader-announced stack of transient notifications. */
export function Toaster({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  return (
    <div className="toaster" role="status" aria-live="polite">
      {toasts.map((t) => (
        <ToastItem key={t.id} t={t} onDismiss={onDismiss} />
      ))}
    </div>
  )
}
