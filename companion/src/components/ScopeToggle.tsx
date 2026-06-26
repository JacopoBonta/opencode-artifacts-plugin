import React from "react"
import type { Scope } from "../layoutPrefs"

/**
 * Segmented control switching the rail between the focused session's artifacts
 * ("This session") and every session's artifacts ("All"). Controlled: the scope
 * lives in App because it also drives which artifacts render, so this component
 * only reflects and reports changes (App persists them).
 */
export function ScopeToggle(props: { scope: Scope; onChange: (s: Scope) => void }) {
  return (
    <div className="scope-toggle" role="group" aria-label="Artifact scope">
      <button
        type="button"
        className={props.scope === "session" ? "active" : ""}
        aria-pressed={props.scope === "session"}
        onClick={() => props.onChange("session")}
      >
        This session
      </button>
      <button
        type="button"
        className={props.scope === "all" ? "active" : ""}
        aria-pressed={props.scope === "all"}
        onClick={() => props.onChange("all")}
      >
        All
      </button>
    </div>
  )
}
