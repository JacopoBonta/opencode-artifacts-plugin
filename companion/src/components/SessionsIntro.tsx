import React from "react"
import type { SessionSummary } from "./ArtifactList"

/**
 * Landing page shown when no session is focused (e.g. the companion was opened
 * standalone with no live opencode session). Lists recent sessions; picking one
 * focuses it and drops into the normal artifact view.
 */
export function SessionsIntro(props: {
  sessions: SessionSummary[]
  onPick: (key: string) => void
  /** the live opencode session, highlighted so it stands out among recents */
  activeSessionID?: string
}) {
  if (props.sessions.length === 0) {
    return <p className="empty">No artifacts yet.</p>
  }
  return (
    <div className="sessions-intro">
      <h1>Sessions</h1>
      <p className="sessions-intro-sub">
        Pick a session to view its plans and reports.
      </p>
      <ul className="session-cards">
        {props.sessions.map((s) => {
          const isCurrent = props.activeSessionID != null && s.key === props.activeSessionID
          return (
            <li key={s.key}>
              <button
                type="button"
                className={`session-card${isCurrent ? " current" : ""}`}
                onClick={() => props.onPick(s.key)}
              >
                <span className="session-card-title">{s.label}</span>
                {s.hasUnseen && <span className="activity-dot" title="New activity" />}
                {isCurrent && <span className="current-badge">current</span>}
                <span className="session-card-meta">
                  {s.count} artifact{s.count === 1 ? "" : "s"}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
