import React, { useState } from "react"
import type { Comment } from "../api"

export function CommentThread(props: {
  comments: Comment[]
  onAdd: (body: string) => void
  title?: string
}) {
  const [draft, setDraft] = useState("")
  return (
    <div className="comment-thread">
      {props.title && <h4>{props.title}</h4>}
      {props.comments.map((c) => (
        <div key={c.id} className="comment">
          {c.anchor?.quote && <blockquote>{c.anchor.quote}</blockquote>}
          <p>{c.body}</p>
        </div>
      ))}
      <textarea value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add a comment" />
      <button
        onClick={() => { if (draft.trim()) { props.onAdd(draft.trim()); setDraft("") } }}
      >
        Comment
      </button>
    </div>
  )
}
