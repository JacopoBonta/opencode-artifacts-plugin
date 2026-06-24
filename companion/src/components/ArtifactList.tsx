import React, { useState } from "react"
import type { Artifact } from "../api"

interface Group { key: string; label: string; artifacts: Artifact[]; latest: number }

export interface TreeNode { artifact: Artifact; children: Artifact[] }

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
  onSelect: (id: string) => void
}) {
  const groups = groupBySession(props.artifacts)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  const selectedKey =
    props.artifacts.find((a) => a.id === props.selectedId)?.sessionID ?? "__ungrouped__"

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
        <span className={`status status-${a.status}`}>{a.status.replace(/_/g, " ")}</span>
      </li>
    )
  }

  return (
    <div className="artifact-groups">
      {groups.map((g) => {
        const open = isGroupOpen(g)
        const tree = buildTree(g.artifacts)
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
                {tree.map((node) => {
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
                })}
              </ul>
            )}
          </div>
        )
      })}
    </div>
  )
}
