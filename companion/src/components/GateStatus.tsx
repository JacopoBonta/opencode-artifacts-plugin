import type { GateInfo } from "../api"

interface GateStatusProps {
  info?: GateInfo
  onUnlock: () => void
  onRelock: () => void
  busy?: boolean
}

/**
 * A permanent row above the status strip showing whether file edits are
 * currently unblocked, and why. A closed gate can be force-opened from here
 * (bypassing the normal plan-approval flow); a gate the human force-opened
 * can be re-locked. A gate that's open because a plan was genuinely approved
 * offers no button — this escape hatch only ever opens what the workflow
 * says is closed, never closes what it says is open.
 */
export function GateStatus({ info, onUnlock, onRelock, busy }: GateStatusProps) {
  if (!info) return null
  const open = info.state === "open"
  return (
    <div className={`gate-status gate-${info.state}`} role="status" aria-live="polite">
      <span className="gate-status-dot" aria-hidden="true" />
      <span className="gate-status-text">
        {open ? "Gate open" : "Gate closed"} — {info.reason}
      </span>
      {!open && (
        <button type="button" className="gate-status-btn" onClick={onUnlock} disabled={busy}>
          Unlock
        </button>
      )}
      {open && info.forced && (
        <button type="button" className="gate-status-btn" onClick={onRelock} disabled={busy}>
          Re-lock
        </button>
      )}
    </div>
  )
}
