/**
 * Decide whether a `bash` command looks like it mutates the workspace (and so
 * must be gated behind an approved plan). `bash` is general-purpose, so we can't
 * gate it wholesale without blocking the read-only exploration (grep, ls, git
 * status, running tests) the agent needs while planning — we only gate commands
 * that look like writes.
 *
 * This replaces an earlier single-regex heuristic, which mis-fired on a literal
 * `>` inside a quoted string (`echo "a => b"`), bash comparisons
 * (`[[ $a > $b ]]`), and a command name appearing as an argument (`echo rm`).
 * A small quote/operator-aware tokenizer fixes those: text inside quotes is
 * never an operator, command names only count at a command position, and `>`
 * inside `[[ ]]` / `(( ))` is treated as a comparison, not a redirect.
 *
 * It remains a COOPERATIVE heuristic, not a security boundary: an agent that
 * truly wants to write a file can still do so via an interpreter
 * (`node -e`, `python -c`), which we deliberately don't try to gate.
 */

const MUTATING_CMDS = new Set([
  "rm", "mv", "cp", "mkdir", "rmdir", "touch", "truncate", "dd", "tee", "chmod", "chown", "ln",
])
/** Wrappers that pass the command position through to the next word. */
const CMD_WRAPPERS = new Set(["sudo", "doas", "command", "nice", "nohup", "env", "time", "xargs"])
const PKG_MGRS = new Set(["npm", "pnpm", "yarn", "bun", "pip", "pip3", "cargo", "go", "brew"])
const PKG_SUBCMDS = new Set(["i", "install", "add", "remove", "rm", "uninstall"])
/** git subcommands that can change working-tree files (bookkeeping like add/commit/push is not gated). */
const GIT_MUTATING = new Set([
  "checkout", "switch", "apply", "reset", "restore", "merge", "rebase", "stash", "clean", "rm", "mv",
])

type Token =
  | { t: "word"; v: string; cmd: boolean }
  | { t: "sep" }
  | { t: "redir" } // a write redirect (`>`/`>>`) outside a comparison/arith context

const isAssignment = (v: string) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(v)
const isInPlaceFlag = (v: string) =>
  v === "-i" || /^-[A-Za-z]*i/.test(v) || v.startsWith("--in-place")

