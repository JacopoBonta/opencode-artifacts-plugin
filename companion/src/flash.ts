/** Scroll an element into view (if supported) and briefly add a `.flash` class. */
export function flashElement(el: HTMLElement | null): void {
  if (!el) return
  if (typeof el.scrollIntoView === "function") {
    try { el.scrollIntoView({ block: "nearest" }) } catch { /* jsdom has no layout */ }
  }
  el.classList.add("flash")
  setTimeout(() => el.classList.remove("flash"), 1200)
}
