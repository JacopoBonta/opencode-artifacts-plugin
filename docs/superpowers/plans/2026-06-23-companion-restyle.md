# Companion Restyle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the companion a modern look — a dark default theme with a light alternative toggle — by adding a token-based stylesheet and a theme switcher, with no layout or behavior changes.

**Architecture:** A `theme.ts` module persists the choice (default dark) and sets `data-theme` on the root; `main.tsx` initializes it before render; a `ThemeToggle` button in the left rail flips it. `App.css` becomes a token-driven stylesheet with dark (`:root`) and light (`[data-theme="light"]`) palettes, styling every existing class.

**Tech Stack:** React + Vite + Vitest; vanilla CSS custom properties (no framework, no icon/font deps).

---

## File Structure

- `companion/src/theme.ts` — CREATE: `getTheme`/`setTheme`/`initTheme` (+ test).
- `companion/src/components/ThemeToggle.tsx` — CREATE: toggle button (+ test).
- `companion/src/main.tsx` — MODIFY: call `initTheme()` before render.
- `companion/src/App.tsx` — MODIFY: mount `ThemeToggle` in the left-rail header.
- `companion/src/App.css` — REPLACE: token-driven stylesheet (dark + light), all components.
- Tests: `theme.test.ts`, `ThemeToggle.test.tsx`, plus one `App.test.tsx` assertion.

All commands run from `companion/`.

---

## Task 1: `theme.ts`

**Files:**
- Create: `companion/src/theme.ts`
- Test: `companion/src/theme.test.ts`

- [ ] **Step 1: Write the failing test** — create `companion/src/theme.test.ts`:

```ts
import { test, expect, beforeEach } from "vitest"
import { getTheme, setTheme, initTheme } from "./theme"

beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute("data-theme")
})

test("defaults to dark with no stored value", () => {
  expect(getTheme()).toBe("dark")
})

test("setTheme persists to localStorage and applies to documentElement", () => {
  setTheme("light")
  expect(localStorage.getItem("oc-artifacts-theme")).toBe("light")
  expect(document.documentElement.dataset.theme).toBe("light")
  expect(getTheme()).toBe("light")
})

test("initTheme applies the stored value", () => {
  localStorage.setItem("oc-artifacts-theme", "light")
  initTheme()
  expect(document.documentElement.dataset.theme).toBe("light")
})

test("initTheme applies dark when nothing is stored", () => {
  initTheme()
  expect(document.documentElement.dataset.theme).toBe("dark")
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test src/theme.test.ts`
Expected: FAIL — cannot find module `./theme`.

- [ ] **Step 3: Implement** — create `companion/src/theme.ts`:

```ts
export type Theme = "dark" | "light"

const KEY = "oc-artifacts-theme"

export function getTheme(): Theme {
  return localStorage.getItem(KEY) === "light" ? "light" : "dark"
}

export function setTheme(t: Theme): void {
  localStorage.setItem(KEY, t)
  document.documentElement.dataset.theme = t
}

export function initTheme(): void {
  setTheme(getTheme())
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test src/theme.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add companion/src/theme.ts companion/src/theme.test.ts
git commit -m "feat: theme module (persisted dark/light)"
```

---

## Task 2: `ThemeToggle` component

**Files:**
- Create: `companion/src/components/ThemeToggle.tsx`
- Test: `companion/src/components/ThemeToggle.test.tsx`

- [ ] **Step 1: Write the failing test** — create `companion/src/components/ThemeToggle.test.tsx`:

```tsx
import { test, expect, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { ThemeToggle } from "./ThemeToggle"

beforeEach(() => {
  localStorage.clear()
  document.documentElement.dataset.theme = "dark"
})

test("renders a toggle and flips the theme on click", async () => {
  render(<ThemeToggle />)
  const btn = screen.getByRole("button", { name: /toggle theme/i })
  await userEvent.click(btn)
  expect(document.documentElement.dataset.theme).toBe("light")
  expect(localStorage.getItem("oc-artifacts-theme")).toBe("light")
  await userEvent.click(btn)
  expect(document.documentElement.dataset.theme).toBe("dark")
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test src/components/ThemeToggle.test.tsx`
Expected: FAIL — cannot find module `./ThemeToggle`.

