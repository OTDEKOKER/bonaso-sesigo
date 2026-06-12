"use client"

import type { ReactNode } from "react"
import {
  AlertTriangle,
  Inbox,
  Loader2,
  Lock,
  FolderOpen,
  SearchX,
  type LucideIcon,
} from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * Standardised UX states — one consistent "family" so loading / empty / error /
 * no-access / no-project / no-data look the same across every module instead of
 * each page rolling its own. All share the same centered, dashed-border card.
 *
 * Use these instead of bespoke markup:
 *   <LoadingState />            while fetching
 *   <EmptyState />              nothing created yet
 *   <NoDataState />             filters returned nothing
 *   <ErrorState onRetry={…} />  request failed
 *   <NoAccessState />           403 / not permitted
 *   <NoProjectState />          no project in scope (see NoProjectEmptyState)
 */

export type UxStateProps = {
  title?: string
  description?: string
  icon?: LucideIcon
  action?: ReactNode
  className?: string
}

function StateShell({
  icon: Icon,
  title,
  description,
  action,
  className,
  spin = false,
  tone = "muted",
}: UxStateProps & { spin?: boolean; tone?: "muted" | "danger" }) {
  return (
    <div
      role="status"
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-6 py-10 text-center",
        tone === "danger"
          ? "border-destructive/40 bg-destructive/5"
          : "border-border/70 bg-muted/30",
        className,
      )}
    >
      {Icon ? (
        <Icon
          className={cn(
            "h-8 w-8",
            tone === "danger" ? "text-destructive" : "text-muted-foreground",
            spin && "animate-spin",
          )}
          aria-hidden="true"
        />
      ) : null}
      <div className="space-y-1">
        {title ? <p className="text-sm font-semibold text-foreground">{title}</p> : null}
        {description ? (
          <p className="mx-auto max-w-md text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  )
}

export function LoadingState({
  title = "Loading…",
  description = "Fetching the latest data.",
  ...props
}: UxStateProps) {
  return <StateShell icon={Loader2} spin title={title} description={description} {...props} />
}

export function EmptyState({
  title = "Nothing here yet",
  description = "Create your first record to get started.",
  icon = Inbox,
  ...props
}: UxStateProps) {
  return <StateShell icon={icon} title={title} description={description} {...props} />
}

export function NoDataState({
  title = "No results",
  description = "No data matches the current filters. Try widening or clearing them.",
  icon = SearchX,
  ...props
}: UxStateProps) {
  return <StateShell icon={icon} title={title} description={description} {...props} />
}

export function ErrorState({
  title = "Something went wrong",
  description = "We couldn't load this. Please try again.",
  icon = AlertTriangle,
  onRetry,
  ...props
}: UxStateProps & { onRetry?: () => void }) {
  return (
    <StateShell
      icon={icon}
      tone="danger"
      title={title}
      description={description}
      action={
        props.action ??
        (onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted"
          >
            Try again
          </button>
        ) : undefined)
      }
      className={props.className}
    />
  )
}

export function NoAccessState({
  title = "You don't have access",
  description = "Your account isn't permitted to view this module. Contact an administrator if you think this is a mistake.",
  icon = Lock,
  ...props
}: UxStateProps) {
  return <StateShell icon={icon} title={title} description={description} {...props} />
}

export function NoProjectState({
  title = "No active project selected",
  description = "Select a project to continue — organizations, indicators, and targets are organized by project.",
  icon = FolderOpen,
  ...props
}: UxStateProps) {
  return <StateShell icon={icon} title={title} description={description} {...props} />
}
