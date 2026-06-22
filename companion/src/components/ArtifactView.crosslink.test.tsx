import { test, expect, vi } from "vitest"
import { render, waitFor, fireEvent } from "@testing-library/react"
import { ArtifactView } from "./ArtifactView"
import type { Comment } from "../api"

const anchored: Comment[] = [
  { id: "c1", revision: 1, kind: "anchor", anchor: { quote: "step one", prefix: "", suffix: "" }, body: "note", resolved: false, createdAt: 0 },
]

test("clicking a highlight fires onHighlightClick with the comment id", async () => {
  const onHighlightClick = vi.fn()
  render(<ArtifactView content={"# Plan\n\nstep one here"} comments={anchored} onAnchor={() => {}} onHighlightClick={onHighlightClick} />)
  let mark: Element | null = null
  await waitFor(() => {
    mark = document.querySelector("mark.anchor-highlight")
    expect(mark).not.toBeNull()
  })
  fireEvent.click(mark!)
  expect(onHighlightClick).toHaveBeenCalledWith("c1")
})

test("flashAnchorId + flashKey adds .flash to the matching mark", async () => {
  const { rerender } = render(
    <ArtifactView content={"# Plan\n\nstep one here"} comments={anchored} onAnchor={() => {}} />,
  )
  await waitFor(() => expect(document.querySelector("mark.anchor-highlight")).not.toBeNull())
  rerender(
    <ArtifactView content={"# Plan\n\nstep one here"} comments={anchored} onAnchor={() => {}} flashAnchorId="c1" flashKey={1} />,
  )
  await waitFor(() => {
    expect(document.querySelector("mark.anchor-highlight")?.classList.contains("flash")).toBe(true)
  })
})
