import React from "react"
import type { Artifact } from "../api"

export interface TreeNode { artifact: Artifact; children: TreeNode[] }

const UNGROUPED = "__ungrouped__"
const ARCHIVED = "__archived__"

/** The session an artifact belongs to (its session, or the ungrouped bucket). */
export function sessionKey(a: Artifact): string {
  return a.sessionID ?? UNGROUPED
}

/** Human label for a session, taken from any artifact that carries a title. */
export function sessionLabel(artifacts: Artifact[], key: string): string {
  if (key === UNGROUPED) return "Ungrouped"
  return artifacts.find((a) => a.sessionTitle)?.sessionTitle ?? `Session ${key.slice(-6)}`
}

/**
 * Build the nesting tree for a session's artifacts: top-level nodes (standalone
 * plans/reports and roadmaps) with their descendants nested underneath, to any
 * depth — a roadmap holds its phase plans, and each phase plan holds the report
 * that reports on it; a standalone plan holds its report. Children whose parent
 * is absent fall back to the top level. Pure + exported so it can be unit-tested
 * without a DOM.
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
  // Descendants keep execution order (oldest first); recurse to any depth.
  const byCreated = (a: Artifact, b: Artifact) => a.createdAt - b.createdAt
  const toNode = (a: Artifact): TreeNode => ({
    artifact: a,
    children: (childrenByParent.get(a.id) ?? []).slice().sort(byCreated).map(toNode),
  })
  return artifacts
    .filter((a) => !a.parentId || !present.has(a.parentId))
    // Top-level: newest first.
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(toNode)
}

/** Phase progress for a roadmap node: approved phase plans / total phase plans. */
export function phaseProgress(node: TreeNode): { done: number; total: number } | null {
  if (!node.artifact.isRoadmap) return null
  const plans = node.children.map((c) => c.artifact).filter((c) => c.type === "plan")
  return { done: plans.filter((c) => c.status === "approved").length, total: plans.length }
}

// Collapse state is a flat map keyed by `rm:<id>` for roadmaps and the archived
// bucket. Each entry stores the open value *before* the last toggle, so "open now"
// is its negation. Roadmaps default to expanded; the archived bucket defaults to
// collapsed. Shared so App's keyboard-nav order matches what the tree shows.
export function isOpen(collapsed: Record<string, boolean>, key: string): boolean {
  if (key === ARCHIVED) return collapsed[key] === false
  return key in collapsed ? !collapsed[key] : true
}

/**
 * Ordered ids of the focused session's artifacts that are currently visible (and
 * thus keyboard-selectable), honoring roadmap collapse and excluding archived.
 * Pure so App can drive j/k selection without reaching into the tree.
 */
export function visibleArtifactIds(
  artifacts: Artifact[],
  collapsed: Record<string, boolean>,
  focusedSessionID?: string,
): string[] {
  if (!focusedSessionID) return []
  const ids: string[] = []
  const inSession = artifacts.filter((a) => !a.archived && sessionKey(a) === focusedSessionID)
  const walk = (nodes: TreeNode[]) => {
    for (const node of nodes) {
      ids.push(node.artifact.id)
      // An expandable node honors its own collapse before recursing into children.
      if (node.children.length && isOpen(collapsed, `rm:${node.artifact.id}`)) {
        walk(node.children)
      }
    }
  }
  walk(buildTree(inSession))
  return ids
}

/**
 * The explorer, scoped to a single session: the user stays focused on the current
 * session's artifacts. Other sessions are reachable only via the command palette.
 * Controlled — collapse state and the keyboard-selected id live in App.
 */
