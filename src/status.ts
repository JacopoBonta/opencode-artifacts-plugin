import { isMutatingBash } from "./bash-gate"

/** Shown when the agent is doing something we don't have a tailored phrase for. */
export const GENERIC_WORKING = "Working…"

/** Shown while the agent is reasoning/composing, between (or before) tool calls. */
export const THINKING = "Thinking…"

/**
 * Derive a short, human "what the agent is doing now" phrase from a tool call,
 * for the companion's live status strip. This is intentionally a COSMETIC
 * heuristic (not a security boundary like the gate): it never sees tool output,
 * only the about-to-run tool name and its args, and falls back to a generic
 * phrase for anything it doesn't recognize.
 */
export function deriveStatusPhrase(tool: string, args: unknown): string {
  switch (tool) {
    case "write":
    case "edit":
    case "patch": {
      const name = basename(filePathOf(args))
      return name ? `Editing ${name}` : "Editing a file"
    }
    case "read": {
      const name = basename(filePathOf(args))
      return name ? `Reading ${name}` : "Reading a file"
    }
    case "grep":
    case "glob":
    case "list":
      return "Exploring the codebase"
    case "webfetch":
      return "Fetching a web page"
    case "todowrite":
    case "todoread":
      return "Updating the task list"
    case "publish_artifact":
      return "Submitting the plan for review"
    case "bash":
      return bashPhrase(commandOf(args))
    default:
      return GENERIC_WORKING
  }
}

/** Classify a bash command into a phrase. Read-only commands read as exploration. */
function bashPhrase(command: string | undefined): string {
  if (!command) return "Running a command"
  if (isTestCommand(command)) return "Running tests"
  if (isGitCommit(command)) return "Committing changes"
  // `isMutatingBash` is the same heuristic the gate uses; a non-mutating command
  // (grep, ls, cat, git status, …) is the agent exploring, not changing anything.
  return isMutatingBash(command) ? "Running a command" : "Exploring the codebase"
}

const TEST_RUNNERS =
  /\b(bun test|vitest|jest|mocha|pytest|go test|cargo test|npm (run )?test|pnpm (run )?test|yarn test)\b/
function isTestCommand(command: string): boolean {
  return TEST_RUNNERS.test(command)
}

function isGitCommit(command: string): boolean {
  return /\bgit\s+(commit|push)\b/.test(command)
}

/** OpenCode's file tools name the path `filePath`; tolerate `path`/`file` too. */
function filePathOf(args: unknown): string | undefined {
  const a = args as Record<string, unknown> | null | undefined
  const p = a?.filePath ?? a?.path ?? a?.file
  return typeof p === "string" ? p : undefined
}

function commandOf(args: unknown): string | undefined {
  const c = (args as { command?: unknown } | null | undefined)?.command
  return typeof c === "string" ? c : undefined
}

/** Last path segment, ignoring a trailing slash. Returns "" when not derivable. */
function basename(path: string | undefined): string {
  if (!path) return ""
  const trimmed = path.replace(/\/+$/, "")
  const idx = trimmed.lastIndexOf("/")
  return idx === -1 ? trimmed : trimmed.slice(idx + 1)
}
