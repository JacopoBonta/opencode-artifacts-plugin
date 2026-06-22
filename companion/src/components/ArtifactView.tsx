import React, { useRef, useEffect } from "react"
import Markdown from "react-markdown"
import type { Anchor, Comment } from "../api"
import { anchorFromOffsets, selectionOffsets, findAnchorOffsets } from "../anchor-dom"

function wrapRange(container: HTMLElement, start: number, end: number, title: string) {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  let pos = 0
  const slices: { node: Text; from: number; to: number }[] = []
  while (walker.nextNode()) {
    const node = walker.currentNode as Text
    const len = node.nodeValue?.length ?? 0
    const nodeStart = pos, nodeEnd = pos + len
    pos = nodeEnd
    const s = Math.max(start, nodeStart), e = Math.min(end, nodeEnd)
    if (s < e) slices.push({ node, from: s - nodeStart, to: e - nodeStart })
  }
  for (const { node, from, to } of slices) {
    const range = document.createRange()
    range.setStart(node, from)
    range.setEnd(node, to)
    const mark = document.createElement("mark")
    mark.className = "anchor-highlight"
    mark.title = title
    range.surroundContents(mark)
  }
}

export function ArtifactView(props: {
  content: string
  comments: Comment[]
  onAnchor: (anchor: Anchor) => void
  highlightResolved?: boolean
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

  useEffect(() => {
    if (!ref.current) return

    // Unwrap any existing highlights first
    const existing = ref.current.querySelectorAll("mark.anchor-highlight")
    existing.forEach((mark) => {
      const parent = mark.parentNode
      if (!parent) return
      while (mark.firstChild) parent.insertBefore(mark.firstChild, mark)
      parent.removeChild(mark)
      parent.normalize()
    })

    // Apply highlights for each anchored comment
    const text = ref.current.textContent ?? ""
    for (const comment of props.comments) {
      if (comment.kind !== "anchor" || !comment.anchor) continue
      if (comment.resolved && !props.highlightResolved) continue
      const offsets = findAnchorOffsets(text, comment.anchor)
      if (!offsets) continue
      wrapRange(ref.current, offsets.start, offsets.end, comment.body)
    }
  }, [props.content, props.comments, props.highlightResolved])

  return (
    <div className="artifact-view" ref={ref} onMouseUp={onMouseUp}>
      <Markdown>{props.content}</Markdown>
    </div>
  )
}
