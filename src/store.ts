import { mkdir, readFile, writeFile, readdir } from "node:fs/promises"
import { existsSync } from "node:fs"
import { join } from "node:path"
import type { Artifact, ArtifactType, Comment, Verdict } from "./types"

export interface StoreOptions {
  root: string
  clock?: () => number
  idgen?: () => string
}

export interface PublishInput {
  type: ArtifactType
  title: string
  content: string
  artifactId?: string
  sessionID?: string
}

interface Pending {
  resolve: (v: Verdict) => void
  reject: (e: Error) => void
}

export function createStore(opts: StoreOptions) {
  const root = opts.root
  const clock = opts.clock ?? (() => Date.now())
  let counter = 0
  const idgen = opts.idgen ?? (() => `${clock()}-${++counter}`)

  const artifacts = new Map<string, Artifact>()
  const comments = new Map<string, Comment[]>()
  const pending = new Map<string, Pending>()

  const artDir = (id: string) => join(root, id)
  const metaPath = (id: string) => join(artDir(id), "meta.json")
  const commentsPath = (id: string) => join(artDir(id), "comments.json")
  const revPath = (id: string, rev: number) =>
    join(artDir(id), "revisions", String(rev).padStart(3, "0") + ".md")

  async function persistMeta(a: Artifact) {
    await writeFile(metaPath(a.id), JSON.stringify(a, null, 2))
  }
  async function persistComments(id: string) {
    await writeFile(commentsPath(id), JSON.stringify(comments.get(id) ?? [], null, 2))
  }

  async function publish(input: PublishInput): Promise<{ artifact: Artifact }> {
    const now = clock()
    const status = input.type === "plan" ? "awaiting_review" : "published"

    // Build the next artifact state without mutating the live reference, so a
    // failed write leaves in-memory state untouched (commit only after I/O).
    let next: Artifact
    const isNew = !input.artifactId
    if (input.artifactId) {
      const existing = artifacts.get(input.artifactId)
      if (!existing) {
        throw new Error(`unknown artifactId: ${input.artifactId}`)
      }
      next = {
        ...existing,
        currentRevision: existing.currentRevision + 1,
        title: input.title,
        status,
        updatedAt: now,
      }
    } else {
      next = {
        id: idgen(),
        type: input.type,
        title: input.title,
        status,
        currentRevision: 1,
        createdAt: now,
        updatedAt: now,
        sessionID: input.sessionID,
      }
    }

    await mkdir(join(artDir(next.id), "revisions"), { recursive: true })
    await writeFile(revPath(next.id, next.currentRevision), input.content)
    await writeFile(metaPath(next.id), JSON.stringify(next, null, 2))
    if (isNew && !existsSync(commentsPath(next.id))) {
      await writeFile(commentsPath(next.id), JSON.stringify([], null, 2))
    }

    // Commit to in-memory state only after all writes succeeded.
    artifacts.set(next.id, next)
    if (isNew) comments.set(next.id, [])
    return { artifact: { ...next } }
  }

  async function readRevision(id: string, rev: number): Promise<string> {
    return readFile(revPath(id, rev), "utf8")
  }

  async function addComment(
    id: string,
    input: Omit<Comment, "id" | "resolved" | "createdAt">,
  ): Promise<Comment> {
    const c: Comment = { ...input, id: idgen(), resolved: false, createdAt: clock() }
    const list = comments.get(id) ?? []
    list.push(c)
    comments.set(id, list)
    await persistComments(id)
    return c
  }

  async function getComments(id: string): Promise<Comment[]> {
    // Deep-ish copy so callers can't mutate stored Comment objects in place.
    return (comments.get(id) ?? []).map((c) => ({ ...c }))
  }

  function awaitVerdict(id: string): Promise<Verdict> {
    return new Promise<Verdict>((resolve, reject) => {
      pending.set(id, { resolve, reject })
    })
  }

  async function resolveVerdict(id: string, verdict: Verdict): Promise<void> {
    const a = artifacts.get(id)
    if (a) {
      a.status = verdict.status === "approved" ? "approved" : "changes_requested"
      a.updatedAt = clock()
      await persistMeta(a)
    }
    const p = pending.get(id)
    if (p) {
      pending.delete(id)
      p.resolve(verdict)
    }
  }

  function disposeAll() {
    for (const [, p] of pending) p.reject(new Error("store disposed: review abandoned"))
    pending.clear()
  }

  async function get(id: string): Promise<Artifact | undefined> {
    const a = artifacts.get(id)
    return a ? { ...a } : undefined
  }

  async function list(): Promise<Artifact[]> {
    return [...artifacts.values()].map((a) => ({ ...a }))
  }

  async function load(): Promise<void> {
    if (!existsSync(root)) return
    for (const id of await readdir(root)) {
      const mp = metaPath(id)
      if (!existsSync(mp)) continue
      // Skip individually corrupt entries rather than aborting the whole load.
      try {
        const a: Artifact = JSON.parse(await readFile(mp, "utf8"))
        const cp = commentsPath(id)
        const c: Comment[] = existsSync(cp) ? JSON.parse(await readFile(cp, "utf8")) : []
        artifacts.set(id, a)
        comments.set(id, c)
      } catch {
        // ignore unreadable/corrupt artifact directory
      }
    }
  }

  return {
    publish, readRevision, addComment, getComments,
    awaitVerdict, resolveVerdict, disposeAll, get, list, load,
    hasPending: (id: string) => pending.has(id),
  }
}

export type Store = ReturnType<typeof createStore>
