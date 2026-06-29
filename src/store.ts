import { mkdir, readFile, writeFile, readdir, rm } from "node:fs/promises"
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
  /** re-publish an approved (frozen) plan by sending it back for a fresh review */
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
      // An APPROVED plan (including a roadmap) is FROZEN: its content is the
      // immutable record of what the human signed off on, so re-publishing it is
      // rejected. Track implementation progress with the todo tool, not by
      // rewriting the plan. To change the plan's scope/approach, pass
      // `resubmit: true` — that sends it back to review for a fresh approval.
      if (existing.type === "plan" && existing.status === "approved" && !input.resubmit) {
        throw new Error(
          `approved plan is frozen and cannot be edited: ${existing.id}. ` +
            `Track progress with the todo tool; to change its scope or approach, ` +
            `re-publish with resubmit:true for a fresh review.`,
        )
      }
      wasDraft = existing.status === "draft"
      // Status follows the artifact's own type, not the (possibly mismatched)
      // type passed on re-publish. Reports stay published; plans re-enter their
      // pre-approval state (draft or awaiting_review) — the approved case is
      // rejected above, so a re-published plan is always heading back to review.
      const status = existing.type !== "plan" ? "published" : planStatus
      next = {
        ...existing,
        currentRevision: existing.currentRevision + 1,
        title: input.title,
        status,
        updatedAt: now,
        // A fresh review (resubmit) clears completion so this plan governs the
        // gate again. `completed` is only ever set on an approved plan, and an
        // approved plan can only be re-published via resubmit (the frozen guard
        // above rejects the rest), so this preserves existing.completed for the
        // unreachable non-resubmit case purely defensively.
        completed: input.resubmit ? false : existing.completed,
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

    // A NEW report is LINKED to the session's active plan (standalone or phase):
    // its parentId is set to that plan so it nests directly under the plan it
    // reports on. A STANDALONE plan (no parentId) is additionally COMPLETED — the
    // planned work is reported done, so the gate re-closes and new work needs a
    // fresh plan. A phase plan is NOT completed: a phase report is a mid-roadmap
    // milestone and the roadmap cadence re-closes the gate when the next phase is
    // submitted. Scoped to NEW reports (a revision must not re-link/re-complete).
    // The store derives the link from the active plan and ignores any caller-
    // passed parentId, falling back to it only when there is no active plan.
    // Done after the report's own I/O so a failed write leaves no dangling state,
    // and WITHOUT bumping updatedAt (linking/completion is not a content edit —
    // mirrors setArchived — and a completed plan is excluded from ordering anyway).
    if (isNew && next.type === "report" && input.sessionID) {
      const active = getActivePlan(input.sessionID)
      if (active) {
        next.parentId = active.id
        await persistMeta(next)
        if (!active.parentId) {
          const live = artifacts.get(active.id)
          if (live) {
            live.completed = true
            await persistMeta(live)
          }
        }
      }
    }
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

  /**
   * Edit the body of an unsubmitted comment. Only an *active* (unresolved)
   * comment can be changed: a resolved comment is the record of what already
   * rode to the agent on a verdict/revision and is immutable. Throws on an
   * unknown artifact, unknown comment, or a resolved comment.
   */
  async function editComment(id: string, commentId: string, body: string): Promise<Comment> {
    const list = comments.get(id)
    if (!list) throw new Error(`unknown artifact: ${id}`)
    const c = list.find((x) => x.id === commentId)
    if (!c) throw new Error(`unknown comment: ${commentId}`)
    if (c.resolved) throw new Error(`comment already submitted: ${commentId}`)
    c.body = body
    await persistComments(id)
    return { ...c }
  }

  /**
   * Delete an unsubmitted comment. Mirrors editComment's "active only" guard so
   * a resolved comment (already sent to the agent) can never be removed.
   */
  async function deleteComment(id: string, commentId: string): Promise<void> {
    const list = comments.get(id)
    if (!list) throw new Error(`unknown artifact: ${id}`)
    const c = list.find((x) => x.id === commentId)
    if (!c) throw new Error(`unknown comment: ${commentId}`)
    if (c.resolved) throw new Error(`comment already submitted: ${commentId}`)
    comments.set(id, list.filter((x) => x.id !== commentId))
    await persistComments(id)
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
      a.status =
        verdict.status === "approved"
          ? "approved"
          : verdict.status === "declined"
            ? "declined"
            : "changes_requested"
      // Record the reviewer's reason only when declining; clear any stale reason
      // otherwise so a later approve/changes-requested doesn't carry it.
      a.declineReason = verdict.status === "declined" ? verdict.reason : undefined
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

  /**
   * All transitive descendants of an artifact in the nesting tree (children,
   * grandchildren, ...): a roadmap's phase plans and each phase plan's reports;
   * a standalone plan's reports. Excludes the artifact itself. Order is
   * unspecified — callers that need ordering sort it themselves.
   */
  function descendantsOf(id: string): Artifact[] {
    const out: Artifact[] = []
    const stack = [id]
    while (stack.length) {
      const parent = stack.pop()!
      for (const a of artifacts.values()) {
        if (a.parentId === parent) {
          out.push(a)
          stack.push(a.id)
        }
      }
    }
    return out
  }

  /**
   * Archive or unarchive an artifact, hiding it from the main companion view.
   * A plan/roadmap is archived as a UNIT: the flag cascades to all transitive
   * descendants (a roadmap's phase plans and their reports; a plan's reports).
   * `updatedAt` is intentionally left untouched — this is not a content edit and
   * must not reorder the list or affect the gate. Returns the affected artifacts.
   */
  async function setArchived(id: string, archived: boolean): Promise<Artifact[]> {
    const a = artifacts.get(id)
    if (!a) throw new Error(`unknown artifact: ${id}`)
    const targets = [a, ...descendantsOf(id)]
    for (const t of targets) {
      t.archived = archived
      await persistMeta(t)
    }
    return targets.map((t) => ({ ...t }))
  }

  /**
   * Permanently delete an archived artifact and its on-disk directory. Delete
   * NEVER removes an un-archived artifact: the target must be archived, and the
   * cascade only sweeps up tied-together artifacts that are THEMSELVES archived.
   * This makes delete symmetric with the archive-before-delete invariant — you
   * can't lose a still-visible artifact by deleting something else. The cascade
   * covers: the target's archived transitive descendants (a roadmap's phase
   * plans and their reports; a plan's reports), plus — as a fallback for legacy
   * data published before reports were linked — archived standalone same-session
   * reports (reports sharing the target's sessionID with no parentId). Returns
   * the deleted ids.
   */
  async function remove(id: string): Promise<string[]> {
    const a = artifacts.get(id)
    if (!a) throw new Error(`unknown artifact: ${id}`)
    if (!a.archived) throw new Error(`artifact not archived: ${id}`)

    const ids = new Set<string>([id])
    for (const c of descendantsOf(id)) if (c.archived) ids.add(c.id)
    if (a.sessionID) {
      for (const c of artifacts.values()) {
        if (c.type === "report" && c.sessionID === a.sessionID && !c.parentId && c.archived)
          ids.add(c.id)
      }
    }

    for (const did of ids) {
      const p = pending.get(did)
      if (p) {
        pending.delete(did)
        p.reject(new Error("artifact deleted"))
      }
      artifacts.delete(did)
      comments.delete(did)
      await rm(artDir(did), { recursive: true, force: true })
    }
    return [...ids]
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
    // non-draft, NON-ROADMAP plan for the session. Roadmaps are excluded because
    // a roadmap is a decomposition overview, not an editable plan — it must never
    // become the gate-governing plan; drafts are excluded as not-yet-submitted.
    // Ordering by updatedAt means the phase currently submitted/approved is
    // active even when later-created phase drafts already exist. Completed plans
    // (a report marked the work done) are excluded so the gate re-closes until a
    // fresh plan is published or the plan is resubmitted.
    let active: Artifact | undefined
    for (const a of artifacts.values()) {
      if (a.type !== "plan" || a.sessionID !== sessionID) continue
      if (a.status === "draft" || a.isRoadmap || a.archived || a.completed) continue
      if (!active || a.updatedAt > active.updatedAt) active = a
    }
    return active ? { ...active } : undefined
  }

  /**
   * The session's most recently completed (report-finished), non-roadmap plan,
   * if any. Used only to craft an accurate gate blocked-reason after a report
   * has completed the active plan (which getActivePlan then excludes).
   */
  function getLastCompletedPlan(sessionID: string): Artifact | undefined {
    let last: Artifact | undefined
    for (const a of artifacts.values()) {
      if (a.type !== "plan" || a.sessionID !== sessionID) continue
      if (!a.completed || a.isRoadmap || a.archived) continue
      if (!last || a.updatedAt > last.updatedAt) last = a
    }
    return last ? { ...last } : undefined
  }

  /** The session's roadmap (most recently updated isRoadmap plan), if any. */
  function getRoadmap(sessionID: string): Artifact | undefined {
    let road: Artifact | undefined
    for (const a of artifacts.values()) {
      if (!a.isRoadmap || a.sessionID !== sessionID || a.archived) continue
      if (!road || a.updatedAt > road.updatedAt) road = a
    }
    return road ? { ...road } : undefined
  }

  /** Direct children of an artifact (parentId === id), oldest first. */
  function getChildren(parentId: string): Artifact[] {
    return [...artifacts.values()]
      .filter((a) => a.parentId === parentId && !a.archived)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((a) => ({ ...a }))
  }

  /**
   * All transitive descendants of an artifact (phase plans AND their reports for
   * a roadmap; reports for a plan), oldest first. Used to enumerate a roadmap's
   * full phase breakdown for the agent's context now that phase reports nest
   * under their phase plan rather than directly under the roadmap.
   */
  function getDescendants(parentId: string): Artifact[] {
    return descendantsOf(parentId)
      .filter((a) => !a.archived)
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
    publish, readRevision, addComment, editComment, deleteComment, getComments,
    awaitVerdict, resolveVerdict, disposeAll, get, list, load,
    setArchived, remove,
    getActivePlan, getLastCompletedPlan, getRoadmap, getChildren, getDescendants,
    hasPending: (id: string) => pending.has(id),
  }
}

export type Store = ReturnType<typeof createStore>
