import React, { useEffect, useLayoutEffect, useState, useCallback, useRef, useMemo } from "react"
import "./App.css"
import * as api from "./api"
import type { Anchor, Artifact, ArtifactDetail } from "./api"
import { ArtifactTree, visibleArtifactIds, isOpen } from "./components/ArtifactTree"
import { TabBar } from "./components/TabBar"
import { CommandPalette } from "./components/CommandPalette"
import { ArtifactView } from "./components/ArtifactView"
import { CommentThread } from "./components/CommentThread"
import { ActionBar } from "./components/ActionBar"
import { RevisionSwitcher } from "./components/RevisionSwitcher"
import { ThemeToggle } from "./components/ThemeToggle"
import { ReadingWidthToggle } from "./components/ReadingWidthToggle"
import { ResizeHandle } from "./components/ResizeHandle"
import { Toaster } from "./components/Toaster"
import { ShortcutHelp, ShortcutList } from "./components/ShortcutHelp"
import { findAnchorOffsets } from "./anchor-dom"
import { useToasts } from "./toasts"
import { useShortcuts } from "./shortcuts"
import {
  getRailLeft, getRailRight, setRailLeft, setRailRight, clampLeft, clampRight,
  getOpenTabs, setOpenTabs as persistOpenTabs,
  getActiveTab, setActiveTab as persistActiveTab,
  getCollapsed, setCollapsed as persistCollapsed,
} from "./layoutPrefs"

