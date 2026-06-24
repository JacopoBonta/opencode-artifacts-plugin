import { test, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { ArtifactView } from "./ArtifactView"

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
