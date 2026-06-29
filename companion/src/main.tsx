import React from "react"
import { createRoot } from "react-dom/client"
import { App } from "./App"
import { initTheme } from "./theme"
import { initLayoutPrefs } from "./layoutPrefs"
import { initToken } from "./token"

initToken()
initTheme()
initLayoutPrefs()
createRoot(document.getElementById("root")!).render(<App />)
