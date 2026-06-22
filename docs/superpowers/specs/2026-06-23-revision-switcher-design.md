# Revision Switcher (Read-Only History) — Design

**Date:** 2026-06-23
**Status:** Approved (design)
**Builds on:** [2026-06-22 opencode artifacts plugin design](2026-06-22-opencode-artifacts-plugin-design.md), [2026-06-23 comment auto-resolve](2026-06-23-comment-auto-resolve-design.md)

## Problem

The companion only ever renders the latest revision. You can't look back at a
prior revision (e.g. rev 001 vs the current 002) or see the feedback that drove
a revision. The backend already stores every revision and tags comments with
the revision they were made on, but the UI doesn't surface it.

## Behavior

A dropdown lets you pick any revision 1..M (M = `artifact.currentRevision`).

- **Latest revision:** unchanged — interactive comments, `Resolved (N)` toggle,
  action bar, anchor highlights for *unresolved* comments.
- **Historical revision (N < M):** read-only. Renders revision N's content;
  highlights the anchored comments made on revision N; lists revision N's
  comments read-only; shows a banner *"Revision N of M (historical) · Back to
  latest"*. No comment input, no action bar.

Selecting a different artifact, or a new revision arriving over SSE, resets the
view to the latest revision.

## Architecture — no backend changes

Everything needed already exists:
- `GET /api/artifacts/:id/revisions/:n → { content }` serves any revision.
- The detail response (`GET /api/artifacts/:id`) returns **all** comments, each
  carrying its `revision`.
- `artifact.currentRevision` is the revision count M.

This is a **companion-only** change.

## Components / state (`companion/src/`)

- `api.ts`: add `getRevision(id, n): Promise<{ content: string }>` hitting the
  existing endpoint.
- `App.tsx`: add `viewedRevision` state (defaults to latest). Derive `isLatest`.
  When a historical revision is selected, fetch its content into
  `historicalContent`. Reset to latest on artifact change or new-revision event.
  Render the interactive path when `isLatest`, the read-only path otherwise.
- New `RevisionSwitcher` component: a `<select>` listing "Revision k of M" for
  k = 1..M, rendered only when M > 1; `onChange` → `setViewedRevision`.
- `ArtifactView`: add a `highlightResolved?: boolean` prop. Latest passes
  `false` (highlight only unresolved — current behavior). Historical passes
  `true` plus only that revision's comments, so addressed feedback is shown.
- `CommentThread`: add a `readOnly?: boolean` prop — hides the textarea/Comment
  button and renders comments as a flat read-only list (no active/resolved
  split). Used for historical views.

## Data flow

1. `App` loads the artifact detail (all comments + latest content) as today.
2. User picks revision N in `RevisionSwitcher`.
3. If N is the latest: render the interactive latest view (no fetch needed).
4. If N < M: `App` calls `api.getRevision(id, N)`, stores `historicalContent`,
   and renders the read-only view with `comments.filter(c => c.revision === N)`.
5. "Back to latest" clears `viewedRevision`, returning to the interactive view.

## Testing

- `api`: `getRevision` GETs `/api/artifacts/:id/revisions/:n`.
- `RevisionSwitcher`: renders M options and fires `onChange`; renders nothing
  when M = 1.
- `CommentThread`: `readOnly` hides the input and lists comments flat.
- `ArtifactView`: with `highlightResolved`, a resolved anchored comment IS
  highlighted (the historical path); without it, resolved comments are skipped
  (existing behavior preserved).
- `App`: selecting an older revision fetches and renders its content, shows the
  banner, and shows no Approve button; "Back to latest" restores the
  interactive view with the action bar.

## Out of scope

- Side-by-side diff between revisions (tracked separately as future work).
- Editing or commenting on historical revisions.
