"use client"

import { useEffect } from "react"

import { ErrorState } from "@/components/shared/ux-states"
import { Button } from "@/components/ui/button"

/**
 * Route-group error boundary for every page under (dashboard). Next.js renders
 * this in place of the crashed page's content while the surrounding layout
 * (sidebar + header) stays mounted, so a single page throwing no longer blanks
 * the whole shell or drops the user on Next's default error overlay.
 *
 * `reset()` re-renders the segment (recovers from a transient failure); the
 * Reload fallback recovers from a wedged client state when a retry keeps
 * throwing. Errors raised in the layout itself bubble past this boundary — the
 * layout handles its own auth/access failures separately.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Surface the crash (and its digest) so it is diagnosable in the console /
    // any attached logger instead of being silently swallowed by the boundary.
    console.error("Dashboard route error:", error)
  }, [error])

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <ErrorState
        title="This page hit an error"
        description="Something went wrong while rendering this page. Try again, or reload if it keeps happening."
        action={
          <div className="flex items-center justify-center gap-2">
            <Button onClick={() => reset()}>Try again</Button>
            <Button variant="outline" onClick={() => window.location.reload()}>
              Reload page
            </Button>
          </div>
        }
      />
    </div>
  )
}
