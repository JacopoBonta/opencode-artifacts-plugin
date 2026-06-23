# Lock an Approved Plan — Design

**Date:** 2026-06-23
**Status:** Approved (design)
**Builds on:** [2026-06-22 opencode artifacts plugin design](2026-06-22-opencode-artifacts-plugin-design.md), [2026-06-23 revision switcher](2026-06-23-revision-switcher-design.md)

## Problem

Once a plan is approved its review is over, but the companion still shows the
comment box and the Approve / Request-changes action bar on the latest revision.
A user (or a stray client) can still comment, request changes, or re-approve —
the latter could even flip an `approved` plan back to `changes_requested` with no
agent listening, leaving inconsistent state.

## Behavior

When a plan's status is `approved`, its review is **closed**:

- The latest-revision view is **read-only**: no comment input, no
  anchor-creation, and no action bar (no commenting, requesting changes, or
  re-approving).
- Existing comments and anchor highlights stay visible, read-only, and still
  clickable (bidirectional flash). The revision switcher still works.
- A **"✓ Approved — review closed"** banner replaces the action bar.

Reports are unchanged (they have no `approved` state; commenting and *Request
refinement* remain available — reports are how agents report their work).

## Two layers

So the lock is genuinely enforced, not just hidden:

### Backend (`src/server.ts`)

- `POST /api/artifacts/:id/comments` and `POST /api/artifacts/:id/verdict`
  return **409** when the target artifact's status is `approved`.
- Rationale: without this, a second verdict POST would call
  `store.resolveVerdict` on an artifact with no pending promise, flipping its
  status (e.g. to `changes_requested`) with no agent awaiting — a real
  inconsistency. The guard makes the closed state authoritative.

### Companion (`companion/src/App.tsx`)

- Derive `interactive = isLatest && detail.artifact.status !== "approved"`.
- When not interactive (historical *or* approved-latest): render the read-only
  `CommentThread`, omit `ActionBar`, and pass a no-op `onAnchor` so text
  selection can't start a comment.
- Show the "✓ Approved — review closed" banner when
  `isLatest && status === "approved"`. The existing historical banner still
  shows for older revisions.
- No new components — reuses the read-only path introduced for the revision
  switcher.

## Testing

- **server**: posting a comment to an approved artifact returns 409; posting a
  verdict to an approved artifact returns 409 and does not change its status.
- **App**: when the loaded artifact is `approved`, the latest view shows the
  approved banner, no Approve / Request-changes buttons, and no "Add a comment"
  input; existing comments still render read-only.

## Out of scope

- Locking reports / introducing an approval concept for reports.
- Any "re-open an approved plan" action.
