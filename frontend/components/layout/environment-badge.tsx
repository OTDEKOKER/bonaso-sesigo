"use client"

import { useSessionMode } from "@/lib/contexts/session-mode-context"
import { cn } from "@/lib/utils"

/**
 * Always-on environment indicator (Sesigo readiness — Phase 4 / risk R5).
 *
 * The app already shows a prominent amber bar while in Training Mode, but Live
 * mode showed nothing — so a user had no positive confirmation they were on the
 * real system. This compact badge is rendered in the header on every page and in
 * BOTH modes, so the current environment can never be mistaken:
 *   • Live     → green  "LIVE SYSTEM"
 *   • Training → amber  "TRAINING"
 *
 * The mode comes from SessionModeContext (the signed-JWT-backed training marker),
 * not from anything user-tamperable.
 */
export function EnvironmentBadge({ className }: { className?: string }) {
  const { isTrainingMode } = useSessionMode()
  const label = isTrainingMode ? "TRAINING" : "LIVE SYSTEM"
  const description = isTrainingMode
    ? "Sesigo Training Mode — demo data only, not for official reporting"
    : "Sesigo Live System — real production data"

  return (
    <span
      role="status"
      aria-label={description}
      title={description}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide",
        isTrainingMode ? "bg-amber-400 text-amber-950" : "bg-emerald-600 text-white",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          isTrainingMode ? "bg-amber-900" : "bg-emerald-200",
        )}
      />
      {label}
    </span>
  )
}
