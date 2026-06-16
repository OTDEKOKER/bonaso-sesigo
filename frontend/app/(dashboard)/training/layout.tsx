"use client"

import { useEffect } from "react"
import { usePathname, useRouter } from "next/navigation"
import { SessionModeProvider } from "@/lib/contexts/session-mode-context"
import { isTrainingMode } from "@/lib/training-mode"

/**
 * Guard: the /training/* pages may only be opened in a Training session.
 *
 * Training vs Live is bound to the session (the JWT `mode` claim set at login,
 * mirrored by the `sesigo_mode` marker). Without this guard a Live session could
 * navigate to /training/* by URL and see the training banner over LIVE data
 * (the backend keys off the token, not the URL). If the session isn't Training,
 * send the user to the Live equivalent of the page instead. The backend remains
 * the security authority — this only prevents the confusing mixed UI.
 */
export default function TrainingLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const training = typeof window !== "undefined" ? isTrainingMode() : true

  useEffect(() => {
    if (!isTrainingMode()) {
      const live = (pathname || "").replace(/^\/training/, "") || "/dashboard"
      router.replace(live || "/dashboard")
    }
  }, [pathname, router])

  // Avoid flashing the training chrome over live data while redirecting.
  if (!training) return null

  return <SessionModeProvider forceTraining>{children}</SessionModeProvider>
}
