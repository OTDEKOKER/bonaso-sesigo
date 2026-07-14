"use client";

import * as React from "react";
import { Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Standardised, overflow-safe filter bar for list pages.
 *
 * Every list screen previously hand-rolled its own filter grid, which is why
 * filter controls (esp. long <Select> values) kept overflowing or overlapping
 * adjacent fields. This primitive bakes in the safe layout once:
 *   - a responsive grid that collapses to a single column on small screens
 *   - `[&>*]:min-w-0` so no child can force its column to grow past the row
 *   - a consistent header (icon + label + optional "Clear filters")
 *
 * Usage:
 *   <FilterBar showClear={hasActiveFilters} onClear={clearFilters}>
 *     <FilterField><Input .../></FilterField>
 *     <FilterField label="Status"><Select .../></FilterField>
 *   </FilterBar>
 */
export function FilterBar({
  title = "Filters",
  showClear = false,
  onClear,
  className,
  gridClassName,
  children,
}: {
  title?: React.ReactNode;
  showClear?: boolean;
  onClear?: () => void;
  className?: string;
  /** Override the responsive column template if a page needs a different count. */
  gridClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("min-w-0 space-y-3", className)}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 text-muted-foreground">
          <Filter className="h-4 w-4 shrink-0" />
          <span className="truncate text-sm font-medium">{title}</span>
        </div>
        {showClear && onClear ? (
          <Button variant="ghost" size="sm" className="shrink-0" onClick={onClear}>
            Clear filters
          </Button>
        ) : null}
      </div>
      <div
        className={cn(
          "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 [&>*]:min-w-0",
          gridClassName,
        )}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * A single labelled filter control. `min-w-0` here (plus the parent's
 * `[&>*]:min-w-0`) is what lets long select values / inputs truncate instead of
 * pushing into the next column.
 */
export function FilterField({
  label,
  htmlFor,
  className,
  children,
}: {
  label?: React.ReactNode;
  htmlFor?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("min-w-0 space-y-1.5", className)}>
      {label ? (
        <label
          htmlFor={htmlFor}
          className="block text-xs font-medium text-muted-foreground"
        >
          {label}
        </label>
      ) : null}
      {children}
    </div>
  );
}
