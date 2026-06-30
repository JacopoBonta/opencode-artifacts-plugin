import React from "react"

const SHORTCUTS: { keys: string[]; label: string }[] = [
  { keys: ["⌘", "K"], label: "go to artifact" },
  { keys: ["j"], label: "move down in the tree" },
  { keys: ["k"], label: "move up in the tree" },
  { keys: ["↵"], label: "open the selected artifact" },
  { keys: ["["], label: "previous tab" },
  { keys: ["]"], label: "next tab" },
  { keys: ["w"], label: "close the current tab" },
  { keys: ["a"], label: "approve the plan" },
  { keys: ["c"], label: "focus the comment box" },
  { keys: ["?"], label: "show this help" },
  { keys: ["Esc"], label: "close palette / overlay" },
]

/** The shortcut reference list, reused by the empty state and the help overlay. */
export function ShortcutList() {
  return (
    <ul className="shortcut-list">
      {SHORTCUTS.map((s) => (
        <li key={s.label}>
          {s.keys.map((k) => <kbd key={k}>{k}</kbd>)}
          <span>{s.label}</span>
        </li>
      ))}
    </ul>
  )
}

/** Modal overlay listing every keyboard shortcut. Closed via backdrop click or Esc. */
export function ShortcutHelp({ onClose }: { onClose: () => void }) {
  return (
    <div className="palette-overlay" onMouseDown={onClose}>
      <div
        className="shortcut-help"
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2>Keyboard shortcuts</h2>
        <ShortcutList />
      </div>
    </div>
  )
}
