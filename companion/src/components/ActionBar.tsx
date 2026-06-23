import React from "react"

export function ActionBar(props: {
  onApprove: () => void
  onRequestChanges: () => void
}) {
  return (
    <div className="action-bar">
      <button onClick={props.onApprove}>Approve</button>
      <button onClick={props.onRequestChanges}>Request changes</button>
    </div>
  )
}
