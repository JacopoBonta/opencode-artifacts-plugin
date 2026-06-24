import React, { useState } from "react"
import { getReadingWidth, setReadingWidth, type ReadingWidth } from "../layoutPrefs"

export function ReadingWidthToggle() {
  const [width, setLocal] = useState<ReadingWidth>(getReadingWidth())

  function toggle() {
    const next: ReadingWidth = width === "comfortable" ? "stretched" : "comfortable"
    setReadingWidth(next)
    setLocal(next)
  }

  return (
    <button
      type="button"
      className="theme-toggle"
      aria-label="Toggle reading width"
      title={width === "comfortable" ? "Switch to full width" : "Switch to centered reading width"}
      onClick={toggle}
    >
      {width === "comfortable" ? "⇔" : "▥"}
    </button>
  )
}
