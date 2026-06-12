"use client"

import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

/**
 * Sticky filter framework. Wraps a module's filter controls so they stay pinned
 * directly beneath the frozen app header while the content scrolls.
 *
 * The offset is the shared --app-header-height CSS variable (defined in
 * globals.css and used by AppHeader), so the bar always sits flush under the
 * header with no overlap or content clipping — regardless of header height
 * changes. z-20 keeps it above page content but below the header (z-30) and the
 * mobile sidebar drawer (z-50).
 *
 * Usage:
 *   <StickyFilterBar>
 *     <MyFilters … />
 *   </StickyFilterBar>
 */
export function StickyFilterBar({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "sticky z-20 -mx-4 border-b border-border bg-background/95 px-4 py-3 backdrop-blur",
        "supports-[backdrop-filter]:bg-background/75 lg:-mx-6 lg:px-6",
        className,
      )}
      style={{ top: "var(--app-header-height)" }}
    >
      {children}
    </div>
  )
}
