import React, { useState, useRef, useEffect } from "react"
import type { Comment } from "../api"
import { flashElement } from "../flash"

function CommentItem({ c, onClick }: { c: Comment; onClick?: (id: string) => void }) {
  const clickable = c.kind === "anchor" && !!onClick
  return (
    <div
      className={`comment${c.resolved ? " resolved" : ""}${clickable ? " clickable" : ""}`}
      data-comment-id={c.id}
      onClick={clickable ? () => onClick!(c.id) : undefined}
    >
      {c.anchor?.quote && <blockquote>{c.anchor.quote}</blockquote>}
      <p>{c.body}</p>
    </div>
  )
}

export function CommentThread(props: {
  comments: Comment[]
  onAdd: (body: string) => void
  title?: string
  readOnly?: boolean
  onCommentClick?: (id: string) => void
  flashCommentId?: string
  flashKey?: number
}) {
  const [draft, setDraft] = useState("")
  const [showResolved, setShowResolved] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!rootRef.current || !props.flashCommentId) return
    const el = rootRef.current.querySelector<HTMLElement>(
      `[data-comment-id="${CSS.escape(props.flashCommentId)}"]`,
    )
    flashElement(el)
  }, [props.flashCommentId, props.flashKey])

  const item = (c: Comment) => <CommentItem key={c.id} c={c} onClick={props.onCommentClick} />

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
        {active.map(item)}
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
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add a comment"
        />
        <button
          onClick={() => { if (draft.trim()) { props.onAdd(draft.trim()); setDraft("") } }}
        >
          Comment
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
