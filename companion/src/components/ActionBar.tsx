import React from "react"

export function ActionBar(props: {
  type: "plan" | "report"
  onApprove: () => void
  onRequestChanges: () => void
  onRefine: () => void
}) {
  if (props.type === "report") {
    return (
      <div className="action-bar">
        <button onClick={props.onRefine}>Request refinement</button>
      </div>
    )
  }
  return (
    <div className="action-bar">
      <button onClick={props.onApprove}>Approve</button>
      <button onClick={props.onRequestChanges}>Request changes</button>
    </div>
  )
}
