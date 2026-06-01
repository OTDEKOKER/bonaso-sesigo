"use client"

import { useEffect, useState } from "react"

export function NetworkStatus() {
  const [isOnline, setIsOnline] = useState(() => {
    if (typeof window === "undefined") return true
    return window.navigator.onLine
  })

  useEffect(() => {
    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)

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
