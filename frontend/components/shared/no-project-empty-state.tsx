"use client"

import type { ReactNode } from "react"
import { FolderOpen } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * Shared empty state for "no project context" situations (readiness risk R7).
 *
 * Reusable across assignment/data-entry screens so the guidance is consistent:
 *   • no project selected            -> "No active project selected"
 *   • no indicators for an org       -> override title/description
 *   • targets without a project      -> "Select a project before setting targets"
 */
export function NoProjectEmptyState({
  title = "No active project selected",
  description = "Select a project to continue — your organizations, indicators, and targets are organized by project.",
  className,
  action,
}: {
  title?: string
  description?: string
  className?: string
  action?: ReactNode
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border/70 bg-muted/30 px-6 py-10 text-center",
        className,
      )}
    >
      <FolderOpen className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
      <div className="space-y-1">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="mx-auto max-w-md text-sm text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  )
}
