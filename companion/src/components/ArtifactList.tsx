import React, { useState } from "react"
import type { Artifact } from "../api"
import type { Scope } from "../layoutPrefs"

interface Group { key: string; label: string; artifacts: Artifact[]; latest: number }

export interface TreeNode { artifact: Artifact; children: Artifact[] }

/** Summary of one session for the intro landing page. */
export interface SessionSummary {
  key: string
  label: string
  count: number
  latest: number
  hasUnseen: boolean
}

const UNGROUPED = "__ungrouped__"

/** The group key an artifact belongs to (its session, or the ungrouped bucket). */
export function sessionKey(a: Artifact): string {
  return a.sessionID ?? UNGROUPED
}

function groupBySession(artifacts: Artifact[]): Group[] {
  const map = new Map<string, Artifact[]>()
  for (const a of artifacts) {
    const key = sessionKey(a)
    const list = map.get(key) ?? []
    list.push(a)
    map.set(key, list)
  }
  const groups: Group[] = []
  for (const [key, list] of map) {
    const label =
      key === UNGROUPED
        ? "Ungrouped"
        : list.find((a) => a.sessionTitle)?.sessionTitle ?? `Session ${key.slice(-6)}`
    const latest = Math.max(...list.map((a) => a.updatedAt))
    groups.push({ key, label, artifacts: list, latest })
  }
  groups.sort((a, b) => b.latest - a.latest)
  return groups
}

/**
 * Recently-active sessions (newest first), for the intro landing page. Excludes
 * archived artifacts. Pure + exported so it can be unit-tested without a DOM.
 */
export function recentSessions(
  artifacts: Artifact[],
  unseen?: Set<string>,
): SessionSummary[] {
  return groupBySession(artifacts.filter((a) => !a.archived)).map((g) => ({
    key: g.key,
    label: g.label,
    count: g.artifacts.length,
    latest: g.latest,
    hasUnseen: g.artifacts.some((a) => unseen?.has(a.id)),
  }))
}

/**
 * Build the 2-level tree for one session group: top-level nodes (standalone
 * plans/reports and roadmaps) with their phase children nested underneath.
 * Children whose parent is absent fall back to the top level. Pure + exported
 * so it can be unit-tested without a DOM.
 */
export function buildTree(artifacts: Artifact[]): TreeNode[] {
  const present = new Set(artifacts.map((a) => a.id))
  const childrenByParent = new Map<string, Artifact[]>()
  for (const a of artifacts) {
    if (a.parentId && present.has(a.parentId)) {
      const list = childrenByParent.get(a.parentId) ?? []
      list.push(a)
      childrenByParent.set(a.parentId, list)
    }
  }
  const byCreated = (a: Artifact, b: Artifact) => a.createdAt - b.createdAt
  return artifacts
    .filter((a) => !a.parentId || !present.has(a.parentId))
    // Top-level: newest first. Phase children keep execution order (oldest first).
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((a) => ({
      artifact: a,
      children: (childrenByParent.get(a.id) ?? []).slice().sort(byCreated),
    }))
}

/** Phase progress for a roadmap node: approved phase plans / total phase plans. */
export function phaseProgress(node: TreeNode): { done: number; total: number } | null {
  if (!node.artifact.isRoadmap) return null
  const plans = node.children.filter((c) => c.type === "plan")
  return { done: plans.filter((c) => c.status === "approved").length, total: plans.length }
}

