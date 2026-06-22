import { test, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { CommentThread } from "./CommentThread"
import type { Comment } from "../api"

const comments: Comment[] = [
  { id: "a", revision: 2, kind: "general", body: "active note", resolved: false, createdAt: 0 },
  { id: "b", revision: 1, kind: "general", body: "resolved note", resolved: true, createdAt: 0 },
]

test("active comments show inline; resolved are hidden until the toggle is expanded", async () => {
  render(<CommentThread comments={comments} onAdd={() => {}} title="Comments" />)
  expect(screen.getByText("active note")).toBeInTheDocument()
  expect(screen.queryByText("resolved note")).toBeNull()

  await userEvent.click(screen.getByRole("button", { name: /resolved \(1\)/i }))
  expect(screen.getByText("resolved note")).toBeInTheDocument()
})

test("no Resolved toggle is shown when there are no resolved comments", () => {
  render(
    <CommentThread
      comments={[{ id: "a", revision: 1, kind: "general", body: "only active", resolved: false, createdAt: 0 }]}
      onAdd={() => {}}
    />,
  )
  expect(screen.queryByRole("button", { name: /resolved \(/i })).toBeNull()
})

test("adding a comment calls onAdd with trimmed text", async () => {
  const onAdd = vi.fn()
  render(<CommentThread comments={[]} onAdd={onAdd} />)
  await userEvent.type(screen.getByPlaceholderText("Add a comment"), "  hello  ")
  await userEvent.click(screen.getByRole("button", { name: /^comment$/i }))
  expect(onAdd).toHaveBeenCalledWith("hello")
})
