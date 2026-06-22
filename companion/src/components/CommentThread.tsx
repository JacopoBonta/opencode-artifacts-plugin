import React, { useState } from "react"
import type { Comment } from "../api"

function CommentItem({ c }: { c: Comment }) {
  return (
    <div className={`comment${c.resolved ? " resolved" : ""}`}>
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
}) {
  const [draft, setDraft] = useState("")
  const [showResolved, setShowResolved] = useState(false)

  if (props.readOnly) {
    return (
      <div className="comment-thread">
        {props.title && <h4>{props.title}</h4>}
        {props.comments.length === 0 && <p className="empty">No comments on this revision.</p>}
        {props.comments.map((c) => <CommentItem key={c.id} c={c} />)}
      </div>
    )
  }

  const active = props.comments.filter((c) => !c.resolved)
  const resolved = props.comments.filter((c) => c.resolved)

  return (
    <div className="comment-thread">
      {props.title && <h4>{props.title}</h4>}

      {active.map((c) => <CommentItem key={c.id} c={c} />)}

      {resolved.length > 0 && (
        <div className="resolved-section">
          <button
            type="button"
            className="resolved-toggle"
            onClick={() => setShowResolved((s) => !s)}
          >
            {showResolved ? "▾" : "▸"} Resolved ({resolved.length})
          </button>
          {showResolved && resolved.map((c) => <CommentItem key={c.id} c={c} />)}
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
    </div>
  )
}
