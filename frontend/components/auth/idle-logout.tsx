"use client"

/**
 * Inactivity auto-logout.
 *
 * After IDLE_TIMEOUT_MS with no user activity (mouse / keyboard / touch /
 * scroll) the session is ended and the user is sent to /login. A warning modal
 * appears in the final WARNING_MS with a live countdown so a user who is still
 * present can stay signed in (and not lose unsaved work). Any activity resets
 * the timer and dismisses the warning.
 *
 * Notes:
 *  - Mounted INSIDE the authenticated dashboard shell, so it only runs for a
 *    signed-in user; it stops cleanly on logout (isAuthenticated → false).
 *  - Cross-tab: activity in one tab is broadcast via localStorage so a second
 *    tab the user is actively working in keeps every tab alive.
 *  - SSR-safe: every window/localStorage access is inside an effect or event
 *    handler — nothing is read during render, so there is no hydration mismatch.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { useAuth } from "@/lib/contexts/auth-context"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { IDLE_TIMEOUT_MS, IDLE_WARNING_MS } from "@/lib/config/timeouts"

/** Window (before the idle logout) in which the warning modal counts down. */
const WARNING_MS = IDLE_WARNING_MS
/** localStorage key used to broadcast activity timestamps across tabs. */
const LAST_ACTIVITY_KEY = "session_last_activity_at"
/** sessionStorage flag the login page reads to explain the redirect. */
const INACTIVITY_FLAG = "inactivity_logout"
/** Don't write to localStorage on every mousemove — at most this often. */
const ACTIVITY_WRITE_THROTTLE_MS = 5000

const ACTIVITY_EVENTS = [
  "mousemove",
  "mousedown",
  "keydown",
  "touchstart",
  "scroll",
  "wheel",
  "click",
] as const

function formatRemaining(ms: number): string {
  const secs = Math.max(0, Math.ceil(ms / 1000))
  const mm = Math.floor(secs / 60)
  const ss = secs % 60
  return `${mm}:${String(ss).padStart(2, "0")}`
}

export function IdleLogout() {
  const { isAuthenticated, logout } = useAuth()
  const [warning, setWarning] = useState(false)
  const [remainingMs, setRemainingMs] = useState(WARNING_MS)

  // Seeded in the mount effect below (avoids calling Date.now() during render).
  const lastActivityRef = useRef(0)
  const lastStorageWriteRef = useRef(0)
  const warningRef = useRef(false)
  const loggingOutRef = useRef(false)

  useEffect(() => {
    warningRef.current = warning
  }, [warning])

  // Record activity: reset the idle clock, dismiss the warning if shown, and
  // (throttled) broadcast to other tabs. Stable — reads only refs.
  const markActivity = useCallback(() => {
    const now = Date.now()
    lastActivityRef.current = now
    if (warningRef.current) setWarning(false)
    if (now - lastStorageWriteRef.current > ACTIVITY_WRITE_THROTTLE_MS) {
      lastStorageWriteRef.current = now
      try {
        localStorage.setItem(LAST_ACTIVITY_KEY, String(now))
      } catch {
        /* private mode / quota — local timer still works */
      }
    }
  }, [])

  const doLogout = useCallback(() => {
    if (loggingOutRef.current) return
    loggingOutRef.current = true
    try {
      sessionStorage.setItem(INACTIVITY_FLAG, "1")
    } catch {
      /* best-effort: the notice is non-essential */
    }
    logout()
  }, [logout])

  useEffect(() => {
    if (!isAuthenticated) return
    // Fresh session: start the clock now and clear any stale logout guard.
    loggingOutRef.current = false
    lastActivityRef.current = Date.now()

    const onActivity = () => markActivity()
    ACTIVITY_EVENTS.forEach((evt) =>
      window.addEventListener(evt, onActivity, { passive: true }),
    )

    // Adopt a newer activity timestamp from another tab so a user actively
    // working elsewhere is not logged out here.
    const onStorage = (e: StorageEvent) => {
      if (e.key !== LAST_ACTIVITY_KEY || !e.newValue) return
      const t = Number(e.newValue)
      if (!Number.isNaN(t) && t > lastActivityRef.current) {
        lastActivityRef.current = t
        if (warningRef.current) setWarning(false)
      }
    }
    window.addEventListener("storage", onStorage)

    const interval = window.setInterval(() => {
      const remaining = IDLE_TIMEOUT_MS - (Date.now() - lastActivityRef.current)
      if (remaining <= 0) {
        doLogout()
        return
      }
      const inWarning = remaining <= WARNING_MS
      setWarning(inWarning) // React bails out when the value is unchanged
      if (inWarning) setRemainingMs(remaining)
    }, 1000)

    return () => {
      ACTIVITY_EVENTS.forEach((evt) => window.removeEventListener(evt, onActivity))
      window.removeEventListener("storage", onStorage)
      window.clearInterval(interval)
    }
  }, [isAuthenticated, markActivity, doLogout])

  if (!isAuthenticated) return null

  return (
    <AlertDialog open={warning}>
      <AlertDialogContent
        // Don't let an outside click / Esc silently dismiss — make the choice explicit.
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>Still there?</AlertDialogTitle>
          <AlertDialogDescription>
            You&apos;ve been inactive for a while. For security you&apos;ll be signed out in{" "}
            <span className="font-semibold tabular-nums text-foreground">
              {formatRemaining(remainingMs)}
            </span>
            .
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={doLogout}>Log out now</AlertDialogCancel>
          <AlertDialogAction onClick={markActivity}>Stay signed in</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
