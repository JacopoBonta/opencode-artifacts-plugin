import { test, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { CommandPalette, fuzzyMatch } from "./CommandPalette"
import type { Artifact } from "../api"

const art = (id: string, title: string, extra: Partial<Artifact> = {}): Artifact => ({
  id, type: "plan", title, status: "awaiting_review", currentRevision: 1, createdAt: 0, updatedAt: 0, ...extra,
})

test("fuzzyMatch matches subsequences case-insensitively", () => {
  expect(fuzzyMatch("lf", "Login Flow")).toBe(true)
  expect(fuzzyMatch("LOGIN", "Login Flow")).toBe(true)
  expect(fuzzyMatch("xyz", "Login Flow")).toBe(false)
})

test("filters by query and opens the chosen entry", async () => {
  const onOpen = vi.fn()
  const onClose = vi.fn()
  render(
    <CommandPalette
      artifacts={[art("1", "Login flow"), art("2", "Deploy script")]}
      onOpen={onOpen}
      onClose={onClose}
    />,
  )
  expect(screen.getByText("Login flow")).toBeInTheDocument()
  expect(screen.getByText("Deploy script")).toBeInTheDocument()
  await userEvent.type(screen.getByPlaceholderText("Go to artifact…"), "deploy")
  expect(screen.queryByText("Login flow")).toBeNull()
  await userEvent.click(screen.getByText("Deploy script"))
  expect(onOpen).toHaveBeenCalledWith("2")
  expect(onClose).toHaveBeenCalled()
})

test("lists archived artifacts under a separate Archived section, after the active ones", () => {
  const { container } = render(
    <CommandPalette
      artifacts={[art("1", "Live"), art("2", "Old", { archived: true })]}
      onOpen={() => {}}
      onClose={() => {}}
    />,
  )
  // Archived are no longer excluded — both show...
  expect(screen.getByText("Live")).toBeInTheDocument()
  expect(screen.getByText("Old")).toBeInTheDocument()
  // ...under an "Archived" divider, with the archived row marked + ordered last.
  expect(screen.getByText("Archived")).toBeInTheDocument()
  const rows = Array.from(container.querySelectorAll(".palette-row"))
  expect(rows.map((r) => r.querySelector(".palette-title")?.textContent)).toEqual(["Live", "Old"])
  expect(rows[1].className).toContain("archived")
})

test("the Archived divider disappears when no archived artifact matches the query", async () => {
  render(
    <CommandPalette
      artifacts={[art("1", "Live"), art("2", "Old", { archived: true })]}
      onOpen={() => {}}
      onClose={() => {}}
    />,
  )
  expect(screen.getByText("Archived")).toBeInTheDocument()
  // Query matches only the active "Live" → no archived results, so no divider.
  await userEvent.type(screen.getByPlaceholderText("Go to artifact…"), "live")
  expect(screen.getByText("Live")).toBeInTheDocument()
  expect(screen.queryByText("Old")).toBeNull()
  expect(screen.queryByText("Archived")).toBeNull()
})

test("Enter opens the highlighted result", async () => {
  const onOpen = vi.fn()
  render(
    <CommandPalette
      artifacts={[art("1", "Login flow"), art("2", "Deploy script")]}
      onOpen={onOpen}
      onClose={() => {}}
    />,
  )
  const input = screen.getByPlaceholderText("Go to artifact…")
  await userEvent.type(input, "deploy{Enter}")
  expect(onOpen).toHaveBeenCalledWith("2")
})
