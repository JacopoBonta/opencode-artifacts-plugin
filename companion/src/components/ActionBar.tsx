import React from "react"

export function ActionBar(props: {
  onApprove: () => void
  onRequestChanges: () => void
  disabled?: boolean
  note?: string
}) {
  return (
    <div className="action-bar">
      {props.note && <p className="action-note">{props.note}</p>}
      <div className="action-buttons">
        <button onClick={props.onApprove} disabled={props.disabled}>Approve</button>
        <button onClick={props.onRequestChanges} disabled={props.disabled}>Request changes</button>
      </div>
    </div>
  )
}
