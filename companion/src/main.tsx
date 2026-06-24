import React from "react"
import { createRoot } from "react-dom/client"
import { App } from "./App"
import { initTheme } from "./theme"
import { initLayoutPrefs } from "./layoutPrefs"

initTheme()
initLayoutPrefs()
createRoot(document.getElementById("root")!).render(<App />)