export function ArtifactTree(props: {
  artifacts: Artifact[]
  /** the session to show (the live session, else the active tab's session) */
  focusedSessionID?: string
  /** true when the focused session is the live opencode session */
  isLive?: boolean
  /** the active tab's artifact (strong highlight) */
  activeId?: string
  /** the keyboard-selected artifact (outline; j/k) */
  keyboardId?: string
  collapsed: Record<string, boolean>
  unseenIds?: Set<string>
  onToggle: (key: string) => void
  onOpen: (id: string) => void
  onUnarchive?: (id: string) => void
  onDelete?: (id: string) => void
}) {
  if (!props.focusedSessionID) {
    return (
      <p className="rail-empty">
        No active session. Press <kbd>⌘K</kbd> to open an artifact.
      </p>
    )
  }

  const unseen = props.unseenIds ?? new Set<string>()
  const inSession = props.artifacts.filter((a) => sessionKey(a) === props.focusedSessionID)
  const active = inSession.filter((a) => !a.archived)
  const archived = inSession.filter((a) => a.archived)
  const label = sessionLabel(inSession, props.focusedSessionID)
  const showArchived = isOpen(props.collapsed, ARCHIVED)

  const rowClass = (id: string) =>
    `${id === props.activeId ? " active" : ""}${id === props.keyboardId ? " kbd" : ""}`

  // A report linked to its plan reads as a "result"; a general (unlinked) report
  // keeps "report". Roadmaps and plans are unaffected.
  const badgeFor = (a: Artifact) =>
    a.isRoadmap ? "roadmap" : a.type === "report" && a.parentId ? "result" : a.type

  // One node: an expandable row (any node WITH children — a roadmap, or a plan
  // with a nested report) or a plain leaf. Recurses to any depth.
  const renderNode = (node: TreeNode): React.ReactElement => {
    const a = node.artifact
    const badge = badgeFor(a)
    if (node.children.length === 0) {
      return (
        <li key={a.id} className={`tree-leaf${rowClass(a.id)}`} onClick={() => props.onOpen(a.id)}>
          <span className={`badge badge-${badge}`}>{badge}</span>
          <span className="title">{a.title}</span>
          {unseen.has(a.id) && <span className="activity-dot" title="New activity" />}
          <span className={`status status-${a.status}`}>{a.status.replace(/_/g, " ")}</span>
        </li>
      )
    }
    const nodeOpen = isOpen(props.collapsed, `rm:${a.id}`)
    const prog = phaseProgress(node)
    return (
      <li key={a.id} className="roadmap-node">
        <div className={`roadmap-row${rowClass(a.id)}`} onClick={() => props.onOpen(a.id)}>
          <button
            type="button"
            className="node-chevron"
            aria-expanded={nodeOpen}
            onClick={(e) => { e.stopPropagation(); props.onToggle(`rm:${a.id}`) }}
          >
            {nodeOpen ? "▾" : "▸"}
          </button>
          <span className={`badge badge-${badge}`}>{badge}</span>
          <span className="title">{a.title}</span>
          {unseen.has(a.id) && <span className="activity-dot" title="New activity" />}
          {prog && prog.total > 0 && (
            <span className="phase-progress">{prog.done}/{prog.total}</span>
          )}
          <span className={`status status-${a.status}`}>{a.status.replace(/_/g, " ")}</span>
        </div>
        {nodeOpen && <ul className="artifact-sublist">{node.children.map(renderNode)}</ul>}
      </li>
    )
  }

  // Total descendants of a node, for the delete confirmation copy.
  const countDescendants = (node: TreeNode): number =>
    node.children.reduce((n, c) => n + 1 + countDescendants(c), 0)

  // A nested archived row (no per-item actions; archived as part of its parent).
  // Always expanded so the full archived subtree is visible. Recurses.
  const renderArchivedChild = (node: TreeNode): React.ReactElement => {
    const a = node.artifact
    const badge = badgeFor(a)
    if (node.children.length === 0) {
      return (
        <li key={a.id} className="tree-leaf" onClick={() => props.onOpen(a.id)}>
          <span className={`badge badge-${badge}`}>{badge}</span>
          <span className="title">{a.title}</span>
        </li>
      )
    }
    return (
      <li key={a.id} className="roadmap-node">
        <div className="roadmap-row" onClick={() => props.onOpen(a.id)}>
          <span className={`badge badge-${badge}`}>{badge}</span>
          <span className="title">{a.title}</span>
        </div>
        <ul className="artifact-sublist">{node.children.map(renderArchivedChild)}</ul>
      </li>
    )
  }

  const renderArchivedNode = (node: TreeNode) => {
    const a = node.artifact
    const badge = badgeFor(a)
    const descCount = countDescendants(node)
    return (
      <li key={a.id} className="archived-node">
        <div className={`archived-row${rowClass(a.id)}`} onClick={() => props.onOpen(a.id)}>
          <span className={`badge badge-${badge}`}>{badge}</span>
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
                const msg = a.isRoadmap || descCount > 0
                  ? `Permanently delete "${a.title}" and its ${descCount} nested artifact(s)? This cannot be undone.`
                  : `Permanently delete "${a.title}"? Related reports in the same session are also removed. This cannot be undone.`
                if (window.confirm(msg)) props.onDelete?.(a.id)
              }}
            >
              Delete
            </button>
          </div>
        </div>
        {node.children.length > 0 && (
          <ul className="artifact-sublist">{node.children.map(renderArchivedChild)}</ul>
        )}
      </li>
    )
  }

  return (
    <div className="artifact-tree">
      <div className={`session-heading${props.isLive ? " live" : ""}`}>
        {props.isLive && <span className="live-dot" title="Live session" />}
        <span className="session-heading-title" title={label}>{label}</span>
        <span className="group-count">{active.length}</span>
      </div>
      {active.length === 0 ? (
        <p className="rail-empty">No artifacts in this session yet.</p>
      ) : (
        <ul className="artifact-list">{buildTree(active).map(renderNode)}</ul>
      )}
      {archived.length > 0 && (
        <div className="artifact-group archived-group">
          <button
            type="button"
            className="group-header"
            aria-expanded={showArchived}
            onClick={() => props.onToggle(ARCHIVED)}
          >
            <span className="group-chevron">{showArchived ? "▾" : "▸"}</span>
            <span className="group-title">Archived</span>
            <span className="group-count">{archived.length}</span>
          </button>
          {showArchived && (
            <ul className="artifact-list">{buildTree(archived).map(renderArchivedNode)}</ul>
          )}
        </div>
      )}
    </div>
  )
}
