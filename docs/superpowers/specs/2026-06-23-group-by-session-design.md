# Group Artifacts by Session — Design

**Date:** 2026-06-23
**Status:** Approved (design)
**Builds on:** [2026-06-22 opencode artifacts plugin design](2026-06-22-opencode-artifacts-plugin-design.md)

## Goal

Make the artifact list easier to navigate by grouping artifacts under the
opencode **session** that produced them, with a human-friendly session title as
the group header. Each artifact already stores its `sessionID` (set at publish
time from the tool context) and `list()` returns it; we surface and group by it.

## Data flow (backend)

- `GET /api/artifacts` augments each artifact in the response with a resolved
  **`sessionTitle`**. `createServer` takes an injected
  `resolveSessionTitle?: (sessionID: string) => Promise<string | undefined>`
  (kept injectable so tests run headless). When the option is absent, the
  response is unchanged (no `sessionTitle`).
- `index.ts` supplies the real resolver backed by the opencode SDK
  (`client.session.get(...)`), wrapped in an **in-memory `Map` cache** keyed by
  sessionID so repeated list calls don't repeatedly hit the SDK. The exact SDK
  shape for a session's title is verified against `@opencode-ai/sdk` at
  implementation time (as done for the other `client.*` calls). If a session has
  no title (or the call fails), `sessionTitle` is left undefined and the UI
  falls back to a short id.

## Companion

- `api.ts`: `Artifact` gains `sessionID?: string` and `sessionTitle?: string`
  (already in the JSON; now typed).
- `ArtifactList.tsx`: group artifacts by `sessionID` into **collapsible**
  sections.
  - Header: `sessionTitle`, else `Session <short id>` (last 6 chars), plus the
    artifact count.
  - Group order: most-recent first, by each group's latest `updatedAt`.
  - Within a group: artifacts keep their existing order.
  - The group containing the **selected** artifact is expanded by default;
    others collapsed. Clicking a header toggles its group.
  - Artifacts with no `sessionID` go under an **"Ungrouped"** section.
- `App.css`: group-header styles (chevron + title + count), themed via existing
  tokens.

Everything else is unchanged: selection, SSE refresh, revision switcher,
read-only reports, approved-plan lock, auto-select (still the first artifact —
its group simply starts expanded).

## Testing

- **server**: `GET /api/artifacts` includes `sessionTitle` for each artifact
  when a resolver is provided (fake resolver in the test); without a resolver,
  artifacts are still returned (no `sessionTitle`).
- **ArtifactList**: renders one header per session with the title and a correct
  count; collapsing a group hides its items and expanding shows them; clicking
  an item still calls `onSelect`; an artifact with no `sessionID` appears under
  "Ungrouped".

## Out of scope

- Filtering or search over artifacts/sessions.
- Renaming sessions from the companion.
- A flat-vs-grouped view toggle.
- Changing which artifact auto-selects on load.
