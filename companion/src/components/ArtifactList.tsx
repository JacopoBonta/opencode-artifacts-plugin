import React, { useState } from "react"
import type { Artifact } from "../api"

interface Group { key: string; label: string; artifacts: Artifact[]; latest: number }

function groupBySession(artifacts: Artifact[]): Group[] {
  const map = new Map<string, Artifact[]>()
  for (const a of artifacts) {
    const key = a.sessionID ?? "__ungrouped__"
    const list = map.get(key) ?? []
    list.push(a)
    map.set(key, list)
  }
  const groups: Group[] = []
  for (const [key, list] of map) {
    const label =
      key === "__ungrouped__"
        ? "Ungrouped"
        : list.find((a) => a.sessionTitle)?.sessionTitle ?? `Session ${key.slice(-6)}`
    const latest = Math.max(...list.map((a) => a.updatedAt))
    groups.push({ key, label, artifacts: list, latest })
  }
  groups.sort((a, b) => b.latest - a.latest)
  return groups
}

export function ArtifactList(props: {
  artifacts: Artifact[]
  selectedId?: string
  onSelect: (id: string) => void
}) {
  const groups = groupBySession(props.artifacts)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  const selectedKey =
    props.artifacts.find((a) => a.id === props.selectedId)?.sessionID ?? "__ungrouped__"

  function isOpen(g: Group): boolean {
    // Explicit user choice wins; otherwise expand the selected group only.
    if (g.key in collapsed) return !collapsed[g.key]
    return g.key === selectedKey
  }

  return (
    <div className="artifact-groups">
      {groups.map((g) => {
        const open = isOpen(g)
        return (
          <div key={g.key} className="artifact-group">
            <button
              type="button"
              className="group-header"
              aria-expanded={open}
              onClick={() => setCollapsed((c) => ({ ...c, [g.key]: open }))}
            >
              <span className="group-chevron">{open ? "▾" : "▸"}</span>
              <span className="group-title">{g.label}</span>
              <span className="group-count">{g.artifacts.length}</span>
            </button>
            {open && (
              <ul className="artifact-list">
                {g.artifacts.map((a) => (
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
            )}
          </div>
        )
      })}
    </div>
  )
}
