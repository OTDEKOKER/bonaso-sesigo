"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import {
  ClipboardCheck,
  CalendarClock,
  Flag as FlagIcon,
  ArrowRight,
  type LucideIcon,
} from "lucide-react"

import { api } from "@/lib/api"
import { isTrainingMode, isSharedLiveRoute } from "@/lib/training-mode"
import { cn } from "@/lib/utils"

type Severity = "info" | "warning" | "critical"

interface HomeAction {
  key: string
  count: number
  severity: Severity
  context?: {
    quarter?: number
    fiscal_year?: number
    closes_in_days?: number
    closes_on?: string
  }
}

interface HomeActionsResponse {
  actions: HomeAction[]
  project: { id: number; code: string; name: string } | null
}

/** Respect Sesigo Training Mode for deep links (mirrors the sidebar). */
function trainingHref(path: string): string {
  if (typeof window === "undefined" || !isTrainingMode()) return path
  const [p] = path.split("?")
  if (isSharedLiveRoute(p)) return path
  return `/training${path}`
}

function cardFor(action: HomeAction): { label: string; sublabel: string; href: string; icon: LucideIcon } | null {
  const n = action.count
  switch (action.key) {
    case "reviews":
      return {
        icon: ClipboardCheck,
        label: `${n} aggregate${n === 1 ? "" : "s"} to review`,
        sublabel: "Awaiting your review or approval",
        href: trainingHref("/aggregates?status=pending"),
      }
    case "flags":
      return {
        icon: FlagIcon,
        label: `${n} flag${n === 1 ? "" : "s"} to resolve`,
        sublabel: "Open data-quality and follow-up flags",
        href: trainingHref("/flags?status=open"),
      }
    case "reporting_window": {
      const days = action.context?.closes_in_days ?? 0
      const quarter = action.context?.quarter
      const when = days <= 0 ? "closes today" : days === 1 ? "closes in 1 day" : `closes in ${days} days`
      return {
        icon: CalendarClock,
        label: quarter ? `Q${quarter} reporting ${when}` : `Reporting ${when}`,
        sublabel: "Submit before the window closes",
        href: trainingHref("/reporting-periods"),
      }
    }
    default:
      return null
  }
}

const severityCard: Record<Severity, string> = {
  info: "border-sky-500/30 bg-sky-500/5 hover:bg-sky-500/10",
  warning: "border-amber-500/40 bg-amber-500/5 hover:bg-amber-500/10",
  critical: "border-rose-500/40 bg-rose-500/5 hover:bg-rose-500/10",
}
const severityIcon: Record<Severity, string> = {
  info: "text-sky-600",
  warning: "text-amber-600",
  critical: "text-rose-600",
}

/**
 * "What needs you" — a task-oriented action strip at the top of the home page.
 * Additive and read-only: it fetches role-scoped counts from
 * /api/analysis/home-actions/ and deep-links into the existing filtered pages.
 * Renders nothing while loading, on error, or when there is nothing to act on,
 * so it can never clutter the home or break it if the source is unavailable.
 */
export function HomeActionStrip() {
  const [actions, setActions] = useState<HomeAction[] | null>(null)

  useEffect(() => {
    let cancelled = false
    api
      .get<HomeActionsResponse>("/analysis/home-actions/")
      .then((res) => {
        if (!cancelled) setActions(res.data?.actions ?? [])
      })
      .catch(() => {
        if (!cancelled) setActions([]) // never break the home on a failed fetch
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (!actions || actions.length === 0) return null

  return (
    <section aria-label="What needs you" className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        What needs you
      </h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {actions.map((action) => {
          const card = cardFor(action)
          if (!card) return null
          const Icon = card.icon
          return (
            <Link
              key={action.key}
              href={card.href}
              className={cn(
                "group flex items-center gap-3 rounded-xl border p-4 transition-colors",
                severityCard[action.severity] ?? severityCard.info,
              )}
            >
              <Icon
                className={cn("h-6 w-6 shrink-0", severityIcon[action.severity] ?? severityIcon.info)}
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-foreground">{card.label}</div>
                <div className="truncate text-xs text-muted-foreground">{card.sublabel}</div>
              </div>
              <ArrowRight
                className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                aria-hidden="true"
              />
            </Link>
          )
        })}
      </div>
    </section>
  )
}
