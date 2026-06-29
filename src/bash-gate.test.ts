import { test, expect } from "bun:test"
import { isMutatingBash } from "./bash-gate"

test("gates plain mutating commands at command position", () => {
  for (const c of [
    "rm -rf build",
    "mv a b",
    "cp a b",
    "mkdir dist",
    "touch f",
    "chmod +x f",
    "ln -s a b",
    "dd if=/dev/zero of=f",
  ]) {
    expect(isMutatingBash(c)).toBe(true)
  }
})

test("gates write redirects, including glued and fat-arrow-style", () => {
  expect(isMutatingBash("echo x > f")).toBe(true)
  expect(isMutatingBash("echo x >> f")).toBe(true)
  expect(isMutatingBash("echo x>f")).toBe(true)
  expect(isMutatingBash("echo a=>b")).toBe(true) // unquoted => is a real redirect to file b
  expect(isMutatingBash("cat <<EOF > f")).toBe(true)
})

test("gates sed -i, package installs, and mutating git subcommands", () => {
  expect(isMutatingBash("sed -i 's/a/b/' f")).toBe(true)
  expect(isMutatingBash("sed -i.bak 's/a/b/' f")).toBe(true)
  expect(isMutatingBash("sed -ne '1p' -i f")).toBe(true)
  expect(isMutatingBash("npm install lodash")).toBe(true)
  expect(isMutatingBash("npm i")).toBe(true)
  expect(isMutatingBash("bun add zod")).toBe(true)
  expect(isMutatingBash("pip3 install requests")).toBe(true)
  expect(isMutatingBash("git checkout .")).toBe(true)
  expect(isMutatingBash("git reset --hard")).toBe(true)
})

test("still gates checkout/switch that touch the working tree (no branch-creation flag)", () => {
  expect(isMutatingBash("git checkout main")).toBe(true)
  expect(isMutatingBash("git checkout -- file.txt")).toBe(true)
  expect(isMutatingBash("git switch develop")).toBe(true)
})

test("does NOT gate branch creation via checkout/switch (the key false-positive fix)", () => {
  // `checkout -b` / `switch -c` create a branch at HEAD without writing files.
  expect(isMutatingBash("git checkout -b feature/foo")).toBe(false)
  expect(isMutatingBash("git checkout -B main")).toBe(false)
  expect(isMutatingBash("git switch -c feature/foo")).toBe(false)
  expect(isMutatingBash("git switch --create feature/foo")).toBe(false)
  // the real-world compound the gate was wrongly blocking
  expect(
    isMutatingBash(
      "git checkout -b chore/x && git add y && git commit -m z && git push origin chore/x",
    ),
  ).toBe(false)
})

test("gates a mutating command behind a separator, pipe, or wrapper", () => {
  expect(isMutatingBash("grep foo . && rm bad")).toBe(true)
  expect(isMutatingBash("cat x | tee out")).toBe(true)
  expect(isMutatingBash("sudo rm -rf /tmp/x")).toBe(true)
  expect(isMutatingBash("FOO=bar npm install")).toBe(true)
  expect(isMutatingBash("echo $(rm x)")).toBe(true)
})

test("does NOT gate a literal > inside a quoted string (the key false-positive fix)", () => {
  expect(isMutatingBash('echo "a => b"')).toBe(false)
  expect(isMutatingBash("echo 'pipe a > b please'")).toBe(false)
  expect(isMutatingBash('printf "%s -> %s\\n" a b')).toBe(false)
})

test("does NOT gate bash comparisons / arithmetic", () => {
  expect(isMutatingBash("[[ $a > $b ]]")).toBe(false)
  expect(isMutatingBash("[[ $x -gt 3 && $y > $z ]]")).toBe(false)
  expect(isMutatingBash("(( a > b ))")).toBe(false)
})

test("does NOT gate a mutating word that is merely an argument", () => {
  expect(isMutatingBash("echo rm")).toBe(false)
  expect(isMutatingBash("grep -r rm src")).toBe(false)
  expect(isMutatingBash("git log --oneline")).toBe(false)
})

test("does NOT gate read-only exploration, git bookkeeping, or fd redirects/dups", () => {
  for (const c of [
    "ls -la",
    "grep -r foo src",
    "git status",
    "git add file.ts",
    'git commit -m "create -> done"',
    "git push origin main",
    "bun test",
    "npm test",
    "npm run build",
    "cat f 2>/dev/null",
    "make 2>&1 | head",
    "echo done >&2",
  ]) {
    expect(isMutatingBash(c)).toBe(false)
  }
})

test("empty / whitespace commands are not mutating", () => {
  expect(isMutatingBash("")).toBe(false)
  expect(isMutatingBash("   ")).toBe(false)
})
