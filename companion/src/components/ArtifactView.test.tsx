import { test, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { ArtifactView } from "./ArtifactView"

test("renders markdown content as HTML", () => {
  render(<ArtifactView content={"# Title\n\nbody text"} comments={[]} onAnchor={() => {}} />)
  expect(screen.getByRole("heading", { name: "Title" })).toBeInTheDocument()
  expect(screen.getByText("body text")).toBeInTheDocument()
})
