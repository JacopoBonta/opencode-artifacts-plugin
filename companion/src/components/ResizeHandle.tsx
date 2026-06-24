import React, { useRef } from "react"

/**
 * A thin vertical drag strip positioned at a rail boundary. Reports the new
 * desired width as the pointer moves; the parent clamps and persists.
 *
 * `side="left"`  → dragging right widens (delta added to width).
 * `side="right"` → dragging left widens (delta subtracted from width).
 */
export function ResizeHandle(props: {
  side: "left" | "right"
  width: number
  onResize: (width: number) => void
  onCommit: (width: number) => void
}) {
  const start = useRef<{ x: number; w: number } | null>(null)

  function onPointerDown(e: React.PointerEvent) {
    start.current = { x: e.clientX, w: props.width }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    e.preventDefault()
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!start.current) return
    const dx = e.clientX - start.current.x
    const next = start.current.w + (props.side === "left" ? dx : -dx)
    props.onResize(next)
  }

  function onPointerUp(e: React.PointerEvent) {
    if (!start.current) return
    start.current = null
    ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
    props.onCommit(props.width)
  }

  return (
    <div
      className={`rail-resize rail-resize-${props.side}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${props.side} sidebar`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    />
  )
}
