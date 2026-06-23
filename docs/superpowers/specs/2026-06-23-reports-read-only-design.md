# Reports Are Read-Only — Design

**Date:** 2026-06-23
**Status:** Approved (design)
**Builds on:** [2026-06-22 opencode artifacts plugin design](2026-06-22-opencode-artifacts-plugin-design.md), [2026-06-23 lock approved plan](2026-06-23-lock-approved-plan-design.md)

## Problem

A report is the agent's "here's what I did when I finished" — it doesn't make
sense to comment on or otherwise act on it. Today reports are interactive
(comment box, anchored comments, and a *Request refinement* action). Since
*Request refinement* only ever applied to reports, making reports read-only
removes that pathway entirely.

## Behavior

- A **report** is view-only in the companion: no comment box, no
  text-selection commenting, no action bar. The document remains fully viewable
  (rendered markdown + revision switcher). The comments rail shows a short
  muted note: **"Agent report — read-only."**
- **Plans are unchanged** — comment, Approve, Request changes; approved and
  historical plan revisions are already read-only.
- The **"Request refinement" feature is removed entirely** (it only existed for
  reports).
- Agents still **publish** reports exactly as before (the `publish_artifact`
  tool is unchanged) — reports are simply read-only for humans.

## Companion (`companion/src/`)

- `App.tsx`:
  - `interactive = isLatest && detail.artifact.type === "plan" && detail.artifact.status !== "approved"`.
  - Comments rail: `interactive` → the existing interactive block; else if the
    artifact is a report → the read-only note; else (read-only plan: approved or
    historical) → the read-only `CommentThread`.
  - `onAnchor` stays gated on `interactive` (reports get a no-op — no
    commenting).
  - Remove the `verdict("refine")` usage; `verdict` handles
    `"approved" | "changes_requested"`.
- `ActionBar.tsx`: simplify to plan-only (Approve / Request changes). Remove the
  `type` and `onRefine` props and the report branch.
- `api.ts`: `postVerdict` status narrows to `"approved" | "changes_requested"`.

## Backend (`src/`)

- `server.ts`:
  - Reject `POST /api/artifacts/:id/comments` and
    `POST /api/artifacts/:id/verdict` with **409** when the artifact's type is
    `report` (alongside the existing approved-plan guard).
  - Remove the now-unreachable `b.status === "refine"` branch and the `onRefine`
    option from `ServerOptions`.
- `index.ts`: remove the `onRefine` handler and the `event`-hook session-id
  tracking (`lastSessionID`) that existed only to support refinement.
- `tools.ts` / `publish_artifact`: unchanged — agents still publish reports.

## Testing

- **server**: posting a comment to a report returns 409; posting a verdict to a
  report returns 409. Remove the old "verdict {refine} triggers onRefine" test.
- **App**: a report renders read-only — no comment input, no Approve /
  Request-changes / Request-refinement buttons, and shows the read-only note;
  plans remain interactive.
- **ActionBar**: updated to plan-only (Approve + Request changes fire their
  callbacks); the report-variant test is removed.

## Out of scope

- Changing how agents publish reports.
- Any new report-specific viewer or layout.
