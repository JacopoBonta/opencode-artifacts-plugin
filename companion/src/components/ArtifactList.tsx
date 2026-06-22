import React from "react"
import type { Artifact } from "../api"

export function ArtifactList(props: {
  artifacts: Artifact[]
  selectedId?: string
  onSelect: (id: string) => void
}) {
  return (
    <ul className="artifact-list">
      {props.artifacts.map((a) => (
        <li
          key={a.id}
          className={a.id === props.selectedId ? "selected" : ""}
          onClick={() => props.onSelect(a.id)}
        >
          <span className={`badge badge-${a.type}`}>{a.type}</span>
          <span className="title">{a.title}</span>
          <span className={`status status-${a.status}`}>{a.status.replace(/_/g, " ")}</span>
        </li>
      ))}
    </ul>
  )
}
