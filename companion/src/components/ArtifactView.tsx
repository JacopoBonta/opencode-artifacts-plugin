import React, { useRef } from "react"
import Markdown from "react-markdown"
import type { Anchor, Comment } from "../api"
import { anchorFromOffsets, selectionOffsets } from "../anchor-dom"

export function ArtifactView(props: {
  content: string
  comments: Comment[]
  onAnchor: (anchor: Anchor) => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  function onMouseUp() {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || !ref.current) return
    const offsets = selectionOffsets(ref.current, sel.getRangeAt(0))
    if (!offsets || offsets.end <= offsets.start) return
    const text = ref.current.textContent ?? ""
    props.onAnchor(anchorFromOffsets(text, offsets.start, offsets.end))
  }

  return (
    <div className="artifact-view" ref={ref} onMouseUp={onMouseUp}>
      <Markdown>{props.content}</Markdown>
    </div>
  )
}
