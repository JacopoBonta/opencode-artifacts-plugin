import { test, expect } from "bun:test"
import {
  validateCommentInput,
  validateCommentEdit,
  validateVerdictInput,
  validateArchiveInput,
  validateGateInput,
  MAX_TEXT,
} from "./validate"

test("validateCommentInput accepts a well-formed general comment", () => {
  const r = validateCommentInput({ revision: 1, kind: "general", body: "hi" })
  expect(r.ok).toBe(true)
  if (r.ok) expect(r.value).toEqual({ revision: 1, kind: "general", body: "hi" })
})

test("validateCommentInput accepts an anchor comment with an anchor", () => {
  const anchor = { quote: "q", prefix: "p", suffix: "s" }
  const r = validateCommentInput({ revision: 2, kind: "anchor", body: "b", anchor })
  expect(r.ok).toBe(true)
  if (r.ok) expect(r.value.anchor).toEqual(anchor)
})

test("validateCommentInput rejects bad shapes", () => {
  expect(validateCommentInput(null).ok).toBe(false)
  expect(validateCommentInput("x").ok).toBe(false)
  expect(validateCommentInput([]).ok).toBe(false)
  expect(validateCommentInput({ revision: "1", kind: "general", body: "b" }).ok).toBe(false)
  expect(validateCommentInput({ revision: Infinity, kind: "general", body: "b" }).ok).toBe(false)
  expect(validateCommentInput({ revision: 1, kind: "bogus", body: "b" }).ok).toBe(false)
  expect(validateCommentInput({ revision: 1, kind: "general", body: "" }).ok).toBe(false)
  expect(validateCommentInput({ revision: 1, kind: "general", body: 42 }).ok).toBe(false)
  expect(validateCommentInput({ revision: 1, kind: "general", body: "x".repeat(MAX_TEXT + 1) }).ok).toBe(false)
})

test("validateCommentInput requires an anchor for anchor-kind comments", () => {
  expect(validateCommentInput({ revision: 1, kind: "anchor", body: "b" }).ok).toBe(false)
})

test("validateCommentInput rejects a malformed anchor", () => {
  expect(
    validateCommentInput({ revision: 1, kind: "anchor", body: "b", anchor: { quote: "q" } }).ok,
  ).toBe(false)
  expect(
    validateCommentInput({ revision: 1, kind: "anchor", body: "b", anchor: { quote: 1, prefix: "p", suffix: "s" } }).ok,
  ).toBe(false)
})

test("validateCommentEdit requires a non-empty bounded body", () => {
  expect(validateCommentEdit({ body: "ok" }).ok).toBe(true)
  expect(validateCommentEdit({ body: "" }).ok).toBe(false)
  expect(validateCommentEdit({ body: 1 }).ok).toBe(false)
  expect(validateCommentEdit({}).ok).toBe(false)
  expect(validateCommentEdit({ body: "x".repeat(MAX_TEXT + 1) }).ok).toBe(false)
})

test("validateVerdictInput accepts the three statuses and optional reason", () => {
  expect(validateVerdictInput({ status: "approved" }).ok).toBe(true)
  expect(validateVerdictInput({ status: "changes_requested" }).ok).toBe(true)
  const declined = validateVerdictInput({ status: "declined", reason: "nope" })
  expect(declined.ok).toBe(true)
  if (declined.ok) expect(declined.value.reason).toBe("nope")
})

test("validateVerdictInput rejects bad statuses and reasons", () => {
  expect(validateVerdictInput({ status: "yolo" }).ok).toBe(false)
  expect(validateVerdictInput({}).ok).toBe(false)
  expect(validateVerdictInput({ status: "declined", reason: 5 }).ok).toBe(false)
  expect(validateVerdictInput({ status: "approved", reason: "x".repeat(MAX_TEXT + 1) }).ok).toBe(false)
})

test("validateArchiveInput requires a strict boolean", () => {
  expect(validateArchiveInput({ archived: true }).ok).toBe(true)
  expect(validateArchiveInput({ archived: false }).ok).toBe(true)
  expect(validateArchiveInput({ archived: "true" }).ok).toBe(false)
  expect(validateArchiveInput({ archived: 1 }).ok).toBe(false)
  expect(validateArchiveInput({}).ok).toBe(false)
})

test("validateGateInput requires a strict boolean", () => {
  expect(validateGateInput({ forced: true }).ok).toBe(true)
  expect(validateGateInput({ forced: false }).ok).toBe(true)
  expect(validateGateInput({ forced: "true" }).ok).toBe(false)
  expect(validateGateInput({ forced: 1 }).ok).toBe(false)
  expect(validateGateInput({}).ok).toBe(false)
  expect(validateGateInput(null).ok).toBe(false)
  expect(validateGateInput([]).ok).toBe(false)
})
