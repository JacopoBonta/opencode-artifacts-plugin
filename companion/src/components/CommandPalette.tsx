import React, { useMemo, useState } from "react"
import type { Artifact } from "../api"

function sessionLabel(a: Artifact): string {
  if (a.sessionTitle) return a.sessionTitle
  if (a.sessionID) return `Session ${a.sessionID.slice(-6)}`
  return "Ungrouped"
}

/** Case-insensitive subsequence match (the query chars appear in order). */
export function fuzzyMatch(query: string, text: string): boolean {
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  let i = 0
  for (let j = 0; j < t.length && i < q.length; j++) {
    if (t[j] === q[i]) i++
  }
  return i === q.length
}

interface Entry { id: string; title: string; session: string; type: string; archived: boolean }

/** Cmd/Ctrl-K overlay: fuzzy-jump to any artifact (archived ones grouped last). */
export function CommandPalette(props: {
  artifacts: Artifact[]
  onOpen: (id: string) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState("")
  const [index, setIndex] = useState(0)

  const entries = useMemo<Entry[]>(
    () =>
      props.artifacts
        .slice()
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map((a) => ({
          id: a.id,
          title: a.title,
          session: sessionLabel(a),
          type: a.isRoadmap ? "roadmap" : a.type === "report" && a.parentId ? "result" : a.type,
          archived: !!a.archived,
        })),
    [props.artifacts],
  )

  const results = useMemo(() => {
    const q = query.trim()
    const matched = q ? entries.filter((e) => fuzzyMatch(q, `${e.session} ${e.title}`)) : entries
    // Active first, archived last; the sort is stable so recency order holds
    // within each group. Kept flat so Arrow/Enter selection stays simple.
    return [...matched].sort((a, b) => Number(a.archived) - Number(b.archived))
  }, [entries, query])

  // Keep the highlighted row in range as results shrink.
  const sel = results.length === 0 ? 0 : Math.min(index, results.length - 1)

  function choose(i: number) {
    const e = results[i]
    if (e) { props.onOpen(e.id); props.onClose() }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setIndex((sel + 1) % Math.max(results.length, 1)) }
    else if (e.key === "ArrowUp") { e.preventDefault(); setIndex((sel - 1 + results.length) % Math.max(results.length, 1)) }
    else if (e.key === "Enter") { e.preventDefault(); choose(sel) }
    else if (e.key === "Escape") { e.preventDefault(); props.onClose() }
  }

  return (
    <div className="palette-overlay" onMouseDown={props.onClose}>
      <div className="palette" role="dialog" aria-label="Go to artifact" onMouseDown={(e) => e.stopPropagation()}>
        <input
          className="palette-input"
          autoFocus
          placeholder="Go to artifact…"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setIndex(0) }}
          onKeyDown={onKeyDown}
        />
        <ul className="palette-results">
          {results.length === 0 && <li className="palette-empty">No matches</li>}
          {results.map((e, i) => (
            <React.Fragment key={e.id}>
              {e.archived && (i === 0 || !results[i - 1].archived) && (
                <li className="palette-section" aria-hidden="true">Archived</li>
              )}
              <li
                className={`palette-row${i === sel ? " sel" : ""}${e.archived ? " archived" : ""}`}
                onMouseEnter={() => setIndex(i)}
                onClick={() => choose(i)}
              >
                <span className={`badge badge-${e.type}`}>{e.type}</span>
                <span className="palette-title">{e.title}</span>
                <span className="palette-session">{e.session}</span>
              </li>
            </React.Fragment>
          ))}
        </ul>
      </div>
    </div>
  )
}
