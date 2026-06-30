interface StatusStripProps {
  status?: { state: "working" | "idle"; message: string }
}

/**
 * A permanent footer line at the bottom of the explorer rail that recaps what
 * the agent is doing right now ("Editing server.ts", "Running tests", …). It is
 * always visible: when there's no active work (the agent is parked awaiting a
 * verdict, or idle) it shows a dim, static "Idle" line rather than vanishing.
 */
export function StatusStrip({ status }: StatusStripProps) {
  const working = status?.state === "working" && !!status.message
  return (
    <div className={`status-strip${working ? "" : " idle"}`} role="status" aria-live="polite">
      <span className="status-strip-dot" aria-hidden="true" />
      <span className="status-strip-text">{working ? status!.message : "Idle"}</span>
    </div>
  )
}
