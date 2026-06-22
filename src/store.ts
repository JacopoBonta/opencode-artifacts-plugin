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
    let a: Artifact
    if (input.artifactId && artifacts.has(input.artifactId)) {
      a = artifacts.get(input.artifactId)!
      a.currentRevision += 1
      a.title = input.title
      a.status = input.type === "plan" ? "awaiting_review" : "published"
      a.updatedAt = now
    } else {
      const id = input.artifactId ?? idgen()
      a = {
        id,
        type: input.type,
        title: input.title,
        status: input.type === "plan" ? "awaiting_review" : "published",
        currentRevision: 1,
        createdAt: now,
        updatedAt: now,
        sessionID: input.sessionID,
      }
      artifacts.set(id, a)
      comments.set(id, [])
    }
    await mkdir(join(artDir(a.id), "revisions"), { recursive: true })
    await writeFile(revPath(a.id, a.currentRevision), input.content)
    await persistMeta(a)
    if (!existsSync(commentsPath(a.id))) await persistComments(a.id)
    return { artifact: { ...a } }
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
    return [...(comments.get(id) ?? [])]
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
      const a: Artifact = JSON.parse(await readFile(mp, "utf8"))
      artifacts.set(id, a)
      const cp = commentsPath(id)
      comments.set(id, existsSync(cp) ? JSON.parse(await readFile(cp, "utf8")) : [])
    }
  }

  return {
    publish, readRevision, addComment, getComments,
    awaitVerdict, resolveVerdict, disposeAll, get, list, load,
    hasPending: (id: string) => pending.has(id),
  }
}

export type Store = ReturnType<typeof createStore>
