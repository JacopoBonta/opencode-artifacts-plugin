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
