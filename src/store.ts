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
  /** name of the agent that created this artifact */
  agent?: string
  /** roadmap this artifact belongs to (phase plans + phase reports) */
  parentId?: string
  /** mark a plan as a decomposition overview */
  isRoadmap?: boolean
  /** scratch a plan as a non-blocking draft (not yet submitted for review) */
  draft?: boolean
  /** force a fresh review of an already-approved plan (instead of a progress update) */
  resubmit?: boolean
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

    // Build the next artifact state without mutating the live reference, so a
    // failed write leaves in-memory state untouched (commit only after I/O).
    // A plan published with `draft` is a non-blocking scratch; re-publishing it
    // WITHOUT `draft` submits it for review (→ awaiting_review).
    const planStatus = input.draft ? "draft" : "awaiting_review"
    let next: Artifact
    const isNew = !input.artifactId
    let wasDraft = false
    if (input.artifactId) {
      const existing = artifacts.get(input.artifactId)
      if (!existing) {
        throw new Error(`unknown artifactId: ${input.artifactId}`)
      }
      wasDraft = existing.status === "draft"
      // Status follows the artifact's own type, not the (possibly mismatched)
      // type passed on re-publish. Re-publishing an APPROVED plan is a
      // non-blocking progress update that stays approved (Status/checkbox edits
      // don't need re-approval); `resubmit` forces a fresh review instead.
      const status =
        existing.type !== "plan"
          ? "published"
          : existing.status === "approved" && !input.draft && !input.resubmit
            ? "approved"
            : planStatus
      next = {
        ...existing,
        currentRevision: existing.currentRevision + 1,
        title: input.title,
        status,
        updatedAt: now,
      }
    } else {
      const status = input.type === "plan" ? planStatus : "published"
      next = {
        id: idgen(),
        type: input.type,
        title: input.title,
        status,
        currentRevision: 1,
        createdAt: now,
        updatedAt: now,
        sessionID: input.sessionID,
        agent: input.agent,
        parentId: input.parentId,
        isRoadmap: input.isRoadmap,
      }
    }

    await mkdir(join(artDir(next.id), "revisions"), { recursive: true })
    await writeFile(revPath(next.id, next.currentRevision), input.content)
    await writeFile(metaPath(next.id), JSON.stringify(next, null, 2))

    // On a revision bump, prior comments are assumed addressed by the new
    // revision — mark them resolved. Exception: refining/submitting a DRAFT keeps
    // its comments unresolved so early feedback stays visible and rides to the
    // agent on the eventual verdict.
    let resolvedComments: Comment[] | undefined
    if (!isNew && !wasDraft) {
      resolvedComments = (comments.get(next.id) ?? []).map((c) => ({ ...c, resolved: true }))
      await writeFile(commentsPath(next.id), JSON.stringify(resolvedComments, null, 2))
    }
    if (isNew && !existsSync(commentsPath(next.id))) {
      await writeFile(commentsPath(next.id), JSON.stringify([], null, 2))
    }

    // Commit to in-memory state only after all writes succeeded.
    artifacts.set(next.id, next)
    if (isNew) comments.set(next.id, [])
    else if (resolvedComments) comments.set(next.id, resolvedComments)
    return { artifact: { ...next } }
  }

  async function readRevision(id: string, rev: number): Promise<string> {
    return readFile(revPath(id, rev), "utf8")
  }

  async function addComment(
    id: string,
    input: Omit<Comment, "id" | "resolved" | "createdAt">,
  ): Promise<Comment> {
    if (!artifacts.has(id)) throw new Error(`unknown artifact: ${id}`)
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

  /**
   * Block until a verdict arrives via resolveVerdict (the browser approving or
   * requesting changes). This intentionally has NO timeout: a plan parks the
   * agent until the human reviews it. It only rejects via disposeAll() when the
   * plugin shuts down — so closing the browser without acting leaves the agent
   * blocked until the opencode session ends.
   */
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

  /**
   * The session's active plan: the most recently created plan artifact for the
   * session. Used by the workflow gate to decide whether edits are unblocked.
   * Synchronous — reads only in-memory state.
   */
  function getActivePlan(sessionID: string): Artifact | undefined {
    // The active plan governs the edit gate: the most recently *updated*
    // non-draft, NON-ROADMAP plan for the session. Roadmaps are excluded so that
    // updating a roadmap's Status (a progress update) can't flip it to "active"
    // and close the gate mid-phase; drafts are excluded as not-yet-submitted.
    // Ordering by updatedAt means the phase currently submitted/approved is
    // active even when later-created phase drafts already exist.
    let active: Artifact | undefined
    for (const a of artifacts.values()) {
      if (a.type !== "plan" || a.sessionID !== sessionID) continue
      if (a.status === "draft" || a.isRoadmap) continue
      if (!active || a.updatedAt > active.updatedAt) active = a
    }
    return active ? { ...active } : undefined
  }

  /** The session's roadmap (most recently updated isRoadmap plan), if any. */
  function getRoadmap(sessionID: string): Artifact | undefined {
    let road: Artifact | undefined
    for (const a of artifacts.values()) {
      if (!a.isRoadmap || a.sessionID !== sessionID) continue
      if (!road || a.updatedAt > road.updatedAt) road = a
    }
    return road ? { ...road } : undefined
  }

  /** Artifacts (phase plans + reports) that belong to a roadmap, oldest first. */
  function getChildren(parentId: string): Artifact[] {
    return [...artifacts.values()]
      .filter((a) => a.parentId === parentId)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((a) => ({ ...a }))
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
    getActivePlan, getRoadmap, getChildren,
    hasPending: (id: string) => pending.has(id),
  }
}

export type Store = ReturnType<typeof createStore>
