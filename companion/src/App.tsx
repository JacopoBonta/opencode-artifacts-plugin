import React, { useEffect, useState, useCallback } from "react"
import "./App.css"
import * as api from "./api"
import type { Anchor, Artifact, ArtifactDetail } from "./api"
import { ArtifactList } from "./components/ArtifactList"
import { ArtifactView } from "./components/ArtifactView"
import { CommentThread } from "./components/CommentThread"
import { ActionBar } from "./components/ActionBar"
import { RevisionSwitcher } from "./components/RevisionSwitcher"

export function App() {
  const [artifacts, setArtifacts] = useState<Artifact[]>([])
  const [selectedId, setSelectedId] = useState<string>()
  const [detail, setDetail] = useState<ArtifactDetail>()
  const [pendingAnchor, setPendingAnchor] = useState<Anchor>()
  const [connected, setConnected] = useState(true)
  // undefined = viewing the latest revision
  const [viewedRevision, setViewedRevision] = useState<number>()
  const [historicalContent, setHistoricalContent] = useState<string>()

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

  async function verdict(status: "approved" | "changes_requested" | "refine") {
    if (!detail) return
    await api.postVerdict(detail.artifact.id, status)
    refreshDetail(detail.artifact.id)
  }

  const total = detail?.artifact.currentRevision ?? 0
  const viewing = viewedRevision ?? total
  const isLatest = viewing === total
  const revisionComments = detail
    ? (isLatest ? detail.comments : detail.comments.filter((c) => c.revision === viewing))
    : []

  return (
    <div className="layout">
      {!connected && (
        <div className="conn-lost">Connection lost — reconnecting…</div>
      )}
      <aside className="rail">
        <h2>Artifacts</h2>
        <ArtifactList artifacts={artifacts} selectedId={selectedId} onSelect={select} />
      </aside>
      <main className="main">
        {detail ? (
          <>
            <header className="main-header">
              <h1>{detail.artifact.title}</h1>
              <div className="main-header-right">
                <RevisionSwitcher total={total} viewing={viewing} onSelect={pickRevision} />
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
            <ArtifactView
              content={isLatest ? detail.content : historicalContent ?? ""}
              comments={revisionComments}
              highlightResolved={!isLatest}
              onAnchor={isLatest ? setPendingAnchor : () => {}}
            />
          </>
        ) : (
          <p className="empty">Select an artifact.</p>
        )}
      </main>
      <aside className="rail comments-rail">
        {detail && (
          <>
            {isLatest ? (
              <>
                {pendingAnchor && (
                  <div className="pending-anchor">
                    Commenting on: <blockquote>{pendingAnchor.quote}</blockquote>
                  </div>
                )}
                <CommentThread
                  title="Comments"
                  comments={detail.comments}
                  onAdd={(body) => addComment(body, pendingAnchor)}
                />
                <ActionBar
                  type={detail.artifact.type}
                  onApprove={() => verdict("approved")}
                  onRequestChanges={() => verdict("changes_requested")}
                  onRefine={() => verdict("refine")}
                />
              </>
            ) : (
              <CommentThread
                title={`Comments · revision ${viewing}`}
                comments={revisionComments}
                onAdd={() => {}}
                readOnly
              />
            )}
          </>
        )}
      </aside>
    </div>
  )
}
