# Comment Auto-Resolve on Revise — Design

**Date:** 2026-06-23
**Status:** Approved (design)
**Builds on:** [2026-06-22 opencode artifacts plugin design](2026-06-22-opencode-artifacts-plugin-design.md)

## Problem

Comments persist forever and are re-sent to the agent on every revision. The
`resolved` flag exists on `Comment` and the server already filters
`!c.resolved` when returning comments to the agent (`changes_requested`,
`refine`), but nothing ever sets `resolved`, so the filter is dead and feedback
accumulates across revisions.

## Behavior

Publishing a **new revision of an existing artifact** auto-marks **all prior
comments resolved** — the revision is assumed to address them. Consequences:

- The agent only ever receives **unresolved** comments (the existing server
  filter becomes meaningful).
- The review pane shows **active** (unresolved) comments inline; **resolved**
  comments collapse under a `Resolved (N)` toggle (collapsed by default).
- Anchor highlights render only for unresolved anchored comments.

This applies equally to report re-publish via *Request refinement*. A brand-new
artifact (first publish) is unaffected. Comments added to the current revision
before any re-publish remain active.

## Changes

### Backend (`src/`)

- `store.publish`, **revision-bump branch only**: after the new revision's files
  are written, set `resolved = true` on every existing comment for that
  artifact and persist `comments.json`. The new-artifact branch is unchanged.
- No new endpoint. The server's existing `!c.resolved` filter on the
  `changes_requested` and `refine` verdict paths now actually filters.

### Companion (`companion/src/`)

- `ArtifactView`: highlight only comments where
  `kind === "anchor" && anchor && !resolved`.
- Comments rail: active (unresolved) comments render inline as today; resolved
  comments move into a collapsible `Resolved (N)` section, collapsed by default,
  via local toggle state.

### Data model

Unchanged — `resolved: boolean` already exists on `Comment`.

## Testing

- **store**: "republishing a revision resolves all prior comments"; "after a
  revise, the next `changes_requested` verdict returns only the new revision's
  comments" (server-level, exercising the filter).
- **companion**: a resolved anchored comment is **not** highlighted; resolved
  comments are hidden by default and appear when the `Resolved (N)` toggle is
  expanded; active comments stay inline.

## Out of scope

- Manual per-comment resolve control (auto-resolve only).
- Un-resolving / re-opening a comment.
- Revision switcher / diff view (tracked separately as future work).
