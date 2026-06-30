import { test, expect, describe } from "bun:test"
import { deriveStatusPhrase } from "./status"

describe("deriveStatusPhrase", () => {
  test("file edits report the basename", () => {
    expect(deriveStatusPhrase("edit", { filePath: "src/server.ts" })).toBe("Editing server.ts")
    expect(deriveStatusPhrase("write", { filePath: "/abs/path/to/App.tsx" })).toBe("Editing App.tsx")
    expect(deriveStatusPhrase("patch", { path: "a/b/c.md" })).toBe("Editing c.md")
  })

  test("edit without a usable path falls back gracefully", () => {
    expect(deriveStatusPhrase("edit", {})).toBe("Editing a file")
    expect(deriveStatusPhrase("edit", null)).toBe("Editing a file")
  })

  test("read reports the basename", () => {
    expect(deriveStatusPhrase("read", { filePath: "docs/ARCHITECTURE.md" })).toBe(
      "Reading ARCHITECTURE.md",
    )
    expect(deriveStatusPhrase("read", {})).toBe("Reading a file")
  })

  test("search/listing tools read as exploration", () => {
    expect(deriveStatusPhrase("grep", { pattern: "foo" })).toBe("Exploring the codebase")
    expect(deriveStatusPhrase("glob", { pattern: "**/*.ts" })).toBe("Exploring the codebase")
    expect(deriveStatusPhrase("list", { path: "." })).toBe("Exploring the codebase")
  })

  test("bash: test runners report running tests", () => {
    expect(deriveStatusPhrase("bash", { command: "bun test src/foo.test.ts" })).toBe("Running tests")
    expect(deriveStatusPhrase("bash", { command: "npx vitest run" })).toBe("Running tests")
    expect(deriveStatusPhrase("bash", { command: "pytest -q" })).toBe("Running tests")
    expect(deriveStatusPhrase("bash", { command: "go test ./..." })).toBe("Running tests")
  })

  test("bash: git commit/push reports committing", () => {
    expect(deriveStatusPhrase("bash", { command: "git commit -m 'x'" })).toBe("Committing changes")
    expect(deriveStatusPhrase("bash", { command: "git push origin main" })).toBe("Committing changes")
  })

  test("bash: read-only commands read as exploration, mutating as a command", () => {
    expect(deriveStatusPhrase("bash", { command: "ls -la" })).toBe("Exploring the codebase")
    expect(deriveStatusPhrase("bash", { command: "git status" })).toBe("Exploring the codebase")
    expect(deriveStatusPhrase("bash", { command: "rm -rf build" })).toBe("Running a command")
    expect(deriveStatusPhrase("bash", { command: "mkdir dist" })).toBe("Running a command")
  })

  test("bash without a command falls back", () => {
    expect(deriveStatusPhrase("bash", {})).toBe("Running a command")
  })

  test("known non-file tools have tailored phrases", () => {
    expect(deriveStatusPhrase("publish_artifact", { title: "Plan" })).toBe(
      "Submitting the plan for review",
    )
    expect(deriveStatusPhrase("todowrite", {})).toBe("Updating the task list")
    expect(deriveStatusPhrase("webfetch", { url: "https://x" })).toBe("Fetching a web page")
  })

  test("unknown tools fall back to a generic phrase (no raw tool name)", () => {
    expect(deriveStatusPhrase("some_custom_tool", {})).toBe("Working…")
  })
})
