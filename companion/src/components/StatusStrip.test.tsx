import { test, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { StatusStrip } from "./StatusStrip"

test("renders the message in a polite status region while working", () => {
  render(<StatusStrip status={{ state: "working", message: "Editing server.ts" }} />)
  const region = screen.getByRole("status")
  expect(region).toHaveAttribute("aria-live", "polite")
  expect(region).not.toHaveClass("idle")
  expect(screen.getByText("Editing server.ts")).toBeInTheDocument()
})

test("shows a dim Idle line when idle", () => {
  render(<StatusStrip status={{ state: "idle", message: "" }} />)
  expect(screen.getByRole("status")).toHaveClass("idle")
  expect(screen.getByText("Idle")).toBeInTheDocument()
})

test("shows the Idle line when there is no status at all", () => {
  render(<StatusStrip status={undefined} />)
  expect(screen.getByRole("status")).toHaveClass("idle")
  expect(screen.getByText("Idle")).toBeInTheDocument()
})

test("falls back to Idle when working but the message is empty", () => {
  render(<StatusStrip status={{ state: "working", message: "" }} />)
  expect(screen.getByRole("status")).toHaveClass("idle")
  expect(screen.getByText("Idle")).toBeInTheDocument()
})
