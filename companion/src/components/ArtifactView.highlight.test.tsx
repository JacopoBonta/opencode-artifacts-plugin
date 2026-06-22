import { test, expect, vi } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { ArtifactView } from "./ArtifactView"
import type { Comment } from "../api"

const anchored: Comment[] = [
  { id: "c1", revision: 1, kind: "anchor", anchor: { quote: "step one", prefix: "", suffix: "" }, body: "please expand", resolved: false, createdAt: 0 },
]

test("wraps each anchored comment's quote in a mark.anchor-highlight", async () => {
  render(<ArtifactView content={"# Plan\n\nstep one here"} comments={anchored} onAnchor={() => {}} />)
  await waitFor(() => {
    const marks = document.querySelectorAll("mark.anchor-highlight")
    expect(marks.length).toBe(1)
    expect(marks[0].textContent).toBe("step one")
    expect(marks[0].getAttribute("title")).toBe("please expand")
  })
})

test("highlights two distinct anchored comments independently", async () => {
  const two: Comment[] = [
    { id: "a", revision: 1, kind: "anchor", anchor: { quote: "step one", prefix: "", suffix: "" }, body: "expand one", resolved: false, createdAt: 0 },
    { id: "b", revision: 1, kind: "anchor", anchor: { quote: "step two", prefix: "", suffix: "" }, body: "expand two", resolved: false, createdAt: 0 },
  ]
  render(<ArtifactView content={"# Plan\n\nstep one here, then step two done"} comments={two} onAnchor={() => {}} />)
  await waitFor(() => {
    const marks = [...document.querySelectorAll("mark.anchor-highlight")]
    expect(marks.map((m) => m.textContent).sort()).toEqual(["step one", "step two"])
    expect(marks.map((m) => m.getAttribute("title")).sort()).toEqual(["expand one", "expand two"])
  })
})

test("orphaned anchors (quote not present) are skipped", async () => {
  const orphan: Comment[] = [
    { id: "c2", revision: 1, kind: "anchor", anchor: { quote: "not in doc", prefix: "", suffix: "" }, body: "x", resolved: false, createdAt: 0 },
  ]
  render(<ArtifactView content={"# Plan\n\nstep one here"} comments={orphan} onAnchor={() => {}} />)
  // give the effect a tick
  await new Promise((r) => setTimeout(r, 20))
  expect(document.querySelectorAll("mark.anchor-highlight").length).toBe(0)
})

test("general (non-anchor) comments are not highlighted", async () => {
  const general: Comment[] = [
    { id: "c3", revision: 1, kind: "general", body: "overall note", resolved: false, createdAt: 0 },
  ]
  render(<ArtifactView content={"# Plan\n\nstep one here"} comments={general} onAnchor={() => {}} />)
  await new Promise((r) => setTimeout(r, 20))
  expect(document.querySelectorAll("mark.anchor-highlight").length).toBe(0)
})

test("resolved anchored comments are NOT highlighted", async () => {
  const resolved: Comment[] = [
    { id: "r1", revision: 1, kind: "anchor", anchor: { quote: "step one", prefix: "", suffix: "" }, body: "addressed", resolved: true, createdAt: 0 },
  ]
  render(<ArtifactView content={"# Plan\n\nstep one here"} comments={resolved} onAnchor={() => {}} />)
  await new Promise((r) => setTimeout(r, 20))
  expect(document.querySelectorAll("mark.anchor-highlight").length).toBe(0)
})