/** Tokenize a shell command, honoring quotes/escapes and tracking command position. */
function tokenize(cmd: string): Token[] {
  const tokens: Token[] = []
  let cur = ""
  let hasContent = false
  let isCmd = false
  let cmdPos = true // the next word starts a command
  let compareDepth = 0 // inside `[[ ]]` or `(( ))`, where `>`/`<` are comparisons
  let i = 0
  const n = cmd.length

  const startContent = () => {
    if (!hasContent) isCmd = cmdPos
    hasContent = true
  }
  const flushWord = () => {
    if (!hasContent) return
    const v = cur
    cur = ""
    hasContent = false
    if (v === "[[") {
      compareDepth++
      cmdPos = false
      tokens.push({ t: "word", v, cmd: isCmd })
      return
    }
    if (v === "]]") {
      compareDepth = Math.max(0, compareDepth - 1)
      tokens.push({ t: "word", v, cmd: isCmd })
      return
    }
    tokens.push({ t: "word", v, cmd: isCmd })
    if (isCmd) cmdPos = isAssignment(v) || CMD_WRAPPERS.has(v)
  }
  const sep = () => {
    flushWord()
    tokens.push({ t: "sep" })
    cmdPos = true
  }

  while (i < n) {
    const c = cmd[i]
    if (c === " " || c === "\t") {
      flushWord()
      i++
      continue
    }
    if (c === "\n") {
      sep()
      i++
      continue
    }
    if (c === "'") {
      startContent()
      i++
      while (i < n && cmd[i] !== "'") cur += cmd[i++]
      i++ // closing quote (or end of string)
      continue
    }
    if (c === '"') {
      startContent()
      i++
      while (i < n && cmd[i] !== '"') {
        if (cmd[i] === "\\" && i + 1 < n) {
          cur += cmd[i + 1]
          i += 2
          continue
        }
        cur += cmd[i++]
      }
      i++
      continue
    }
    if (c === "\\") {
      if (i + 1 < n) {
        startContent()
        cur += cmd[i + 1]
        i += 2
      } else i++
      continue
    }
    if (c === ";") {
      sep()
      i++
      if (cmd[i] === ";") i++ // `;;`
      continue
    }
    if (c === "|") {
      sep()
      i++
      if (cmd[i] === "|") i++ // `||`
      continue
    }
    if (c === "&") {
      // `&>` / `&>>` redirect-all-to-file: a dup-style redirect, not gated.
      if (cmd[i + 1] === ">") {
        flushWord()
        i += 2
        if (cmd[i] === ">") i++
        cmdPos = false
        continue
      }
      sep()
      i++
      if (cmd[i] === "&") i++ // `&&`
      continue
    }
    if (c === "(") {
      flushWord()
      if (cmd[i + 1] === "(") {
        compareDepth++
        i += 2
      } else {
        tokens.push({ t: "sep" })
        cmdPos = true
        i++
      }
      continue
    }
    if (c === ")") {
      flushWord()
      if (cmd[i + 1] === ")") {
        compareDepth = Math.max(0, compareDepth - 1)
        i += 2
      } else {
        tokens.push({ t: "sep" })
        cmdPos = true
        i++
      }
      continue
    }
    if (c === ">") {
      // A leading all-digit word is a file descriptor (`2>`), not a real arg.
      const fd = hasContent && /^\d+$/.test(cur)
      if (fd) {
        cur = ""
        hasContent = false
      }
      flushWord()
      i++
      if (cmd[i] === ">") i++ // `>>`
      // `>&` is a dup (e.g. `>&2`), not a file write.
      if (cmd[i] === "&") {
        i++
        cmdPos = false
        continue
      }
      if (!fd && compareDepth === 0) tokens.push({ t: "redir" })
      cmdPos = false // the next word is the redirect target, not a command
      continue
    }
    if (c === "<") {
      // Input redirects never write the workspace.
      if (hasContent && /^\d+$/.test(cur)) {
        cur = ""
        hasContent = false
      }
      flushWord()
      i++
      while (cmd[i] === "<") i++ // `<<`, `<<<`
      cmdPos = false
      continue
    }
    startContent()
    cur += c
    i++
  }
  flushWord()
  return tokens
}

/** Find the first word token after index `k`, stopping at a separator. */
function nextWord(tokens: Token[], k: number): string | undefined {
  for (let j = k + 1; j < tokens.length; j++) {
    const t = tokens[j]
    if (t.t === "sep") return undefined
    if (t.t === "word") return t.v
  }
  return undefined
}

/** Does this bash command look like it mutates the workspace? */
export function isMutatingBash(command: string): boolean {
  const tokens = tokenize(command)
  for (let k = 0; k < tokens.length; k++) {
    const tk = tokens[k]
    if (tk.t === "redir") return true
    if (tk.t !== "word" || !tk.cmd) continue
    const v = tk.v
    if (MUTATING_CMDS.has(v)) return true
    if (v === "sed") {
      for (let j = k + 1; j < tokens.length; j++) {
        const t = tokens[j]
        if (t.t === "sep") break
        if (t.t === "word" && isInPlaceFlag(t.v)) return true
      }
    }
    if (PKG_MGRS.has(v)) {
      const sub = nextWord(tokens, k)
      if (sub && PKG_SUBCMDS.has(sub)) return true
    }
    if (v === "git") {
      const sub = nextWord(tokens, k)
      if (sub && GIT_MUTATING.has(sub)) return true
    }
  }
  return false
}
