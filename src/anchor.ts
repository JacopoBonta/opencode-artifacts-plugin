import type { Anchor } from "./types"

const CONTEXT = 32

export function makeAnchor(text: string, start: number, end: number): Anchor {
  return {
    quote: text.slice(start, end),
    prefix: text.slice(Math.max(0, start - CONTEXT), start),
    suffix: text.slice(end, end + CONTEXT),
  }
}

/** All start indices where `needle` occurs in `hay`. */
function allIndexes(hay: string, needle: string): number[] {
  if (!needle) return []
  const out: number[] = []
  let i = hay.indexOf(needle)
  while (i !== -1) {
    out.push(i)
    i = hay.indexOf(needle, i + 1)
  }
  return out
}

/**
 * Locate the anchor in `text`. Returns the best {start,end} or null if the
 * quote no longer exists (orphaned). When the quote occurs multiple times the
 * candidate whose surrounding context best matches prefix/suffix wins.
 */
export function matchAnchor(
  text: string,
  anchor: Anchor,
): { start: number; end: number } | null {
  const candidates = allIndexes(text, anchor.quote)
  if (candidates.length === 0) return null
  if (candidates.length === 1) {
    return { start: candidates[0], end: candidates[0] + anchor.quote.length }
  }

  let best = candidates[0]
  let bestScore = -1
  for (const start of candidates) {
    const end = start + anchor.quote.length
    const beforeText = text.slice(Math.max(0, start - anchor.prefix.length), start)
    const afterText = text.slice(end, end + anchor.suffix.length)
    const score =
      commonSuffixLen(beforeText, anchor.prefix) +
      commonPrefixLen(afterText, anchor.suffix)
    if (score > bestScore) {
      bestScore = score
      best = start
    }
  }
  return { start: best, end: best + anchor.quote.length }
}

function commonPrefixLen(a: string, b: string): number {
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  return i
}

function commonSuffixLen(a: string, b: string): number {
  let i = 0
  while (i < a.length && i < b.length && a[a.length - 1 - i] === b[b.length - 1 - i]) i++
  return i
}