- [ ] **Step 3: Implement** — create `companion/src/components/ThemeToggle.tsx`:

```tsx
import React, { useState } from "react"
import { getTheme, setTheme, type Theme } from "../theme"

export function ThemeToggle() {
  const [theme, setLocal] = useState<Theme>(getTheme())

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark"
    setTheme(next)
    setLocal(next)
  }

  return (
    <button
      type="button"
      className="theme-toggle"
      aria-label="Toggle theme"
      title="Toggle light / dark theme"
      onClick={toggle}
    >
      {theme === "dark" ? "☀" : "☾"}
    </button>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test src/components/ThemeToggle.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add companion/src/components/ThemeToggle.tsx companion/src/components/ThemeToggle.test.tsx
git commit -m "feat: ThemeToggle button"
```

---

## Task 3: Wire the toggle in (App + main)

**Files:**
- Modify: `companion/src/main.tsx`
- Modify: `companion/src/App.tsx`
- Test: `companion/src/App.test.tsx`

- [ ] **Step 1: Write the failing test** — append to `companion/src/App.test.tsx`:

```tsx
test("the left rail shows a theme toggle that flips the theme", async () => {
  localStorage.clear()
  document.documentElement.dataset.theme = "dark"
  render(<App />)
  const btn = await screen.findByRole("button", { name: /toggle theme/i })
  await userEvent.click(btn)
  expect(document.documentElement.dataset.theme).toBe("light")
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test src/App.test.tsx`
Expected: FAIL — no "Toggle theme" button rendered yet.

- [ ] **Step 3: Implement — `main.tsx`** — replace `companion/src/main.tsx` with:

```tsx
import React from "react"
import { createRoot } from "react-dom/client"
import { App } from "./App"
import { initTheme } from "./theme"

initTheme()
createRoot(document.getElementById("root")!).render(<App />)
```

- [ ] **Step 4: Implement — `App.tsx`** — add the import and mount the toggle in the left-rail header.

Add the import near the other component imports:

```tsx
import { ThemeToggle } from "./components/ThemeToggle"
```

Replace the left-rail block:

```tsx
      <aside className="rail">
        <h2>Artifacts</h2>
        <ArtifactList artifacts={artifacts} selectedId={selectedId} onSelect={select} />
      </aside>
```

with:

```tsx
      <aside className="rail">
        <div className="rail-header">
          <h2>Artifacts</h2>
          <ThemeToggle />
        </div>
        <ArtifactList artifacts={artifacts} selectedId={selectedId} onSelect={select} />
      </aside>
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun run test src/App.test.tsx`
Expected: PASS (all App tests, including the new toggle test).

- [ ] **Step 6: Commit**

```bash
git add companion/src/main.tsx companion/src/App.tsx companion/src/App.test.tsx
git commit -m "feat: init theme on load and mount ThemeToggle in the rail"
```

---

## Task 4: Token-driven stylesheet (dark + light)

No new tests — CSS isn't unit-tested. Verification is the full suite (still green), typecheck, and a successful build.

**Files:**
- Modify (replace): `companion/src/App.css`

- [ ] **Step 1: Replace `companion/src/App.css` with the full token-driven stylesheet:**

