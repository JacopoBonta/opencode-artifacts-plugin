import React, { useState } from "react"
import { getThemeChoice, setThemeChoice, type ThemeChoice } from "../theme"

const ORDER: ThemeChoice[] = ["system", "light", "dark"]
const ICON: Record<ThemeChoice, string> = { system: "🖥", light: "☀", dark: "☾" }
const LABEL: Record<ThemeChoice, string> = { system: "System", light: "Light", dark: "Dark" }

export function ThemeToggle() {
  const [choice, setChoice] = useState<ThemeChoice>(getThemeChoice())

  function cycle() {
    const next = ORDER[(ORDER.indexOf(choice) + 1) % ORDER.length]
    setThemeChoice(next)
    setChoice(next)
  }

  return (
    <button
      type="button"
      className="theme-toggle"
      aria-label={`Theme: ${LABEL[choice]}`}
      title={`Theme: ${LABEL[choice]} — click to change`}
      onClick={cycle}
    >
      {ICON[choice]}
    </button>
  )
}
