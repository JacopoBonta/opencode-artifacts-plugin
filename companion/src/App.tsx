import React, { useEffect, useState, useCallback, useRef } from "react"
import "./App.css"
import * as api from "./api"
import type { Anchor, Artifact, ArtifactDetail } from "./api"
import { ArtifactList } from "./components/ArtifactList"
import { ArtifactView } from "./components/ArtifactView"
import { CommentThread } from "./components/CommentThread"
import { ActionBar } from "./components/ActionBar"
import { RevisionSwitcher } from "./components/RevisionSwitcher"
import { ThemeToggle } from "./components/ThemeToggle"
import { ReadingWidthToggle } from "./components/ReadingWidthToggle"
import { ResizeHandle } from "./components/ResizeHandle"
import {
  getRailLeft, getRailRight, setRailLeft, setRailRight, clampLeft, clampRight,
} from "./layoutPrefs"

export function App() {
  const [railLeft, setRailLeftW] = useState(getRailLeft)
  const [railRight, setRailRightW] = useState(getRailRight)
  const [artifacts, setArtifacts] = useState<Artifact[]>([])
  const [selectedId, setSelectedId] = useState<string>()
  const [detail, setDetail] = useState<ArtifactDetail>()
  const [pendingAnchor, setPendingAnchor] = useState<Anchor>()
  const [connected, setConnected] = useState(true)
  const [submittingVerdict, setSubmittingVerdict] = useState(false)
  // undefined = viewing the latest revision
  const [viewedRevision, setViewedRevision] = useState<number>()
  const [historicalContent, setHistoricalContent] = useState<string>()
  const flashSeq = useRef(0)
  const [flashComment, setFlashComment] = useState<{ id: string; key: number }>()
  const [flashAnchor, setFlashAnchor] = useState<{ id: string; key: number }>()
  const onHighlightClick = useCallback((id: string) => setFlashComment({ id, key: ++flashSeq.current }), [])
  const onCommentClick = useCallback((id: string) => setFlashAnchor({ id, key: ++flashSeq.current }), [])

  const refreshList = useCallback(async () => setArtifacts(await api.listArtifacts()), [])
  const refreshDetail = useCallback(async (id: string) => setDetail(await api.getArtifact(id)), [])

  const select = useCallback((id: string) => {
    setSelectedId(id)
    setPendingAnchor(undefined)
    setViewedRevision(undefined)
    setHistoricalContent(undefined)
    refreshDetail(id)
  }, [refreshDetail])

  useEffect(() => { refreshList() }, [refreshList])

  useEffect(() => {
    return api.subscribeEvents(
      (e) => {
        setConnected(true)
        if (e.type === "ping") return
        refreshList()
        if (selectedId && e.id === selectedId) {
          // A new revision may have arrived — return to the latest view.
          setViewedRevision(undefined)
          setHistoricalContent(undefined)
          refreshDetail(selectedId)
        }
      },
      () => setConnected(false),
    )
  }, [selectedId, refreshList, refreshDetail])

  // Auto-select the first artifact once the list loads and nothing is selected.
  useEffect(() => {
    if (!selectedId && artifacts.length) select(artifacts[0].id)
  }, [artifacts, selectedId, select])

  const pickRevision = useCallback(async (n: number) => {
    if (!detail) return
    if (n >= detail.artifact.currentRevision) {
      setViewedRevision(undefined)
      setHistoricalContent(undefined)
      return
    }
    setViewedRevision(n)
    const { content } = await api.getRevision(detail.artifact.id, n)
    setHistoricalContent(content)
  }, [detail])

  async function addComment(body: string, anchor?: Anchor) {
    if (!detail) return
    await api.postComment(detail.artifact.id, {
      revision: detail.artifact.currentRevision,
      kind: anchor ? "anchor" : "general",
      anchor,
      body,
    })
    setPendingAnchor(undefined)
    refreshDetail(detail.artifact.id)
  }

  async function verdict(status: "approved" | "changes_requested") {
    if (!detail) return
    setSubmittingVerdict(true)
    try {
      await api.postVerdict(detail.artifact.id, status)
      await refreshDetail(detail.artifact.id)
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
    isLatest && detail?.artifact.type === "plan" && detail?.artifact.status !== "approved"
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
          <ThemeToggle />
        </div>
        <ArtifactList artifacts={artifacts} selectedId={selectedId} onSelect={select} />
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
                <span className={`status status-${detail.artifact.status}`}>
                  {detail.artifact.status.replace(/_/g, " ")}
                </span>
                <ReadingWidthToggle />
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