export function App() {
  const [railLeft, setRailLeftW] = useState(getRailLeft)
  const [railRight, setRailRightW] = useState(getRailRight)
  const [artifacts, setArtifacts] = useState<Artifact[]>([])
  // Editor tabs: ids of open artifacts (in order) and the active one. Restored
  // from localStorage, then pruned against the loaded list.
  const [openTabs, setOpenTabs] = useState<string[]>(getOpenTabs)
  const [activeTabId, setActiveTabId] = useState<string | undefined>(getActiveTab)
  const [detail, setDetail] = useState<ArtifactDetail>()
  const [pendingAnchor, setPendingAnchor] = useState<Anchor>()
  const [connected, setConnected] = useState(true)
  // The opencode session the user is currently in (pushed over SSE) — highlights
  // the tree and auto-opens that session's latest artifact.
  const [activeSessionID, setActiveSessionID] = useState<string>()
  // Artifact ids with new/updated activity not yet opened — drives tree + tab dots.
  const [unseen, setUnseen] = useState<Set<string>>(new Set())
  // Tree collapse state (session keys, `rm:<id>`, archived) and the keyboard cursor.
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(getCollapsed)
  const [treeIndex, setTreeIndex] = useState(0)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [submittingVerdict, setSubmittingVerdict] = useState(false)
  // undefined = viewing the latest revision
  const [viewedRevision, setViewedRevision] = useState<number>()
  const [historicalContent, setHistoricalContent] = useState<string>()
  // Set when a new revision arrives while the reader is pinned to an older one,
  // so we can nudge instead of yanking them to latest.
  const [newerRevision, setNewerRevision] = useState(false)
  const flashSeq = useRef(0)
  const [flashComment, setFlashComment] = useState<{ id: string; key: number }>()
  const [flashAnchor, setFlashAnchor] = useState<{ id: string; key: number }>()
  const onHighlightClick = useCallback((id: string) => setFlashComment({ id, key: ++flashSeq.current }), [])
  const onCommentClick = useCallback((id: string) => setFlashAnchor({ id, key: ++flashSeq.current }), [])

  // Transient success/error notifications (distinct from `connected`, which
  // tracks the persistent SSE-stream banner).
  const { toasts, push, dismiss } = useToasts()
  // Tab state mirrored into refs so the once-subscribed SSE handler and the
  // close-tab callback can read it without re-subscribing.
  const openTabsRef = useRef<string[]>(openTabs)
  const activeTabIdRef = useRef<string | undefined>(activeTabId)
  const viewedRevisionRef = useRef<number | undefined>(viewedRevision)
  useEffect(() => { openTabsRef.current = openTabs }, [openTabs])
  useEffect(() => { activeTabIdRef.current = activeTabId }, [activeTabId])
  useEffect(() => { viewedRevisionRef.current = viewedRevision }, [viewedRevision])
  // Monotonic counters: a slow, stale response must not clobber a newer one.
  const detailSeq = useRef(0)
  const revSeq = useRef(0)
  // Editor scroll preservation: remember scrollTop per artifact+revision so an
  // in-place content refresh (e.g. a new comment over SSE) doesn't jump to top.
  const editorRef = useRef<HTMLDivElement>(null)
  const scrollPos = useRef<Map<string, number>>(new Map())

  const refreshList = useCallback(async () => {
    try {
      setArtifacts(await api.listArtifacts())
    } catch {
      push("error", "Couldn't reach the companion server.", { label: "Retry", onClick: () => { refreshList() } })
    }
  }, [push])
  const refreshDetail = useCallback(async (id: string) => {
    const seq = ++detailSeq.current
    try {
      const d = await api.getArtifact(id)
      if (seq !== detailSeq.current) return // a newer refresh superseded this one
      setDetail(d)
    } catch {
      if (seq === detailSeq.current)
        push("error", "Couldn't load the selected artifact.", { label: "Retry", onClick: () => { refreshDetail(id) } })
    }
  }, [push])

  // Activate an open tab: focus it and clear its activity dot.
  const activate = useCallback((id: string) => {
    setActiveTabId(id)
    setUnseen((prev) => {
      if (!prev.has(id)) return prev
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }, [])

  // Open (or focus, if already open) an artifact in a tab.
  const openTab = useCallback((id: string) => {
    setOpenTabs((prev) => (prev.includes(id) ? prev : [...prev, id]))
    activate(id)
  }, [activate])

  // Close a tab; if it was active, activate the left neighbor (else the right).
  const closeTab = useCallback((id: string) => {
    const prev = openTabsRef.current
    const idx = prev.indexOf(id)
    if (idx === -1) return
    const next = prev.filter((x) => x !== id)
    setOpenTabs(next)
    if (activeTabIdRef.current === id) {
      setActiveTabId(next[idx - 1] ?? next[idx] ?? undefined)
    }
  }, [])

  const toggleCollapse = useCallback((key: string) => {
    setCollapsed((c) => ({ ...c, [key]: isOpen(c, key) }))
  }, [])

  useEffect(() => { refreshList() }, [refreshList])

  // Persist tabs so the workspace is restored on reload.
  useEffect(() => { persistOpenTabs(openTabs) }, [openTabs])
  useEffect(() => { persistActiveTab(activeTabId) }, [activeTabId])
  useEffect(() => { persistCollapsed(collapsed) }, [collapsed])

  // Prune tabs for artifacts that no longer exist once the list loads/changes.
  useEffect(() => {
    if (!artifacts.length) return
    const exists = new Set(artifacts.map((a) => a.id))
    setOpenTabs((prev) => {
      const next = prev.filter((id) => exists.has(id))
      return next.length === prev.length ? prev : next
    })
  }, [artifacts])

  // Keep the active tab pointing at an open tab (or nothing).
  useEffect(() => {
    if (activeTabId && !openTabs.includes(activeTabId)) {
      setActiveTabId(openTabs[openTabs.length - 1])
    }
  }, [openTabs, activeTabId])

  // Fetch the active tab's detail (and reset the revision view) when it changes.
  useEffect(() => {
    if (!activeTabId) { setDetail(undefined); return }
    setViewedRevision(undefined)
    setHistoricalContent(undefined)
    setNewerRevision(false)
    refreshDetail(activeTabId)
  }, [activeTabId, refreshDetail])

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
          closeTab(e.id)
          setUnseen((prev) => {
            if (!prev.has(e.id)) return prev
            const next = new Set(prev)
            next.delete(e.id)
            return next
          })
          return
        }
        if (e.id === activeTabIdRef.current) {
          if (viewedRevisionRef.current !== undefined) {
            // The reader is pinned to an older revision — keep them there and
            // surface a nudge instead of yanking the view to latest.
            setNewerRevision(true)
            refreshDetail(e.id)
          } else {
            // A new revision may have arrived — return to the latest view.
            setHistoricalContent(undefined)
            refreshDetail(e.id)
          }
          return
        }
        // New/updated activity on an artifact that isn't the active tab — flag it.
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
    // Subscribe ONCE: the handler reads live tab state from refs, so it never
    // tears down/recreates the EventSource (which would drop events) on a switch.
  }, [refreshList, refreshDetail, closeTab])

  // Land in the live work: when the opencode session changes, open its
  // most-recently-updated artifact once. Keyed on the session (not on openTabs)
  // and guarded by a ref, so closing that tab doesn't immediately reopen it and a
  // routine list refresh doesn't reopen it either. If the session has no artifacts
  // yet, we leave the ref unset and retry when the list next changes.
  const autoOpenedFor = useRef<string>()
  useEffect(() => {
    if (!activeSessionID || !artifacts.length) return
    if (autoOpenedFor.current === activeSessionID) return
    const pool = artifacts.filter((a) => !a.archived && a.sessionID === activeSessionID)
    if (!pool.length) return
    autoOpenedFor.current = activeSessionID
    const hasTab = openTabsRef.current.some(
      (id) => artifacts.find((a) => a.id === id)?.sessionID === activeSessionID,
    )
    if (!hasTab) {
      const target = pool.reduce((best, a) => (a.updatedAt > best.updatedAt ? a : best))
      openTab(target.id)
    }
  }, [activeSessionID, artifacts, openTab])

  const openArtifacts = useMemo(
    () => openTabs.map((id) => artifacts.find((a) => a.id === id)).filter((a): a is Artifact => !!a),
    [openTabs, artifacts],
  )
  // The explorer is scoped to the current session: the live opencode session,
  // falling back to the active tab's session so it isn't empty when you've opened
  // something with no live session.
  const activeTabSession = openArtifacts.find((a) => a.id === activeTabId)?.sessionID
  const focusedSessionID = activeSessionID ?? activeTabSession
  const isLive = !!activeSessionID && focusedSessionID === activeSessionID
  const visibleIds = useMemo(
    () => visibleArtifactIds(artifacts, collapsed, focusedSessionID),
    [artifacts, collapsed, focusedSessionID],
  )
  const kbdIndex = visibleIds.length ? Math.min(treeIndex, visibleIds.length - 1) : 0
  const keyboardId = visibleIds[kbdIndex]

  // Keep the keyboard cursor on the active artifact when it's visible.
  useEffect(() => {
    if (!activeTabId) return
    const i = visibleIds.indexOf(activeTabId)
    if (i >= 0) setTreeIndex(i)
  }, [activeTabId, visibleIds])

  const cycleTab = useCallback((dir: 1 | -1) => {
    const tabs = openTabsRef.current
    if (!tabs.length) return
    const cur = activeTabIdRef.current ? tabs.indexOf(activeTabIdRef.current) : -1
    const next = (cur + dir + tabs.length) % tabs.length
    activate(tabs[next])
  }, [activate])

  async function archive(id: string) {
    try {
      await api.setArchived(id, true)
      push("success", "Artifact archived.")
    } catch {
      push("error", "Couldn't archive the artifact.")
    }
    refreshList()
  }
  async function unarchive(id: string) {
    try {
      await api.setArchived(id, false)
      push("success", "Artifact unarchived.")
    } catch {
      push("error", "Couldn't unarchive the artifact.")
    }
    refreshList()
  }
  async function remove(id: string) {
    try {
      await api.deleteArtifact(id)
      push("success", "Artifact deleted.")
    } catch {
      push("error", "Couldn't delete the artifact.")
    }
    refreshList()
  }

  const pickRevision = useCallback(async (n: number) => {
    if (!detail) return
    if (n >= detail.artifact.currentRevision) {
      setViewedRevision(undefined)
      setHistoricalContent(undefined)
      setNewerRevision(false)
      return
    }
    setViewedRevision(n)
    const seq = ++revSeq.current
    try {
      const { content } = await api.getRevision(detail.artifact.id, n)
      if (seq === revSeq.current) setHistoricalContent(content)
    } catch {
      if (seq === revSeq.current)
        push("error", `Couldn't load revision ${n}.`, { label: "Retry", onClick: () => { pickRevision(n) } })
    }
  }, [detail, push])

  async function addComment(body: string, anchor?: Anchor): Promise<boolean> {
    if (!detail) return false
    try {
      await api.postComment(detail.artifact.id, {
        revision: detail.artifact.currentRevision,
        kind: anchor ? "anchor" : "general",
        anchor,
        body,
      })
      setPendingAnchor(undefined)
      refreshDetail(detail.artifact.id)
      push("success", "Comment posted.")
      return true
    } catch {
      // Return false so the thread keeps the user's draft instead of clearing it.
      push("error", "Couldn't post the comment.")
      return false
    }
  }

  async function editComment(commentId: string, body: string) {
    if (!detail) return
    try {
      await api.patchComment(detail.artifact.id, commentId, body)
      refreshDetail(detail.artifact.id)
      push("success", "Comment updated.")
    } catch {
      push("error", "Couldn't update the comment.")
    }
  }

  async function deleteComment(commentId: string) {
    if (!detail) return
    try {
      await api.deleteComment(detail.artifact.id, commentId)
      refreshDetail(detail.artifact.id)
      push("success", "Comment deleted.")
    } catch {
      push("error", "Couldn't delete the comment.")
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
      push(
        "success",
        status === "approved"
          ? "Plan approved."
          : status === "declined"
            ? "Plan declined — the agent was stopped."
            : "Changes requested.",
      )
    } catch {
      push("error", "Couldn't submit the verdict.")
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
  // Content currently on screen, and the anchor comments whose quote no longer
  // matches it — surfaced in the thread instead of silently dropping them.
  const displayedContent = detail ? (isLatest ? detail.content : historicalContent ?? "") : ""
  // Restore the remembered scroll position after the content re-renders for the
  // same artifact+revision; a different key (new artifact/revision) starts at top.
  const scrollKey = `${activeTabId ?? ""}:${viewing}`
  useLayoutEffect(() => {
    const el = editorRef.current
    if (el) el.scrollTop = scrollPos.current.get(scrollKey) ?? 0
  }, [displayedContent, scrollKey])
  const orphanedIds = useMemo(() => {
    const out = new Set<string>()
    for (const c of revisionComments) {
      if (c.kind === "anchor" && c.anchor && !findAnchorOffsets(displayedContent, c.anchor)) out.add(c.id)
    }
    return out
  }, [displayedContent, revisionComments])

  // Keyboard layer. Config is re-read from a ref each keypress, so these closures
  // always see fresh state.
  useShortcuts({
    // The palette and help overlay both own the keyboard while open (only
    // Cmd/Ctrl-K + Esc pass through).
    paletteOpen: paletteOpen || helpOpen,
    onPaletteToggle: () => setPaletteOpen((o) => !o),
    onEscape: () => {
      if (paletteOpen) setPaletteOpen(false)
      else if (helpOpen) setHelpOpen(false)
      else if (pendingAnchor) setPendingAnchor(undefined)
    },
    onHelp: () => setHelpOpen((o) => !o),
    onTreeDown: () => setTreeIndex((i) => Math.min(i + 1, Math.max(visibleIds.length - 1, 0))),
    onTreeUp: () => setTreeIndex((i) => Math.max(i - 1, 0)),
    onOpenSelected: () => { if (keyboardId) openTab(keyboardId) },
    onNextTab: () => cycleTab(1),
    onPrevTab: () => cycleTab(-1),
    onCloseTab: () => { if (activeTabId) closeTab(activeTabId) },
    onApprove: () => { if (canApprove && !submittingVerdict) verdict("approved") },
    onComment: () => {
      document.querySelector<HTMLTextAreaElement>(".comments-rail .comment-input")?.focus()
    },
  })

  return (
    <div
      className="layout"
      style={{ "--rail-left": `${railLeft}px`, "--rail-right": `${railRight}px` } as React.CSSProperties}
    >
      {!connected && (
        <div className="conn-lost">Connection lost — reconnecting…</div>
      )}
      <Toaster toasts={toasts} onDismiss={dismiss} />
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
          <h2>Explorer</h2>
          <div className="rail-header-actions">
            <button
              type="button"
              className="help-toggle"
              aria-label="Keyboard shortcuts"
              title="Keyboard shortcuts (?)"
              onClick={() => setHelpOpen(true)}
            >
              ?
            </button>
            <ReadingWidthToggle />
            <ThemeToggle />
          </div>
        </div>
        <ArtifactTree
          artifacts={artifacts}
          focusedSessionID={focusedSessionID}
          isLive={isLive}
          activeId={activeTabId}
          keyboardId={keyboardId}
          collapsed={collapsed}
          unseenIds={unseen}
          onToggle={toggleCollapse}
          onOpen={openTab}
          onUnarchive={unarchive}
          onDelete={remove}
        />
      </aside>
      <main className="main">
        {openArtifacts.length > 0 && (
          <TabBar
            tabs={openArtifacts}
            activeId={activeTabId}
            unseenIds={unseen}
            onActivate={activate}
            onClose={closeTab}
          />
        )}
        {detail ? (
          <div
            className="editor"
            ref={editorRef}
            onScroll={(e) => scrollPos.current.set(scrollKey, e.currentTarget.scrollTop)}
          >
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
                <span>
                  Revision {viewing} of {total} (historical)
                  {newerRevision && " — a newer revision was just published"}
                </span>
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
              canComment={canComment}
              onAnchor={setPendingAnchor}
              onHighlightClick={onHighlightClick}
              flashAnchorId={flashAnchor?.id}
              flashKey={flashAnchor?.key}
            />
          </div>
        ) : activeTabId ? (
          <p className="empty">Loading…</p>
        ) : (
          <div className="empty-cheatsheet">
            <h2>No artifact open</h2>
            <p>Open one from the explorer, or jump to any with the command palette.</p>
            <ShortcutList />
          </div>
        )}
      </main>
      <aside className="rail comments-rail">
        {detail && (
          <>
            {canComment ? (
              <>
                {!pendingAnchor && (
                  <p className="comment-hint">
                    Select text in the document to comment on a specific part, or write a general
                    comment below.
                  </p>
                )}
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
                  orphanedIds={orphanedIds}
                  onAdd={(body) => addComment(body, pendingAnchor)}
                  onEdit={editComment}
                  onDelete={deleteComment}
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
                orphanedIds={orphanedIds}
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
      {paletteOpen && (
        <CommandPalette
          artifacts={artifacts}
          onOpen={openTab}
          onClose={() => setPaletteOpen(false)}
        />
      )}
      {helpOpen && <ShortcutHelp onClose={() => setHelpOpen(false)} />}
    </div>
  )
}
