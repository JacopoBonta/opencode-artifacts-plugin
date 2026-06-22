import React, { useEffect, useState, useCallback } from "react"
import "./App.css"
import * as api from "./api"
import type { Anchor, Artifact, ArtifactDetail } from "./api"
import { ArtifactList } from "./components/ArtifactList"
import { ArtifactView } from "./components/ArtifactView"
import { CommentThread } from "./components/CommentThread"
import { ActionBar } from "./components/ActionBar"

export function App() {
  const [artifacts, setArtifacts] = useState<Artifact[]>([])
  const [selectedId, setSelectedId] = useState<string>()
  const [detail, setDetail] = useState<ArtifactDetail>()
  const [pendingAnchor, setPendingAnchor] = useState<Anchor>()

  const refreshList = useCallback(async () => setArtifacts(await api.listArtifacts()), [])
  const refreshDetail = useCallback(async (id: string) => setDetail(await api.getArtifact(id)), [])

  const select = useCallback((id: string) => {
    setSelectedId(id)
    setPendingAnchor(undefined)
    refreshDetail(id)
  }, [refreshDetail])

  useEffect(() => { refreshList() }, [refreshList])

  useEffect(() => {
    return api.subscribeEvents((e) => {
      if (e.type === "ping") return
      refreshList()
      if (selectedId && e.id === selectedId) refreshDetail(selectedId)
    })
  }, [selectedId, refreshList, refreshDetail])

  // Auto-select the first artifact once the list loads and nothing is selected.
  useEffect(() => {
    if (!selectedId && artifacts.length) select(artifacts[0].id)
  }, [artifacts, selectedId, select])

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

  return (
    <div className="layout">
      <aside className="rail">
        <h2>Artifacts</h2>
        <ArtifactList artifacts={artifacts} selectedId={selectedId} onSelect={select} />
      </aside>
      <main className="main">
        {detail ? (
          <>
            <header className="main-header">
              <h1>{detail.artifact.title}</h1>
              <span className={`status status-${detail.artifact.status}`}>
                {detail.artifact.status.replace(/_/g, " ")}
              </span>
            </header>
            <ArtifactView
              content={detail.content}
              comments={detail.comments}
              onAnchor={setPendingAnchor}
            />
          </>
        ) : (
          <p className="empty">Select an artifact.</p>
        )}
      </main>
      <aside className="rail comments-rail">
        {detail && (
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
        )}
      </aside>
    </div>
  )
}
