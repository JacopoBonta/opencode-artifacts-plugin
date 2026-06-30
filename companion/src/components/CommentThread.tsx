import React, { useState, useRef, useEffect } from "react"
import type { Comment } from "../api"
import { flashElement } from "../flash"

function CommentItem({
  c,
  orphaned,
  onClick,
  onEdit,
  onDelete,
}: {
  c: Comment
  orphaned?: boolean
  onClick?: (id: string) => void
  onEdit?: (id: string, body: string) => void
  onDelete?: (id: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(c.body)
  // Deleting is destructive and irreversible, so it's a two-step inline confirm
  // (mirrors the decline flow in ActionBar) rather than an instant delete.
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  // Edit/Delete are offered only for active comments (the parent passes the
  // callbacks only there); a clickable anchor stops being clickable while edited.
  const editable = !!onEdit || !!onDelete
  const clickable = c.kind === "anchor" && !!onClick && !editing && !confirmingDelete

  function save() {
    const trimmed = draft.trim()
    if (trimmed) onEdit?.(c.id, trimmed)
    setEditing(false)
  }

  return (
    <div
      className={`comment${c.resolved ? " resolved" : ""}${clickable ? " clickable" : ""}`}
      data-comment-id={c.id}
      onClick={clickable ? () => onClick!(c.id) : undefined}
    >
      {c.anchor?.quote && <blockquote>{c.anchor.quote}</blockquote>}
      {orphaned && (
        <span className="comment-orphan" title="The quoted text changed in this revision, so this comment is no longer anchored.">
          ⚓ anchor not in this revision
        </span>
      )}
      {editing ? (
        <div className="comment-edit">
          <textarea autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} />
          <div className="comment-actions">
            <button type="button" onClick={save}>Save</button>
            <button type="button" onClick={() => { setDraft(c.body); setEditing(false) }}>Cancel</button>
          </div>
        </div>
      ) : (
        <>
          <p>{c.body}</p>
          {editable && (
            <div className="comment-actions">
              {onEdit && !confirmingDelete && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setDraft(c.body); setEditing(true) }}
                >
                  Edit
                </button>
              )}
              {onDelete && !confirmingDelete && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setConfirmingDelete(true) }}
                >
                  Delete
                </button>
              )}
              {onDelete && confirmingDelete && (
                <>
                  <button
                    type="button"
                    className="comment-delete-confirm"
                    onClick={(e) => { e.stopPropagation(); onDelete(c.id) }}
                  >
                    Confirm delete
                  </button>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setConfirmingDelete(false) }}
                  >
                    Cancel
                  </button>
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

export function CommentThread(props: {
  comments: Comment[]
  /** Returns false when the post failed, so the draft is kept; true/void clears it. */
  onAdd: (body: string) => Promise<boolean> | boolean | void
  onEdit?: (id: string, body: string) => void
  onDelete?: (id: string) => void
  title?: string
  readOnly?: boolean
  /** ids of anchor comments whose quote no longer matches the shown revision */
  orphanedIds?: Set<string>
  onCommentClick?: (id: string) => void
  flashCommentId?: string
  flashKey?: number
}) {
  const [draft, setDraft] = useState("")
  const [showResolved, setShowResolved] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!rootRef.current || !props.flashCommentId) return
    const el = rootRef.current.querySelector<HTMLElement>(
      `[data-comment-id="${CSS.escape(props.flashCommentId)}"]`,
    )
    flashElement(el)
  }, [props.flashCommentId, props.flashKey])

  async function submit() {
    const trimmed = draft.trim()
    if (!trimmed || submitting) return
    setSubmitting(true)
    try {
      // Clear the draft only once the post succeeds — a failed post must not
      // silently destroy what the user typed.
      const ok = await props.onAdd(trimmed)
      if (ok !== false) setDraft("")
    } finally {
      setSubmitting(false)
    }
  }

  const orphaned = (c: Comment) => props.orphanedIds?.has(c.id)
  const item = (c: Comment) => (
    <CommentItem key={c.id} c={c} orphaned={orphaned(c)} onClick={props.onCommentClick} />
  )
  // Active comments in an editable thread get Edit/Delete; resolved and
  // read-only comments stay immutable (no callbacks passed).
  const editableItem = (c: Comment) => (
    <CommentItem
      key={c.id}
      c={c}
      orphaned={orphaned(c)}
      onClick={props.onCommentClick}
      onEdit={props.onEdit}
      onDelete={props.onDelete}
    />
  )

  let body: React.ReactNode
  if (props.readOnly) {
    body = (
      <>
        {props.comments.length === 0 && <p className="empty">No comments on this revision.</p>}
        {props.comments.map(item)}
      </>
    )
  } else {
    const active = props.comments.filter((c) => !c.resolved)
    const resolved = props.comments.filter((c) => c.resolved)
    body = (
      <>
        {active.map(editableItem)}
        {resolved.length > 0 && (
          <div className="resolved-section">
            <button
              type="button"
              className="resolved-toggle"
              onClick={() => setShowResolved((s) => !s)}
            >
              {showResolved ? "▾" : "▸"} Resolved ({resolved.length})
            </button>
            {showResolved && resolved.map(item)}
          </div>
        )}
        <textarea
          className="comment-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add a comment"
        />
        <button onClick={submit} disabled={submitting || !draft.trim()}>
          {submitting ? "Posting…" : "Comment"}
        </button>
      </>
    )
  }

  return (
    <div className="comment-thread" ref={rootRef}>
      {props.title && <h4>{props.title}</h4>}
      {body}
    </div>
  )
}
