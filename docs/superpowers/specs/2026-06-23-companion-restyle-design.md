# Companion Restyle (Dark default + Light alternative) — Design

**Date:** 2026-06-23
**Status:** Approved (design)
**Builds on:** [2026-06-22 opencode artifacts plugin design](2026-06-22-opencode-artifacts-plugin-design.md)

## Goal

Give the browser companion a modern, stylish look — a dark, developer-tool feel
by default (at home next to a terminal), with a light alternative the user can
toggle. Layout and behavior are unchanged; this is a visual overhaul plus a
theme switch.

## Theme system

- **Design tokens** as CSS custom properties: the dark palette under `:root`
  (default), the light palette under `[data-theme="light"]`. Tokens:
  `--bg`, `--surface`, `--surface-2`, `--border`, `--text`, `--text-muted`,
  `--accent`, `--accent-fg`, plan/report colors, status colors, `--radius`,
  and elevation shadow(s). Every component reads tokens, so switching themes is
  a single attribute flip on the root element.
- **`theme.ts`**: `getTheme()`, `setTheme(t)`, `initTheme()`. Persists to
  `localStorage` (key `oc-artifacts-theme`), defaults to **dark**, and writes
  `document.documentElement.dataset.theme`. `main.tsx` calls `initTheme()`
  before render to avoid a flash of the wrong theme.
- **`ThemeToggle`** component: a small sun/moon button (inline SVG/Unicode, no
  icon dependency) in the left-rail header, always visible. Clicking flips the
  theme and persists it.

## Visual treatment (layout unchanged — same 3 columns, same behavior)

- **Typography:** rem-based type scale; UI sans stack (`Inter, ui-sans-serif,
  system-ui, …`) and a monospace stack for code; comfortable line-height; a
  readable max-width for the rendered document body.
- **Left rail (artifact list):** rows as cards with hover state and a left
  accent bar + subtle fill when selected; artifact type as a colored pill
  badge (plan/report); status as a small chip.
- **Main header:** slim bar with title, revision dropdown, and status chip.
- **Markdown content:** styled headings, lists, links, inline `code` and code
  blocks (on `--surface-2`, padded, rounded), and blockquotes. Anchor
  highlights use an accent-tinted background; the flash becomes an accent ring
  pulse.
- **Comments rail:** comment cards; the anchored quote shown as a left-bordered
  snippet; clickable (anchored) comments get a clear hover affordance; the
  `Resolved (N)` toggle and the composer (textarea + button) restyled.
- **Buttons:** primary (filled accent) for Approve; secondary (outline) for
  Request changes / Request refinement; consistent `:focus-visible` rings.
- **Banners:** historical (info), approved (success), connection-lost (warning)
  — all themed via tokens.
- **Details:** themed scrollbars, focus-visible outlines, subtle transitions.

## Files

- `companion/src/theme.ts` — theme get/set/init (+ test).
- `companion/src/components/ThemeToggle.tsx` — toggle button (+ test).
- `companion/src/App.css` — the bulk: tokens, both palettes, and all component
  styling.
- `companion/src/main.tsx` — call `initTheme()` before `createRoot(...).render`.
- `companion/src/App.tsx` — mount `ThemeToggle` in the left-rail header.

## Testing

- `theme.ts`: defaults to dark with no stored value; `setTheme` persists to
  `localStorage` and sets `document.documentElement.dataset.theme`; `initTheme`
  applies the stored value.
- `ThemeToggle`: renders with an accessible name; clicking flips
  `document.documentElement.dataset.theme` and persists.
- CSS is not unit-tested. All existing tests keep passing: class names and DOM
  structure are preserved, queries are by role/text/placeholder, and the
  toggle's accessible name does not collide with existing button queries.

## Out of scope

- Layout/structure changes (restyle-only was chosen).
- New icon/font npm dependencies (inline SVG/Unicode; web-font optional via
  CSS stack fallback only — no bundled font files).
- Animations beyond subtle transitions.
