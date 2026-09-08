/**
 * Cold-start / navigation fallback for the (dashboard) content area. Shown as
 * the Suspense fallback while a route segment loads, with the layout's sidebar
 * and header already mounted around it — so navigation shows a page-shaped
 * skeleton instead of the previous blank (this file used to return null).
 *
 * A Server Component (no "use client"): it renders instantly with no JS and no
 * data, purely as a visual placeholder.
 */
export default function Loading() {
  return (
    <div className="space-y-6" role="status" aria-busy="true" aria-label="Loading page">
      {/* Page heading */}
      <div className="space-y-2">
        <div className="h-7 w-56 animate-pulse rounded-md bg-muted" />
        <div className="h-4 w-80 max-w-full animate-pulse rounded bg-muted/70" />
      </div>

      {/* KPI / summary cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={index}
            className="h-28 animate-pulse rounded-xl border border-border/60 bg-muted/40"
          />
        ))}
      </div>

      {/* Main content block */}
      <div className="h-72 animate-pulse rounded-xl border border-border/60 bg-muted/30" />

      <span className="sr-only">Loading…</span>
    </div>
  )
}
