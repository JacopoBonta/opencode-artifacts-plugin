# Clickable Anchor ↔ Comment Cross-Linking — Design

**Date:** 2026-06-23
**Status:** Approved (design)
**Builds on:** [2026-06-22 opencode artifacts plugin design](2026-06-22-opencode-artifacts-plugin-design.md)

## Problem

Anchored comments are highlighted in the rendered artifact, but the highlight
and its comment are not linked: you can't click a highlight to find its comment,
or click a comment to find its highlight. The original spec line — "clicking an
anchor opens its thread" — was never implemented.

## Behavior

Bidirectional cross-linking, keyed by comment `id`:

- **Click a highlighted span** in the document → its comment scrolls into view in
  the rail and briefly **flashes**.
- **Click an anchored comment** in the rail → its highlight in the document
  scrolls into view and **flashes**.

Works in both the latest (interactive) and historical (read-only) views, since
both render highlights. The flash is transient (no persistent selection state).

## Components / interfaces (`companion/src/`)

- **New `flash.ts`** — `flashElement(el)`: guarded `scrollIntoView` (jsdom has no
  real implementation) + add a `.flash` class, removed after ~1.2s.
- **`ArtifactView`**
  - `wrapRange` also stamps `mark.dataset.commentId`.
  - Container click delegates to the nearest `mark.anchor-highlight` →
    `onHighlightClick(commentId)`.
  - New props `onHighlightClick?`, `flashAnchorId?`, `flashKey?`; an effect
    flashes the mark(s) for `flashAnchorId` whenever `flashKey` changes.
- **`CommentThread`**
  - Refactor to a single root `ref` so both the interactive and `readOnly` paths
    share the flash effect.
  - Each `CommentItem` carries `data-comment-id`; **anchored** items become
    clickable → `onCommentClick(id)` (general comments stay non-clickable).
  - New props `onCommentClick?`, `flashCommentId?`, `flashKey?`; effect flashes
    the matching item.
- **`App`**
  - Holds two nonce-keyed flash states (`flashComment`, `flashAnchor`) and a
    monotonic counter (a `useRef`).
  - `onHighlightClick` → set `flashComment{id, key++}`; `onCommentClick` → set
    `flashAnchor{id, key++}`.
  - Passes the matching props into `ArtifactView` and `CommentThread` in both
    the latest and historical view branches.

## Data flow

1. Click highlight → `ArtifactView.onHighlightClick(id)` → App sets
   `flashComment{id, key++}` → `CommentThread` flashes that comment.
2. Click comment → `CommentThread.onCommentClick(id)` → App sets
   `flashAnchor{id, key++}` → `ArtifactView` flashes that mark.

The nonce `key` lets the same target re-flash on repeated clicks (the effect
re-runs even when the id is unchanged).

## Testing

- `flash.ts`: adds `.flash`, removes it after the timer (fake timers);
  `scrollIntoView` is guarded so it's safe under jsdom.
- `ArtifactView`: clicking a mark fires `onHighlightClick` with the comment id;
  setting `flashAnchorId` + `flashKey` adds `.flash` to the matching mark.
- `CommentThread`: clicking an anchored comment fires `onCommentClick`; a general
  comment is not clickable; `flashCommentId` flashes the matching item.
- `App`: clicking a rendered highlight flashes its comment (one end-to-end
  direction through the real components).

## Out of scope

- Keyboard navigation between anchors.
- Persistent "selected comment" state (flash is transient only).
