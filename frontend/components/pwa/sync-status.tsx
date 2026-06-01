"use client"

import { useCallback, useEffect, useState } from "react"
import {
  clearQueuedMutations,
  clearSyncHistory,
  getQueuedMutationCount,
  listSyncHistory,
  processQueuedMutations,
  type SyncHistoryEntry,
} from "@/lib/offline/mutation-queue"

type SyncStateEvent = CustomEvent<{
  pending?: number
  processed?: number
  historyUpdated?: boolean
}>

const STATUS_STYLES: Record<string, string> = {
  queued: "bg-blue-100 text-blue-800",
  synced: "bg-green-100 text-green-800",
  failed: "bg-red-100 text-red-800",
  blocked: "bg-amber-100 text-amber-800",
  dropped: "bg-amber-100 text-amber-800",
}

function formatTimestamp(timestamp: number): string {
  try {
    return new Date(timestamp).toLocaleString()
  } catch {
    return String(timestamp)
  }
}

function compactPath(url: string): string {
  try {
    const parsed = new URL(url, window.location.origin)
    return parsed.pathname
  } catch {
    return url
  }
}

export function SyncStatus() {
  const [pendingCount, setPendingCount] = useState(0)
  const [isSyncing, setIsSyncing] = useState(false)
  const [isOnline, setIsOnline] = useState(true)
  const [history, setHistory] = useState<SyncHistoryEntry[]>([])
  const [isHistoryOpen, setIsHistoryOpen] = useState(false)

  const refreshPendingCount = useCallback(async () => {
    const count = await getQueuedMutationCount()
    setPendingCount(count)
  }, [])

  const refreshHistory = useCallback(async () => {
    const entries = await listSyncHistory(20)
    setHistory(entries)
  }, [])

  useEffect(() => {
    setIsOnline(window.navigator.onLine)
    void refreshPendingCount()
    void refreshHistory()

    const handleSyncState = (event: Event) => {
      const detail = (event as SyncStateEvent).detail
      if (typeof detail?.pending === "number") {
        setPendingCount(detail.pending)
      } else {
        void refreshPendingCount()
      }
      if (detail?.historyUpdated) {
        void refreshHistory()
      }
    }
    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)

    window.addEventListener("bonaso:sync-state", handleSyncState as EventListener)
    window.addEventListener("online", handleOnline)
    window.addEventListener("offline", handleOffline)

    return () => {
      window.removeEventListener("bonaso:sync-state", handleSyncState as EventListener)
      window.removeEventListener("online", handleOnline)
      window.removeEventListener("offline", handleOffline)
    }
  }, [refreshPendingCount, refreshHistory])

  const runSyncNow = async () => {
    setIsSyncing(true)
    try {
      await processQueuedMutations()
      await Promise.all([refreshPendingCount(), refreshHistory()])
    } finally {
      setIsSyncing(false)
    }
  }

  const clearHistory = async () => {
    await clearSyncHistory()
    await refreshHistory()
  }

  const clearQueued = async () => {
    await clearQueuedMutations()
    await refreshPendingCount()
  }

  const hasHistory = history.length > 0
  if (pendingCount <= 0 && !hasHistory) return null

  return (
    <div className="fixed right-4 top-4 z-[100] flex flex-col gap-2">
      <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs text-card-foreground shadow-md">
        <span>{pendingCount} pending sync</span>
        <button
          className="rounded bg-primary px-2 py-1 text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
          onClick={runSyncNow}
          disabled={!isOnline || isSyncing || pendingCount <= 0}
        >
          {isSyncing ? "Syncing..." : "Sync now"}
        </button>
        <button
          className="rounded border border-border px-2 py-1 text-card-foreground disabled:cursor-not-allowed disabled:opacity-50"
          onClick={clearQueued}
          disabled={pendingCount <= 0 || isSyncing}
        >
          Clear queued
        </button>
        <button
          className="rounded border border-border px-2 py-1 text-card-foreground"
          onClick={() => setIsHistoryOpen((value) => !value)}
        >
          {isHistoryOpen ? "Hide logs" : "View logs"}
        </button>
      </div>

      {isHistoryOpen && (
        <div className="max-h-80 w-[28rem] overflow-auto rounded-lg border border-border bg-card p-3 text-xs text-card-foreground shadow-md">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-medium">Sync history</span>
            <button className="rounded border border-border px-2 py-1" onClick={clearHistory}>
              Clear
            </button>
          </div>

          {history.length === 0 ? (
            <p className="text-muted-foreground">No sync events yet.</p>
          ) : (
            <div className="space-y-2">
              {history.map((entry) => (
                <div key={`${entry.id}-${entry.createdAt}`} className="rounded border border-border p-2">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="font-medium">
                      {entry.method} {compactPath(entry.url)}
                    </span>
                    <span
                      className={`rounded px-2 py-0.5 text-[10px] font-medium ${
                        STATUS_STYLES[entry.status] || "bg-gray-100 text-gray-800"
                      }`}
                    >
                      {entry.status}
                    </span>
                  </div>
                  <div className="text-muted-foreground">
                    {formatTimestamp(entry.createdAt)}
                    {typeof entry.httpStatus === "number" ? ` | HTTP ${entry.httpStatus}` : ""}
                  </div>
                  {entry.message ? <div className="mt-1 text-muted-foreground">{entry.message}</div> : null}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