```css
:root {
  /* dark (default) */
  --bg: #0f1115;
  --surface: #161922;
  --surface-2: #1d2230;
  --border: #2a3040;
  --text: #e6e8ec;
  --text-muted: #98a2b3;
  --accent: #6366f1;
  --accent-hover: #7c80f5;
  --accent-fg: #ffffff;
  --plan: #818cf8;
  --report: #22d3ee;
  --status-awaiting_review: #fbbf24;
  --status-approved: #34d399;
  --status-changes_requested: #f87171;
  --info-bg: rgba(59, 130, 246, 0.14);
  --info-fg: #93c5fd;
  --success-bg: rgba(16, 185, 129, 0.14);
  --success-fg: #6ee7b7;
  --warn-bg: rgba(245, 158, 11, 0.16);
  --warn-fg: #fcd34d;
  --highlight-bg: rgba(99, 102, 241, 0.32);
  --code-bg: #11141c;
  --radius: 10px;
  --radius-sm: 7px;
  --shadow: 0 1px 2px rgba(0, 0, 0, 0.4), 0 4px 16px rgba(0, 0, 0, 0.28);
  --font-sans: Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
}

[data-theme="light"] {
  --bg: #f6f7f9;
  --surface: #ffffff;
  --surface-2: #f1f3f6;
  --border: #e3e6ec;
  --text: #1b1f27;
  --text-muted: #6b7280;
  --accent: #4f46e5;
  --accent-hover: #4338ca;
  --accent-fg: #ffffff;
  --plan: #4f46e5;
  --report: #0891b2;
  --status-awaiting_review: #b45309;
  --status-approved: #15803d;
  --status-changes_requested: #b91c1c;
  --info-bg: #eff6ff;
  --info-fg: #1e40af;
  --success-bg: #ecfdf5;
  --success-fg: #065f46;
  --warn-bg: #fef3c7;
  --warn-fg: #92400e;
  --highlight-bg: #fde68a;
  --code-bg: #f1f3f6;
  --shadow: 0 1px 2px rgba(16, 24, 40, 0.06), 0 4px 16px rgba(16, 24, 40, 0.06);
}

* { box-sizing: border-box; }
html, body { height: 100%; }
body {
  margin: 0;
  font-family: var(--font-sans);
  font-size: 14px;
  line-height: 1.5;
  color: var(--text);
  background: var(--bg);
  -webkit-font-smoothing: antialiased;
}
button { font-family: inherit; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 4px; }

* { scrollbar-width: thin; scrollbar-color: var(--border) transparent; }
::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-thumb { background: var(--border); border-radius: 8px; border: 2px solid transparent; background-clip: padding-box; }
::-webkit-scrollbar-thumb:hover { background: var(--text-muted); }

/* layout */
.layout { display: grid; grid-template-columns: 264px 1fr 340px; height: 100vh; background: var(--bg); }
.rail { background: var(--surface); border-right: 1px solid var(--border); padding: 16px; overflow-y: auto; }
.comments-rail { border-right: none; border-left: 1px solid var(--border); display: flex; flex-direction: column; }
.main { padding: 28px 32px; overflow-y: auto; }

/* left rail header */
.rail-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
.rail-header h2 { margin: 0; font-size: 12px; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; color: var(--text-muted); }
.theme-toggle { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; border-radius: 8px; border: 1px solid var(--border); background: var(--surface-2); color: var(--text); font-size: 14px; line-height: 1; cursor: pointer; transition: border-color 0.15s, background 0.15s; }
.theme-toggle:hover { border-color: var(--accent); }

/* artifact list */
.artifact-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.artifact-list li { position: relative; padding: 10px 12px; border-radius: var(--radius-sm); cursor: pointer; display: flex; flex-direction: column; gap: 6px; border: 1px solid transparent; transition: background 0.15s, border-color 0.15s; }
.artifact-list li:hover { background: var(--surface-2); }
.artifact-list li.selected { background: var(--surface-2); border-color: var(--border); box-shadow: inset 3px 0 0 var(--accent); }
.artifact-list .title { font-size: 13.5px; font-weight: 550; color: var(--text); }

/* badges + status */
.badge { align-self: flex-start; font-size: 10px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; padding: 2px 7px; border-radius: 999px; }
.badge-plan { color: var(--plan); background: color-mix(in srgb, var(--plan) 16%, transparent); }
.badge-report { color: var(--report); background: color-mix(in srgb, var(--report) 16%, transparent); }
.status { font-size: 11.5px; font-weight: 600; color: var(--text-muted); }
.status-awaiting_review { color: var(--status-awaiting_review); }
.status-approved { color: var(--status-approved); }
.status-changes_requested { color: var(--status-changes_requested); }

/* main header */
.main-header { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 18px; padding-bottom: 14px; border-bottom: 1px solid var(--border); }
.main-header h1 { margin: 0; font-size: 20px; font-weight: 650; }
.main-header-right { display: flex; align-items: center; gap: 12px; }
.revision-switcher { font-size: 12px; padding: 5px 8px; background: var(--surface-2); color: var(--text); border: 1px solid var(--border); border-radius: var(--radius-sm); cursor: pointer; }

/* banners */
.historical-banner { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; padding: 8px 12px; border-radius: var(--radius-sm); background: var(--info-bg); color: var(--info-fg); font-size: 12.5px; }
.historical-banner button { background: none; border: none; color: var(--info-fg); text-decoration: underline; cursor: pointer; font-size: 12.5px; }
.approved-banner { margin-bottom: 16px; padding: 8px 12px; border-radius: var(--radius-sm); background: var(--success-bg); color: var(--success-fg); font-size: 12.5px; font-weight: 600; }
.conn-lost { grid-column: 1 / -1; padding: 8px 16px; background: var(--warn-bg); color: var(--warn-fg); border-bottom: 1px solid var(--border); font-size: 12.5px; }

/* rendered markdown */
.artifact-view { max-width: 760px; }
.artifact-view ::selection { background: var(--highlight-bg); }
.artifact-view h1, .artifact-view h2, .artifact-view h3 { font-weight: 650; line-height: 1.3; margin: 1.4em 0 0.5em; }
.artifact-view h1 { font-size: 22px; }
.artifact-view h2 { font-size: 18px; }
.artifact-view h3 { font-size: 15px; }
.artifact-view p, .artifact-view li { line-height: 1.7; }
.artifact-view a { color: var(--accent); }
.artifact-view code { font-family: var(--font-mono); font-size: 0.88em; background: var(--code-bg); border: 1px solid var(--border); border-radius: 5px; padding: 1px 5px; }
.artifact-view pre { background: var(--code-bg); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 14px 16px; overflow-x: auto; }
.artifact-view pre code { background: none; border: none; padding: 0; }
.artifact-view blockquote { margin: 1em 0; padding: 4px 14px; border-left: 3px solid var(--border); color: var(--text-muted); }
.artifact-view table { border-collapse: collapse; }
.artifact-view th, .artifact-view td { border: 1px solid var(--border); padding: 6px 10px; }
mark.anchor-highlight { background: var(--highlight-bg); color: inherit; border-radius: 3px; padding: 0 1px; cursor: pointer; }

/* comments */
.comment-thread { display: flex; flex-direction: column; flex: 1; min-height: 0; overflow-y: auto; }
.comment-thread h4 { margin: 0 0 12px; font-size: 12px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--text-muted); }
.comment { background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 10px 12px; margin-bottom: 8px; }
.comment p { margin: 0; font-size: 13.5px; }
.comment blockquote { margin: 0 0 6px; padding-left: 8px; border-left: 3px solid var(--accent); color: var(--text-muted); font-size: 12.5px; }
.comment.clickable { cursor: pointer; transition: border-color 0.15s; }
.comment.clickable:hover { border-color: var(--accent); }
.comment.resolved { opacity: 0.55; }
.resolved-section { margin: 4px 0 10px; }
.resolved-toggle { background: none; border: none; padding: 4px 0; color: var(--text-muted); font-size: 12px; cursor: pointer; }
.pending-anchor { background: var(--info-bg); color: var(--info-fg); padding: 8px 10px; border-radius: var(--radius-sm); margin-bottom: 10px; font-size: 12.5px; }
.pending-anchor blockquote { margin: 4px 0 0; padding-left: 8px; border-left: 3px solid currentColor; }
.comment-thread textarea { width: 100%; min-height: 64px; margin-top: 8px; padding: 8px 10px; font-family: inherit; font-size: 13px; color: var(--text); background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-sm); resize: vertical; }
.comment-thread textarea:focus { outline: none; border-color: var(--accent); }
.comment-thread > button { margin-top: 8px; padding: 8px 12px; border-radius: var(--radius-sm); border: 1px solid var(--border); background: var(--surface-2); color: var(--text); font-size: 13px; font-weight: 550; cursor: pointer; }
.comment-thread > button:hover { border-color: var(--accent); }

/* action bar */
.action-bar { margin-top: auto; display: flex; gap: 8px; padding-top: 16px; border-top: 1px solid var(--border); }
.action-bar button { flex: 1; padding: 9px 12px; border-radius: var(--radius-sm); font-size: 13px; font-weight: 600; cursor: pointer; border: 1px solid var(--border); background: var(--surface-2); color: var(--text); transition: background 0.15s, border-color 0.15s; }
.action-bar button:first-child { background: var(--accent); border-color: var(--accent); color: var(--accent-fg); }
.action-bar button:first-child:hover { background: var(--accent-hover); border-color: var(--accent-hover); }
.action-bar button:not(:first-child):hover { border-color: var(--accent); }

/* misc */
.empty { color: var(--text-muted); font-size: 13px; }

@keyframes flash-pulse { 0% { box-shadow: 0 0 0 2px var(--accent); } 100% { box-shadow: 0 0 0 2px transparent; } }
.flash { animation: flash-pulse 1.2s ease-out; border-radius: 4px; }
```

