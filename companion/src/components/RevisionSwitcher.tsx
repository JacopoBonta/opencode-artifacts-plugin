import React from "react"

export function RevisionSwitcher(props: {
  total: number              // total number of revisions (M)
  viewing: number            // currently viewed revision (1..M)
  onSelect: (n: number) => void
}) {
  if (props.total <= 1) return null
  const options = Array.from({ length: props.total }, (_, i) => i + 1)
  return (
    <select
      className="revision-switcher"
      aria-label="Revision"
      value={props.viewing}
      onChange={(e) => props.onSelect(Number(e.target.value))}
    >
      {options.map((n) => (
        <option key={n} value={n}>
          Revision {n} of {props.total}
        </option>
      ))}
    </select>
  )
}
