import { test, expect, vi } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
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

test("readOnly hides the input and lists all comments flat", () => {
  const mixed: Comment[] = [
    { id: "a", revision: 1, kind: "general", body: "one", resolved: false, createdAt: 0 },
    { id: "b", revision: 1, kind: "general", body: "two", resolved: true, createdAt: 0 },
  ]
  render(<CommentThread comments={mixed} onAdd={() => {}} readOnly />)
  expect(screen.getByText("one")).toBeInTheDocument()
  expect(screen.getByText("two")).toBeInTheDocument()
  expect(screen.queryByPlaceholderText("Add a comment")).toBeNull()
  expect(screen.queryByRole("button", { name: /resolved \(/i })).toBeNull()
})

test("clicking an anchored comment fires onCommentClick; general comments are not clickable", async () => {
  const onCommentClick = vi.fn()
  const items: Comment[] = [
    { id: "x", revision: 1, kind: "anchor", anchor: { quote: "q", prefix: "", suffix: "" }, body: "anchored body", resolved: false, createdAt: 0 },
    { id: "y", revision: 1, kind: "general", body: "general body", resolved: false, createdAt: 0 },
  ]
  render(<CommentThread comments={items} onAdd={() => {}} onCommentClick={onCommentClick} />)
  await userEvent.click(screen.getByText("anchored body"))
  expect(onCommentClick).toHaveBeenCalledWith("x")
  onCommentClick.mockClear()
  await userEvent.click(screen.getByText("general body"))
  expect(onCommentClick).not.toHaveBeenCalled()
})

test("editing an active comment shows a textarea and calls onEdit with trimmed text", async () => {
  const onEdit = vi.fn()
  render(
    <CommentThread
      comments={[{ id: "a", revision: 1, kind: "general", body: "original", resolved: false, createdAt: 0 }]}
      onAdd={() => {}}
      onEdit={onEdit}
    />,
  )
  await userEvent.click(screen.getByRole("button", { name: /^edit$/i }))
  const textarea = screen.getByDisplayValue("original")
  await userEvent.clear(textarea)
  await userEvent.type(textarea, "  reworded  ")
  await userEvent.click(screen.getByRole("button", { name: /^save$/i }))
  expect(onEdit).toHaveBeenCalledWith("a", "reworded")
})

test("deleting an active comment calls onDelete", async () => {
  const onDelete = vi.fn()
  render(
    <CommentThread
      comments={[{ id: "a", revision: 1, kind: "general", body: "drop me", resolved: false, createdAt: 0 }]}
      onAdd={() => {}}
      onDelete={onDelete}
    />,
  )
  await userEvent.click(screen.getByRole("button", { name: /^delete$/i }))
  expect(onDelete).toHaveBeenCalledWith("a")
})

test("resolved comments expose no Edit/Delete controls", async () => {
  render(
    <CommentThread
      comments={[{ id: "b", revision: 1, kind: "general", body: "resolved note", resolved: true, createdAt: 0 }]}
      onAdd={() => {}}
      onEdit={() => {}}
      onDelete={() => {}}
    />,
  )
  await userEvent.click(screen.getByRole("button", { name: /resolved \(1\)/i }))
  expect(screen.getByText("resolved note")).toBeInTheDocument()
  expect(screen.queryByRole("button", { name: /^edit$/i })).toBeNull()
  expect(screen.queryByRole("button", { name: /^delete$/i })).toBeNull()
})

test("read-only comments expose no Edit/Delete controls", () => {
  render(
    <CommentThread
      comments={[{ id: "a", revision: 1, kind: "general", body: "one", resolved: false, createdAt: 0 }]}
      onAdd={() => {}}
      onEdit={() => {}}
      onDelete={() => {}}
      readOnly
    />,
  )
  expect(screen.queryByRole("button", { name: /^edit$/i })).toBeNull()
  expect(screen.queryByRole("button", { name: /^delete$/i })).toBeNull()
})

test("flashCommentId flashes the matching comment item", async () => {
  const items: Comment[] = [
    { id: "x", revision: 1, kind: "general", body: "the body", resolved: false, createdAt: 0 },
  ]
  const { rerender } = render(<CommentThread comments={items} onAdd={() => {}} />)
  rerender(<CommentThread comments={items} onAdd={() => {}} flashCommentId="x" flashKey={1} />)
  await waitFor(() => {
    expect(document.querySelector('[data-comment-id="x"]')?.classList.contains("flash")).toBe(true)
  })
})
