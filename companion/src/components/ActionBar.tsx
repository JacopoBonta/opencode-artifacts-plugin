import React, { useState } from "react"

export function ActionBar(props: {
  onApprove: () => void
  onRequestChanges: () => void
  onDecline: (reason?: string) => void
  disabled?: boolean
  note?: string
}) {
  // Declining is destructive (it stops the agent), so it's a two-step action:
  // reveal an optional reason field, then confirm. The reason is optional.
  const [declining, setDeclining] = useState(false)
  const [reason, setReason] = useState("")

  function confirmDecline() {
    props.onDecline(reason.trim() || undefined)
    setDeclining(false)
    setReason("")
  }

  return (
    <div className="action-bar">
      {props.note && <p className="action-note">{props.note}</p>}
      {declining ? (
        <div className="decline-form">
          <textarea
            className="decline-reason"
            placeholder="Reason for declining (optional)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            autoFocus
          />
          <div className="action-buttons">
            <button className="decline-confirm" onClick={confirmDecline} disabled={props.disabled}>
              Confirm decline
            </button>
            <button
              onClick={() => {
                setDeclining(false)
                setReason("")
              }}
              disabled={props.disabled}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="action-buttons">
          <button onClick={props.onApprove} disabled={props.disabled}>Approve</button>
          <button onClick={props.onRequestChanges} disabled={props.disabled}>Request changes</button>
          <button
            className="decline-btn"
            onClick={() => setDeclining(true)}
            disabled={props.disabled}
            title="Reject the plan and stop the agent"
          >
            Decline
          </button>
        </div>
      )}
    </div>
  )
}
