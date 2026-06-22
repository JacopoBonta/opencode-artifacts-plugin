import type { Anchor } from "./api"

const CONTEXT = 32

export function anchorFromOffsets(text: string, start: number, end: number): Anchor {
  return {
    quote: text.slice(start, end),
    prefix: text.slice(Math.max(0, start - CONTEXT), start),
    suffix: text.slice(end, end + CONTEXT),
  }
}

export function findAnchorOffsets(
  text: string,
  anchor: Anchor,
): { start: number; end: number } | null {
  const idxs: number[] = []
  let i = anchor.quote ? text.indexOf(anchor.quote) : -1
  while (i !== -1) { idxs.push(i); i = text.indexOf(anchor.quote, i + 1) }
  if (idxs.length === 0) return null
  if (idxs.length === 1) return { start: idxs[0], end: idxs[0] + anchor.quote.length }

  let best = idxs[0], bestScore = -1
  for (const s of idxs) {
    const e = s + anchor.quote.length
    const before = text.slice(Math.max(0, s - anchor.prefix.length), s)
    const after = text.slice(e, e + anchor.suffix.length)
    const score = sufLen(before, anchor.prefix) + preLen(after, anchor.suffix)
    if (score > bestScore) { bestScore = score; best = s }
  }
  return { start: best, end: best + anchor.quote.length }
}

/** Compute the plain-text offset of a DOM selection within `container`. */
export function selectionOffsets(
  container: HTMLElement,
  range: Range,
): { start: number; end: number } | null {
  if (!container.contains(range.commonAncestorContainer)) return null
  const pre = range.cloneRange()
  pre.selectNodeContents(container)
  pre.setEnd(range.startContainer, range.startOffset)
  const start = pre.toString().length
  return { start, end: start + range.toString().length }
}

function preLen(a: string, b: string): number {
  let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; return i
}
function sufLen(a: string, b: string): number {
  let i = 0; while (i < a.length && i < b.length && a[a.length-1-i] === b[b.length-1-i]) i++; return i
}
