import React, { useEffect, useState, useCallback, useRef, useMemo } from "react"
import "./App.css"
import * as api from "./api"
import type { Anchor, Artifact, ArtifactDetail } from "./api"
import { ArtifactList, recentSessions, sessionKey } from "./components/ArtifactList"
import { ArtifactView } from "./components/ArtifactView"
import { CommentThread } from "./components/CommentThread"
import { ActionBar } from "./components/ActionBar"
import { RevisionSwitcher } from "./components/RevisionSwitcher"
import { ThemeToggle } from "./components/ThemeToggle"
import { ReadingWidthToggle } from "./components/ReadingWidthToggle"
import { ScopeToggle } from "./components/ScopeToggle"
import { SessionsIntro } from "./components/SessionsIntro"
import { ResizeHandle } from "./components/ResizeHandle"
import {
  getRailLeft, getRailRight, setRailLeft, setRailRight, clampLeft, clampRight,
  getScope, setScope as persistScope, type Scope,
} from "./layoutPrefs"

export function App() {
  const [railLeft, setRailLeftW] = useState(getRailLeft)
  const [railRight, setRailRightW] = useState(getRailRight)
  const [artifacts, setArtifacts] = useState<Artifact[]>([])
  const [selectedId, setSelectedId] = useState<string>()
  const [detail, setDetail] = useState<ArtifactDetail>()
  const [pendingAnchor, setPendingAnchor] = useState<Anchor>()
  const [connected, setConnected] = useState(true)
  // The opencode session the user is currently in (pushed over SSE), and the set
  // of artifact ids with new/updated activity not yet opened — drives the
  // current-session highlight and the activity dots.
  const [activeSessionID, setActiveSessionID] = useState<string>()
  // The session the rail centers on in "This session" scope. Distinct from
  // activeSessionID so the user can focus a session manually from the intro page;
  // it follows the live session whenever that changes (see the effect below).
  const [focusedSessionID, setFocusedSessionID] = useState<string>()
  const [scope, setScopeState] = useState<Scope>(getScope)
  const [unseen, setUnseen] = useState<Set<string>>(new Set())
  const [submittingVerdict, setSubmittingVerdict] = useState(false)
  // undefined = viewing the latest revision
  const [viewedRevision, setViewedRevision] = useState<number>()
  const [historicalContent, setHistoricalContent] = useState<string>()
  const flashSeq = useRef(0)
  const [flashComment, setFlashComment] = useState<{ id: string; key: number }>()
  const [flashAnchor, setFlashAnchor] = useState<{ id: string; key: number }>()
  const onHighlightClick = useCallback((id: string) => setFlashComment({ id, key: ++flashSeq.current }), [])
  const onCommentClick = useCallback((id: string) => setFlashAnchor({ id, key: ++flashSeq.current }), [])

  // A transient fetch-error message (distinct from `connected`, which tracks the
  // SSE stream). Cleared by the next successful list/detail refresh.
  const [error, setError] = useState<string>()
  // Current selection, mirrored into a ref so the SSE handler can read it without
  // re-subscribing on every selection change.
  const selectedIdRef = useRef<string>()
  useEffect(() => { selectedIdRef.current = selectedId }, [selectedId])
  // Monotonic counters: a slow, stale response must not clobber a newer one.
  const detailSeq = useRef(0)
  const revSeq = useRef(0)

  const refreshList = useCallback(async () => {
    try {
      setArtifacts(await api.listArtifacts())
      setError(undefined)
    } catch {
      setError("Couldn't reach the companion server.")
    }
  }, [])
  const refreshDetail = useCallback(async (id: string) => {
    const seq = ++detailSeq.current
    try {
      const d = await api.getArtifact(id)
      if (seq !== detailSeq.current) return // a newer refresh superseded this one
      setDetail(d)
      setError(undefined)
    } catch {
      if (seq === detailSeq.current) setError("Couldn't load the selected artifact.")
    }
  }, [])

  const select = useCallback((id: string) => {
    setSelectedId(id)
    selectedIdRef.current = id
    setPendingAnchor(undefined)
    setViewedRevision(undefined)
    setHistoricalContent(undefined)
    // Opening an artifact clears its activity dot.
    setUnseen((prev) => {
      if (!prev.has(id)) return prev
      const next = new Set(prev)
      next.delete(id)
      return next
    })
    refreshDetail(id)
  }, [refreshDetail])

  useEffect(() => { refreshList() }, [refreshList])

  useEffect(() => {
    return api.subscribeEvents(
      (e) => {
        setConnected(true)
        if (e.type === "ping") return
        if (e.type === "session.active") {
          setActiveSessionID(e.sessionID)
          return
        }
        refreshList()
        if (e.type === "artifact.deleted") {
          // Drop any pending dot for the removed artifact; the membership effect
          // clears the selection once the refreshed list arrives.
          setUnseen((prev) => {
            if (!prev.has(e.id)) return prev
            const next = new Set(prev)
            next.delete(e.id)
            return next
          })
          return
        }
        const sel = selectedIdRef.current
        if (sel && e.id === sel) {
          // A new revision may have arrived — return to the latest view.
          setViewedRevision(undefined)
          setHistoricalContent(undefined)
          refreshDetail(sel)
          return
        }
        // New/updated activity on an artifact that isn't open — flag it.
        if (
          e.type === "artifact.published" ||
          e.type === "artifact.updated" ||
          e.type === "comment.added"
        ) {
          setUnseen((prev) => {
            if (prev.has(e.id)) return prev
            return new Set(prev).add(e.id)
          })
        }
      },
      () => setConnected(false),
    )
    // Subscribe ONCE: the handler reads the live selection from selectedIdRef, so
    // it never needs to tear down/recreate the EventSource (which would drop
    // events during the reconnect window) when the selection changes.
  }, [refreshList, refreshDetail])

  // Follow the live session: when the user moves to a session in opencode, focus
  // it. Keyed on activeSessionID, so a manual "back to sessions" (which clears the
  // focus) isn't immediately re-overridden — only a real session switch re-focuses.
  useEffect(() => {
    if (activeSessionID) setFocusedSessionID(activeSessionID)
  }, [activeSessionID])

  const setScope = useCallback((s: Scope) => {
    setScopeState(s)
    persistScope(s)
  }, [])

  // Recent sessions for the intro page, and the effective focus. With a single
  // session there's nothing to choose, so focus it implicitly rather than showing
  // a one-card intro; with several, the intro lets the user pick.
  const sessions = useMemo(() => recentSessions(artifacts, unseen), [artifacts, unseen])
  const focusKey = focusedSessionID ?? (sessions.length === 1 ? sessions[0].key : undefined)

  const focusSession = useCallback((key: string) => setFocusedSessionID(key), [])
  const showSessions = useCallback(() => {
    setFocusedSessionID(undefined)
    setSelectedId(undefined)
    setDetail(undefined)
  }, [])

  // Auto-select the focused session's most recently updated artifact once the list
  // loads and nothing is selected. Order-independent so it's stable across
  // refreshes — the raw list arrives in filesystem order, not recency order, so
  // picking by array position would lock onto an arbitrary old artifact. With no
  // focused session we leave the selection empty so the sessions intro shows.
  useEffect(() => {
    if (selectedId || !artifacts.length || !focusKey) return
    const pool = artifacts.filter((a) => !a.archived && sessionKey(a) === focusKey)
    if (!pool.length) return
    const target = pool.reduce((best, a) => (a.updatedAt > best.updatedAt ? a : best))
    select(target.id)
  }, [artifacts, selectedId, focusKey, select])

  // Clear the selection when the selected artifact is gone (e.g. deleted).
  useEffect(() => {
    if (selectedId && artifacts.length && !artifacts.some((a) => a.id === selectedId)) {
      setSelectedId(undefined)
      setDetail(undefined)
    }
  }, [artifacts, selectedId])

  async function archive(id: string) {
    try {
      await api.setArchived(id, true)
    } catch {
      setError("Couldn't archive the artifact.")
    }
    refreshList()
  }
  async function unarchive(id: string) {
    try {
      await api.setArchived(id, false)
    } catch {
      setError("Couldn't unarchive the artifact.")
    }
    refreshList()
  }
  async function remove(id: string) {
    try {
      await api.deleteArtifact(id)
    } catch {
      setError("Couldn't delete the artifact.")
    }
    refreshList()
  }

  const pickRevision = useCallback(async (n: number) => {
    if (!detail) return
    if (n >= detail.artifact.currentRevision) {
      setViewedRevision(undefined)
      setHistoricalContent(undefined)
      return
    }
    setViewedRevision(n)
    const seq = ++revSeq.current
    try {
      const { content } = await api.getRevision(detail.artifact.id, n)
      if (seq === revSeq.current) {
        setHistoricalContent(content)
        setError(undefined)
      }
    } catch {
      if (seq === revSeq.current) setError(`Couldn't load revision ${n}.`)
    }
  }, [detail])

  async function addComment(body: string, anchor?: Anchor) {
    if (!detail) return
    try {
      await api.postComment(detail.artifact.id, {
        revision: detail.artifact.currentRevision,
        kind: anchor ? "anchor" : "general",
        anchor,
        body,
      })
      setPendingAnchor(undefined)
      refreshDetail(detail.artifact.id)
    } catch {
      setError("Couldn't post the comment.")
    }
  }

  async function verdict(
    status: "approved" | "changes_requested" | "declined",
    reason?: string,
  ) {
    if (!detail) return
    setSubmittingVerdict(true)
    try {
      await api.postVerdict(detail.artifact.id, status, reason)
      await refreshDetail(detail.artifact.id)
    } catch {
      setError("Couldn't submit the verdict.")
    } finally {
      setSubmittingVerdict(false)
    }
  }

  const total = detail?.artifact.currentRevision ?? 0
  const viewing = viewedRevision ?? total
  const isLatest = viewing === total
  // A draft can be commented on (early feedback) but not approved until the
  // agent submits it for review.
  const canComment =
    isLatest &&
    detail?.artifact.type === "plan" &&
    detail?.artifact.status !== "approved" &&
    detail?.artifact.status !== "declined"
  const isDraft = detail?.artifact.status === "draft"
  const canApprove = canComment && !isDraft
  const revisionComments = detail
    ? (isLatest ? detail.comments : detail.comments.filter((c) => c.revision === viewing))
    : []

  return (
    <div
      className="layout"
      style={{ "--rail-left": `${railLeft}px`, "--rail-right": `${railRight}px` } as React.CSSProperties}
    >
      {!connected && (
        <div className="conn-lost">Connection lost — reconnecting…</div>
      )}
      {error && (
        <div className="conn-lost error-banner" role="alert">{error}</div>
      )}
      <ResizeHandle
        side="left"
        width={railLeft}
        onResize={(w) => setRailLeftW(clampLeft(w))}
        onCommit={(w) => setRailLeft(w)}
      />
      <ResizeHandle
        side="right"
        width={railRight}
        onResize={(w) => setRailRightW(clampRight(w))}
        onCommit={(w) => setRailRight(w)}
      />
      <aside className="rail">
        <div className="rail-header">
          <h2>Artifacts</h2>
          <div className="rail-header-actions">
            <ReadingWidthToggle />
            <ThemeToggle />
          </div>
        </div>
        <ScopeToggle scope={scope} onChange={setScope} />
        <ArtifactList
          artifacts={artifacts}
          selectedId={selectedId}
          activeSessionID={activeSessionID}
          focusedSessionID={focusKey}
          scope={scope}
          unseenIds={unseen}
          onSelect={select}
          onShowAll={() => setScope("all")}
          onShowSessions={showSessions}
          onUnarchive={unarchive}
          onDelete={remove}
        />
      </aside>
      <main className="main">
        {detail ? (
          <>
            <header className="main-header">
              <div className="main-header-left">
                <h1>{detail.artifact.title}</h1>
                {detail.artifact.agent && (
                  <span className="main-subtitle">by {detail.artifact.agent}</span>
                )}
              </div>
              <div className="main-header-right">
                <RevisionSwitcher total={total} viewing={viewing} onSelect={pickRevision} />
                {!detail.artifact.parentId && !detail.artifact.archived && (
                  <button
                    type="button"
                    className="archive-btn"
                    title="Archive — hide from the main view"
                    onClick={() => archive(detail.artifact.id)}
                  >
                    Archive
                  </button>
                )}
                <span className={`status status-${detail.artifact.status}`}>
                  {detail.artifact.status.replace(/_/g, " ")}
                </span>
              </div>
            </header>
            {!isLatest && (
              <div className="historical-banner">
                <span>Revision {viewing} of {total} (historical)</span>
                <button type="button" onClick={() => pickRevision(total)}>Back to latest</button>
              </div>
            )}
            {isLatest && detail.artifact.status === "approved" && (
              <div className="approved-banner">✓ Approved — review closed</div>
            )}
            {isLatest && detail.artifact.status === "declined" && (
              <div className="declined-banner">
                ✕ Declined — the agent was stopped.
                {detail.artifact.declineReason && (
                  <span className="declined-reason"> Reason: {detail.artifact.declineReason}</span>
                )}
              </div>
            )}
            <ArtifactView
              content={isLatest ? detail.content : historicalContent ?? ""}
              comments={revisionComments}
              highlightResolved={!isLatest}
              onAnchor={canComment ? setPendingAnchor : () => {}}
              onHighlightClick={onHighlightClick}
              flashAnchorId={flashAnchor?.id}
              flashKey={flashAnchor?.key}
            />
          </>
        ) : !focusKey && !selectedId ? (
          <SessionsIntro sessions={sessions} onPick={focusSession} />
        ) : (
          <p className="empty">Select an artifact.</p>
        )}
      </main>
      <aside className="rail comments-rail">
        {detail && (
          <>
            {canComment ? (
              <>
                {pendingAnchor && (
                  <div className="pending-anchor">
                    <div className="pending-anchor-head">
                      <span>Commenting on:</span>
                      <button
                        type="button"
                        className="pending-anchor-clear"
                        aria-label="Clear selection"
                        title="Clear selection"
                        onClick={() => setPendingAnchor(undefined)}
                      >
                        ×
                      </button>
                    </div>
                    <blockquote>{pendingAnchor.quote}</blockquote>
                  </div>
                )}
                <CommentThread
                  title="Comments"
                  comments={detail.comments}
                  onAdd={(body) => addComment(body, pendingAnchor)}
                  onCommentClick={onCommentClick}
                  flashCommentId={flashComment?.id}
                  flashKey={flashComment?.key}
                />
                {canApprove ? (
                  <ActionBar
                    onApprove={() => verdict("approved")}
                    onRequestChanges={() => verdict("changes_requested")}
                    onDecline={(reason) => verdict("declined", reason)}
                    disabled={submittingVerdict || detail.artifact.status === "changes_requested"}
                    note={
                      detail.artifact.status === "changes_requested"
                        ? "Changes requested — awaiting the agent's revision."
                        : undefined
                    }
                  />
                ) : (
                  <div className="draft-banner">
                    Draft — the agent will submit this phase for review when its cycle begins.
                    Comments are saved and shared with the agent then.
                  </div>
                )}
              </>
            ) : detail.artifact.type === "report" ? (
              <p className="empty">Agent report — read-only.</p>
            ) : (
              <CommentThread
                title={isLatest ? "Comments" : `Comments · revision ${viewing}`}
                comments={revisionComments}
                onAdd={() => {}}
                readOnly
                onCommentClick={onCommentClick}
                flashCommentId={flashComment?.id}
                flashKey={flashComment?.key}
              />
            )}
          </>
        )}
      </aside>
    </div>
  )
}