- [ ] **Step 2: Run the full companion suite + typecheck + build**

Run: `bun run test && bunx tsc --noEmit -p tsconfig.json && bun run build`
Expected: all companion tests PASS (unchanged — CSS doesn't affect role/text queries); typecheck clean; `dist/` produced.

- [ ] **Step 3: Manual visual check (documented; run by a human)**

Run `bun run dev` in `companion/`, open the URL with the plugin's API reachable (or just verify the static look), and confirm: dark theme by default, the rail toggle switches to light and persists across reload, and the artifact view / comments / buttons / banners all read correctly in both themes. Record the result.

- [ ] **Step 4: Commit**

```bash
git add companion/src/App.css
git commit -m "feat: token-driven dark/light stylesheet for the companion"
```

---

## Self-Review Notes

- **Spec coverage:** tokens + dark `:root` / light `[data-theme="light"]` palettes (Task 4); `theme.ts` get/set/init persisted, default dark (Task 1); `initTheme` in `main.tsx` before render (Task 3); `ThemeToggle` in left-rail header, always visible (Tasks 2–3); typography/scale, rails/list cards + accent bar, badges/status chips, header, markdown + code/blockquote, comments + composer, primary/secondary buttons, banners, highlight + flash, scrollbars, focus-visible (Task 4); layout unchanged (same grid/columns/structure); no new deps (Unicode glyphs, CSS-only). Testing: `theme.ts` + `ThemeToggle` behavior; existing suite preserved (Tasks 1–3 tests + Task 4 verification).
- **Type consistency:** `Theme` type and `getTheme`/`setTheme`/`initTheme` names match across `theme.ts`, `ThemeToggle.tsx`, and `main.tsx`; localStorage key `oc-artifacts-theme` is identical in `theme.ts` and both tests; `ThemeToggle`'s accessible name "Toggle theme" matches the App + component test queries and doesn't collide with existing button names (Approve / Request changes / Request refinement / Resolved / Comment / Back to latest).
- **No placeholders:** every step is complete and runnable.
- **Note:** `color-mix()` (badge backgrounds) is widely supported in current browsers; the companion runs in the user's modern browser, so it's safe. If a target browser lacked it, the text color still renders (only the subtle pill background would be absent).
