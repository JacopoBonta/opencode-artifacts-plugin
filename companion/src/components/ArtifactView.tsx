import React, { useRef, useEffect, useState } from "react"
import Markdown from "react-markdown"
import remarkGfm from "remark-gfm"
import type { Anchor, Comment } from "../api"
import { anchorFromOffsets, selectionOffsets, findAnchorOffsets } from "../anchor-dom"
import { flashElement } from "../flash"

function wrapRange(container: HTMLElement, start: number, end: number, title: string, commentId: string) {
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
    mark.dataset.commentId = commentId
    range.surroundContents(mark)
  }
}

export function ArtifactView(props: {
  content: string
  comments: Comment[]
  onAnchor: (anchor: Anchor) => void
  /** when false, text selection offers no "Comment" affordance (read-only views) */
  canComment?: boolean
  highlightResolved?: boolean
  onHighlightClick?: (commentId: string) => void
  flashAnchorId?: string
  flashKey?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  // A floating "Comment" button anchored to the current text selection — the
  // discoverable, explicit alternative to silently capturing every selection.
  const [floating, setFloating] = useState<{ top: number; left: number; anchor: Anchor }>()

  function captureSelection() {
    if (!props.canComment || !ref.current) return setFloating(undefined)
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return setFloating(undefined)
    const range = sel.getRangeAt(0)
    const offsets = selectionOffsets(ref.current, range)
    if (!offsets || offsets.end <= offsets.start) return setFloating(undefined)
    const text = ref.current.textContent ?? ""
    const anchor = anchorFromOffsets(text, offsets.start, offsets.end)
    // Position at the selection's end. Layout APIs can be unavailable (jsdom) —
    // fall back to the origin; the anchor is what matters, not pixel placement.
    let pos = { bottom: 0, right: 0 }
    try {
      const rects = range.getClientRects?.()
      const r = rects && rects.length ? rects[rects.length - 1] : range.getBoundingClientRect?.()
      if (r) pos = r
    } catch { /* no layout engine */ }
    setFloating({ top: pos.bottom + 6, left: pos.right, anchor })
  }

  function commitSelection() {
    if (!floating) return
    props.onAnchor(floating.anchor)
    window.getSelection()?.removeAllRanges()
    setFloating(undefined)
  }

  // Hide the button when the selection collapses (click elsewhere, etc.).
  useEffect(() => {
    if (!props.canComment) return
    const onSelChange = () => {
      const sel = window.getSelection()
      if (!sel || sel.isCollapsed) setFloating(undefined)
    }
    document.addEventListener("selectionchange", onSelChange)
    return () => document.removeEventListener("selectionchange", onSelChange)
  }, [props.canComment])

  function onClick(e: React.MouseEvent) {
    const mark = (e.target as HTMLElement).closest("mark.anchor-highlight") as HTMLElement | null
    const id = mark?.dataset.commentId
    if (id) props.onHighlightClick?.(id)
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
      try {
        wrapRange(ref.current, offsets.start, offsets.end, comment.body, comment.id)
      } catch {
        // Overlapping/edge ranges can make surroundContents throw — skip this
        // one anchor rather than aborting the whole highlight pass.
      }
    }
  }, [props.content, props.comments, props.highlightResolved])

  useEffect(() => {
    if (!ref.current || !props.flashAnchorId) return
    ref.current
      .querySelectorAll<HTMLElement>(`mark.anchor-highlight[data-comment-id="${CSS.escape(props.flashAnchorId)}"]`)
      .forEach((m) => flashElement(m))
  }, [props.flashAnchorId, props.flashKey])

  return (
    <div
      className="artifact-view"
      ref={ref}
      onMouseUp={captureSelection}
      onTouchEnd={captureSelection}
      onClick={onClick}
    >
      <Markdown remarkPlugins={[remarkGfm]}>{props.content}</Markdown>
      {floating && (
        <button
          type="button"
          className="comment-floating"
          style={{ position: "fixed", top: floating.top, left: floating.left }}
          // Keep the selection alive through the click; we read it from state anyway.
          onMouseDown={(e) => e.preventDefault()}
          onClick={commitSelection}
        >
          💬 Comment
        </button>
      )}
    </div>
  )
}