export function ArtifactList(props: {
  artifacts: Artifact[]
  selectedId?: string
  activeSessionID?: string
  focusedSessionID?: string
  // Omitted defaults to the "all" view (every session grouped).
  scope?: Scope
  unseenIds?: Set<string>
  onSelect: (id: string) => void
  onShowAll?: () => void
  onShowSessions?: () => void
  onUnarchive?: (id: string) => void
  onDelete?: (id: string) => void
}) {
  const unseen = props.unseenIds ?? new Set<string>()
  const active = props.artifacts.filter((a) => !a.archived)
  const archived = props.artifacts.filter((a) => a.archived)
  const groups = groupBySession(active)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  // The Archived section is collapsed by default.
  const archivedOpen = collapsed["__archived__"] === true

  const selectedKey =
    props.artifacts.find((a) => a.id === props.selectedId)?.sessionID ?? UNGROUPED

  function isGroupOpen(g: Group): boolean {
    // Explicit user choice wins; otherwise expand the selected group only.
    if (g.key in collapsed) return !collapsed[g.key]
    return g.key === selectedKey
  }
  // Roadmap rows default to expanded so phases are visible.
  function isNodeOpen(id: string): boolean {
    const k = `rm:${id}`
    return k in collapsed ? !collapsed[k] : true
  }

  const renderItem = (a: Artifact) => {
    const badgeType = a.isRoadmap ? "roadmap" : a.type
    return (
      <li
        key={a.id}
        className={a.id === props.selectedId ? "selected" : ""}
        onClick={() => props.onSelect(a.id)}
      >
        <span className={`badge badge-${badgeType}`}>{badgeType}</span>
        <span className="title">{a.title}</span>
        {unseen.has(a.id) && <span className="activity-dot" title="New activity" />}
        <span className={`status status-${a.status}`}>{a.status.replace(/_/g, " ")}</span>
      </li>
    )
  }

  // One node: a roadmap row (with expandable phase children) or a plain leaf.
  const renderNode = (node: TreeNode) => {
    if (node.children.length === 0) return renderItem(node.artifact)
    const a = node.artifact
    const nodeOpen = isNodeOpen(a.id)
    const prog = phaseProgress(node)
    const badgeType = a.isRoadmap ? "roadmap" : a.type
    return (
      <li key={a.id} className="roadmap-node">
        <div
          className={`roadmap-row ${a.id === props.selectedId ? "selected" : ""}`}
          onClick={() => props.onSelect(a.id)}
        >
          <button
            type="button"
            className="node-chevron"
            aria-expanded={nodeOpen}
            onClick={(e) => {
              e.stopPropagation()
              setCollapsed((c) => ({ ...c, [`rm:${a.id}`]: nodeOpen }))
            }}
          >
            {nodeOpen ? "▾" : "▸"}
          </button>
          <span className={`badge badge-${badgeType}`}>{badgeType}</span>
          <span className="title">{a.title}</span>
          {unseen.has(a.id) && <span className="activity-dot" title="New activity" />}
          {prog && prog.total > 0 && (
            <span className="phase-progress">{prog.done}/{prog.total}</span>
          )}
          <span className={`status status-${a.status}`}>
            {a.status.replace(/_/g, " ")}
          </span>
        </div>
        {nodeOpen && (
          <ul className="artifact-sublist">{node.children.map(renderItem)}</ul>
        )}
      </li>
    )
  }

  const renderTree = (tree: TreeNode[]) => (
    <ul className="artifact-list">{tree.map(renderNode)}</ul>
  )

  const renderArchivedNode = (node: TreeNode) => {
    const a = node.artifact
    const badgeType = a.isRoadmap ? "roadmap" : a.type
    return (
      <li key={a.id} className="archived-node">
        <div
          className={`archived-row ${a.id === props.selectedId ? "selected" : ""}`}
          onClick={() => props.onSelect(a.id)}
        >
          <span className={`badge badge-${badgeType}`}>{badgeType}</span>
          <span className="title">{a.title}</span>
          <div className="archived-actions">
            <button
              type="button"
              title="Unarchive"
              onClick={(e) => { e.stopPropagation(); props.onUnarchive?.(a.id) }}
            >
              Unarchive
            </button>
            <button
              type="button"
              className="danger"
              title="Delete permanently"
              onClick={(e) => {
                e.stopPropagation()
                const msg = a.isRoadmap
                  ? `Permanently delete the roadmap "${a.title}" and its ${node.children.length} phase artifact(s)? This cannot be undone.`
                  : `Permanently delete "${a.title}"? Related reports in the same session are also removed. This cannot be undone.`
                if (window.confirm(msg)) props.onDelete?.(a.id)
              }}
            >
              Delete
            </button>
          </div>
        </div>
        {node.children.length > 0 && (
          <ul className="artifact-sublist">{node.children.map(renderItem)}</ul>
        )}
      </li>
    )
  }

  const renderArchived = () =>
    archived.length > 0 && (
      <div className="artifact-group archived-group">
        <button
          type="button"
          className="group-header"
          aria-expanded={archivedOpen}
          onClick={() => setCollapsed((c) => ({ ...c, __archived__: !archivedOpen }))}
        >
          <span className="group-chevron">{archivedOpen ? "▾" : "▸"}</span>
          <span className="group-title">Archived</span>
          <span className="group-count">{archived.length}</span>
        </button>
        {archivedOpen && (
          <ul className="artifact-list">{buildTree(archived).map(renderArchivedNode)}</ul>
        )}
      </div>
    )

  // "This session" scope: render only the focused session, with a hint linking to
  // the rest. Archived items stay tucked away in the "All" view.
  if (props.scope === "session") {
    if (!props.focusedSessionID) {
      return (
        <div className="artifact-groups">
          <p className="rail-empty">Pick a session →</p>
        </div>
      )
    }
    const focused = groups.find((g) => g.key === props.focusedSessionID)
    const otherCount = active.length - (focused?.artifacts.length ?? 0)
    const isCurrent = props.activeSessionID === props.focusedSessionID
    return (
      <div className="artifact-groups">
        <div className="artifact-group">
          <button
            type="button"
            className={`group-header session-scope-header${isCurrent ? " current" : ""}`}
            title="Back to all sessions"
            onClick={() => props.onShowSessions?.()}
          >
            <span className="group-chevron">‹</span>
            <span className="group-title">{focused?.label ?? "Current session"}</span>
            {isCurrent && <span className="current-badge">current</span>}
            <span className="group-count">{focused?.artifacts.length ?? 0}</span>
          </button>
          {focused ? (
            renderTree(buildTree(focused.artifacts))
          ) : (
            <p className="rail-empty">No artifacts in this session yet.</p>
          )}
        </div>
        {otherCount > 0 && (
          <button
            type="button"
            className="other-sessions-hint"
            onClick={() => props.onShowAll?.()}
          >
            {otherCount} in other session{otherCount === 1 ? "" : "s"} →
          </button>
        )}
      </div>
    )
  }

  // "All" scope: every session, with the focused/active one pinned to the top.
  const ordered = props.focusedSessionID
    ? [...groups].sort((a, b) => {
        const af = a.key === props.focusedSessionID ? 0 : 1
        const bf = b.key === props.focusedSessionID ? 0 : 1
        return af - bf
      })
    : groups

  return (
    <div className="artifact-groups">
      {ordered.map((g) => {
        const open = isGroupOpen(g)
        const tree = buildTree(g.artifacts)
        const isCurrent = props.activeSessionID != null && g.key === props.activeSessionID
        // When collapsed, surface a dot on the header if any artifact inside has
        // unseen activity (the per-item dots are hidden).
        const groupHasUnseen = !open && g.artifacts.some((a) => unseen.has(a.id))
        return (
          <div key={g.key} className="artifact-group">
            <button
              type="button"
              className={`group-header${isCurrent ? " current" : ""}`}
              aria-expanded={open}
              onClick={() => setCollapsed((c) => ({ ...c, [g.key]: open }))}
            >
              <span className="group-chevron">{open ? "▾" : "▸"}</span>
              <span className="group-title">{g.label}</span>
              {groupHasUnseen && <span className="activity-dot" title="New activity" />}
              {isCurrent && <span className="current-badge">current</span>}
              <span className="group-count">{g.artifacts.length}</span>
            </button>
            {open && renderTree(tree)}
          </div>
        )
      })}
      {renderArchived()}
    </div>
  )
}
