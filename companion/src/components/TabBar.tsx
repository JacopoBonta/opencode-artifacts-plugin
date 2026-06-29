import React from "react"
import type { Artifact } from "../api"

/** Editor-style tab strip for the open artifacts. Active tab is highlighted; a
 * tab shows an unseen dot when its artifact updated while it wasn't focused. */
export function TabBar(props: {
  tabs: Artifact[]
  activeId?: string
  unseenIds?: Set<string>
  onActivate: (id: string) => void
  onClose: (id: string) => void
}) {
  const unseen = props.unseenIds ?? new Set<string>()
  return (
    <div className="tab-bar" role="tablist">
      {props.tabs.map((a) => {
        const badgeType = a.isRoadmap ? "roadmap" : a.type
        const isActive = a.id === props.activeId
        return (
          <div
            key={a.id}
            role="tab"
            aria-selected={isActive}
            className={`tab${isActive ? " active" : ""}`}
            onClick={() => props.onActivate(a.id)}
            onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); props.onClose(a.id) } }}
            title={a.title}
          >
            <span className={`tab-badge badge-${badgeType}`} />
            <span className="tab-title">{a.title}</span>
            {unseen.has(a.id) && <span className="activity-dot" title="New activity" />}
            <button
              type="button"
              className="tab-close"
              aria-label={`Close ${a.title}`}
              onClick={(e) => { e.stopPropagation(); props.onClose(a.id) }}
            >
              ×
            </button>
          </div>
        )
      })}
    </div>
  )
}
