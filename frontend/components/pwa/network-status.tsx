"use client"

import { useEffect, useState } from "react"

export function NetworkStatus() {
  // Start optimistically "online" so the server-rendered HTML and the client's
  // first render agree (navigator.onLine is client-only and would otherwise
  // diverge → hydration mismatch). The mount effect reconciles to the real
  // status immediately.
  const [isOnline, setIsOnline] = useState(true)

  useEffect(() => {
    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)

    // Reconcile to the actual connectivity state on mount.
    setIsOnline(window.navigator.onLine)

    window.addEventListener("online", handleOnline)
    window.addEventListener("offline", handleOffline)

    return () => {
      window.removeEventListener("online", handleOnline)
      window.removeEventListener("offline", handleOffline)
    }
  }, [])

  if (isOnline) return null

  return (
    <div className="fixed bottom-4 left-1/2 z-[100] -translate-x-1/2 rounded-full bg-amber-500 px-4 py-2 text-xs font-medium text-black shadow-lg">
      Offline mode: using cached pages and data.
    </div>
  )
}
