import type { Anchor, CommentKind, VerdictStatus } from "./types"

/**
 * Hand-rolled, pure request-body validators for the companion API routes. The
 * server parses untrusted JSON (potentially reachable cross-origin / from other
 * local processes) and must not trust its shape — these reject malformed bodies
 * with a 400 before anything reaches the store. Kept dependency-free and pure
 * (no zod) to match the rest of the backend and stay unit-testable in isolation.
 */

/** Upper bound on free-text fields (comment/verdict bodies), in characters. */
export const MAX_TEXT = 10_000

export type Validated<T> = { ok: true; value: T } | { ok: false; error: string }

const fail = (error: string): Validated<never> => ({ ok: false, error })

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

/** A non-empty string no longer than MAX_TEXT. */
function text(v: unknown, field: string): Validated<string> {
  if (typeof v !== "string") return fail(`${field} must be a string`)
  if (v.length === 0) return fail(`${field} must not be empty`)
  if (v.length > MAX_TEXT) return fail(`${field} exceeds ${MAX_TEXT} characters`)
  return { ok: true, value: v }
}

const COMMENT_KINDS: CommentKind[] = ["anchor", "general"]
const VERDICT_STATUSES: VerdictStatus[] = ["approved", "changes_requested", "declined"]

/** Validate an anchor sub-object: { quote, prefix, suffix } all strings. */
function anchor(v: unknown): Validated<Anchor> {
  if (!isObject(v)) return fail("anchor must be an object")
  if (typeof v.quote !== "string" || typeof v.prefix !== "string" || typeof v.suffix !== "string")
    return fail("anchor.quote / anchor.prefix / anchor.suffix must be strings")
  return { ok: true, value: { quote: v.quote, prefix: v.prefix, suffix: v.suffix } }
}

export interface CommentInput {
  revision: number
  kind: CommentKind
  body: string
  anchor?: Anchor
}

/** POST /api/artifacts/:id/comments body. */
export function validateCommentInput(b: unknown): Validated<CommentInput> {
  if (!isObject(b)) return fail("body must be an object")
  if (typeof b.revision !== "number" || !Number.isFinite(b.revision))
    return fail("revision must be a finite number")
  if (!COMMENT_KINDS.includes(b.kind as CommentKind))
    return fail(`kind must be one of: ${COMMENT_KINDS.join(", ")}`)
  const body = text(b.body, "body")
  if (!body.ok) return body
  const out: CommentInput = { revision: b.revision, kind: b.kind as CommentKind, body: body.value }
  if (b.anchor !== undefined) {
    const a = anchor(b.anchor)
    if (!a.ok) return a
    out.anchor = a.value
  } else if (out.kind === "anchor") {
    return fail("an anchor comment requires an anchor")
  }
  return { ok: true, value: out }
}

/** PATCH /api/artifacts/:id/comments/:cid body. */
export function validateCommentEdit(b: unknown): Validated<{ body: string }> {
  if (!isObject(b)) return fail("body must be an object")
  const body = text(b.body, "body")
  if (!body.ok) return body
  return { ok: true, value: { body: body.value } }
}

export interface VerdictInput {
  status: VerdictStatus
  reason?: string
}

/** POST /api/artifacts/:id/verdict body. */
export function validateVerdictInput(b: unknown): Validated<VerdictInput> {
  if (!isObject(b)) return fail("body must be an object")
  if (!VERDICT_STATUSES.includes(b.status as VerdictStatus))
    return fail(`status must be one of: ${VERDICT_STATUSES.join(", ")}`)
  const out: VerdictInput = { status: b.status as VerdictStatus }
  if (b.reason !== undefined) {
    if (typeof b.reason !== "string") return fail("reason must be a string")
    if (b.reason.length > MAX_TEXT) return fail(`reason exceeds ${MAX_TEXT} characters`)
    out.reason = b.reason
  }
  return { ok: true, value: out }
}

/** POST /api/artifacts/:id/archive body. */
export function validateArchiveInput(b: unknown): Validated<{ archived: boolean }> {
  if (!isObject(b)) return fail("body must be an object")
  if (typeof b.archived !== "boolean") return fail("archived must be a boolean")
  return { ok: true, value: { archived: b.archived } }
}

/** POST /api/sessions/:id/gate body. */
export function validateGateInput(b: unknown): Validated<{ forced: boolean }> {
  if (!isObject(b)) return fail("body must be an object")
  if (typeof b.forced !== "boolean") return fail("forced must be a boolean")
  return { ok: true, value: { forced: b.forced } }
}
