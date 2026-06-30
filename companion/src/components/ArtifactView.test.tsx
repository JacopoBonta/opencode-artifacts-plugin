import { test, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { ArtifactView } from "./ArtifactView"

/** Build a real text selection over the first `len` chars of the view's text. */
function selectText(view: HTMLElement, len: number) {
  const textNode = view.querySelector("p")!.firstChild as Text
  const range = document.createRange()
  range.setStart(textNode, 0)
  range.setEnd(textNode, len)
  const sel = window.getSelection()!
  sel.removeAllRanges()
  sel.addRange(range)
  fireEvent.mouseUp(view)
}

test("renders markdown content as HTML", () => {
  render(<ArtifactView content={"# Title\n\nbody text"} comments={[]} onAnchor={() => {}} />)
  expect(screen.getByRole("heading", { name: "Title" })).toBeInTheDocument()
  expect(screen.getByText("body text")).toBeInTheDocument()
})

test("renders GFM tables (remark-gfm enabled)", () => {
  const md = "| A | B |\n| - | - |\n| 1 | 2 |"
  const { container } = render(<ArtifactView content={md} comments={[]} onAnchor={() => {}} />)
  expect(container.querySelector("table")).not.toBeNull()
  expect(screen.getByRole("columnheader", { name: "A" })).toBeInTheDocument()
  expect(screen.getByRole("cell", { name: "1" })).toBeInTheDocument()
})

test("renders GFM task list checkboxes", () => {
  const { container } = render(
    <ArtifactView content={"- [x] done\n- [ ] todo"} comments={[]} onAnchor={() => {}} />,
  )
  const boxes = container.querySelectorAll('input[type="checkbox"]')
  expect(boxes).toHaveLength(2)
  expect((boxes[0] as HTMLInputElement).checked).toBe(true)
  expect((boxes[1] as HTMLInputElement).checked).toBe(false)
})

test("selecting text shows a Comment button that anchors the selection", () => {
  const onAnchor = vi.fn()
  const { container } = render(
    <ArtifactView content={"hello world"} comments={[]} onAnchor={onAnchor} canComment />,
  )
  selectText(container.querySelector(".artifact-view") as HTMLElement, 5)
  fireEvent.click(screen.getByRole("button", { name: /comment/i }))
  expect(onAnchor).toHaveBeenCalled()
  expect(onAnchor.mock.calls[0][0].quote).toBe("hello")
})

test("no Comment button appears when canComment is false", () => {
  const { container } = render(
    <ArtifactView content={"hello world"} comments={[]} onAnchor={() => {}} />,
  )
  selectText(container.querySelector(".artifact-view") as HTMLElement, 5)
  expect(screen.queryByRole("button", { name: /comment/i })).toBeNull()
})
