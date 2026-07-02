"use client";

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { TrendingDown, TrendingUp } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Shared enterprise-dashboard primitives used across both the Analysis
 * dashboards surface and the home/executive board. Presentation only — these
 * wrap existing data/behaviour, they do not fetch or transform anything.
 */

/* ------------------------------------------------------------------ */
/* Section header                                                      */
/* ------------------------------------------------------------------ */

export function DashboardSectionHeader(props: {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  const { title, description, action, className } = props;
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-3", className)}>
      <div className="min-w-0 space-y-1">
        <h2 className="truncate text-xl font-semibold tracking-[-0.02em] text-foreground sm:text-2xl">
          {title}
        </h2>
        {description ? (
          <p className="line-clamp-1 text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sticky global filter bar wrapper                                    */
/* ------------------------------------------------------------------ */

export function StickyFilterBar(props: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "sticky top-[var(--app-header-height)] z-20 -mx-1 px-1 py-2",
        "bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70",
        props.className,
      )}
    >
      {props.children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Responsive dashboard grid                                           */
/* ------------------------------------------------------------------ */

export function DashboardGrid(props: {
  children: ReactNode;
  /** Max columns at the widest breakpoint. Defaults to 3. */
  columns?: 2 | 3 | 4;
  className?: string;
}) {
  const { children, columns = 3, className } = props;
  const colClass =
    columns === 4
      ? "grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"
      : columns === 2
        ? "grid-cols-1 lg:grid-cols-2"
        : "grid-cols-1 md:grid-cols-2 xl:grid-cols-3";
  return <div className={cn("grid gap-4", colClass, className)}>{children}</div>;
}

/* ------------------------------------------------------------------ */
/* Executive KPI stat card                                             */
/* ------------------------------------------------------------------ */

export type KpiStat = {
  key: string;
  label: string;
  value: string;
  helper?: string;
  icon?: LucideIcon;
  /** Signed percentage change vs previous period; omit when unknown. */
  trend?: number | null;
  /** Small series for a sparkline; omit when unavailable. */
  sparkline?: number[] | null;
  accent?: string;
};

function Sparkline({ points, color }: { points: number[]; color: string }) {
  if (!points || points.length < 2) return null;
  const w = 72;
  const h = 24;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const step = w / (points.length - 1);
  const d = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${(h - ((p - min) / span) * h).toFixed(1)}`)
    .join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="overflow-visible" aria-hidden="true">
      <path d={d} fill="none" stroke={color} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function KpiStatCard(props: { stat: KpiStat; className?: string }) {
  const { stat, className } = props;
  const Icon = stat.icon;
  const accent = stat.accent ?? "#0f766e";
  const trendUp = (stat.trend ?? 0) >= 0;

  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-2xl border border-border/60 bg-card p-4 shadow-sm transition-shadow hover:shadow-md",
        className,
      )}
    >
      <span className="absolute inset-x-0 top-0 h-1" style={{ backgroundColor: accent }} />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="truncate text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            {stat.label}
          </div>
          <div className="text-[28px] font-semibold leading-none tracking-[-0.03em] text-foreground tabular-nums">
            {stat.value}
          </div>
        </div>
        {Icon ? (
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
            style={{ backgroundColor: `${accent}14`, color: accent }}
          >
            <Icon className="h-[18px] w-[18px]" />
          </span>
        ) : null}
      </div>
      <div className="mt-3 flex items-end justify-between gap-2">
        <div className="min-w-0 space-y-1">
          {stat.helper ? (
            <div className="line-clamp-1 text-xs text-muted-foreground">{stat.helper}</div>
          ) : null}
          {typeof stat.trend === "number" ? (
            <div
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-semibold",
                trendUp ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700",
              )}
            >
              {trendUp ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
              {Math.abs(stat.trend).toFixed(1)}%
            </div>
          ) : null}
        </div>
        {stat.sparkline && stat.sparkline.length > 1 ? (
          <Sparkline points={stat.sparkline} color={accent} />
        ) : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Card footer metadata row                                            */
/* ------------------------------------------------------------------ */

export function CardFooterMeta(props: {
  items: Array<{ label: string; value?: string | null }>;
  className?: string;
}) {
  const items = props.items.filter((item) => item.value);
  if (items.length === 0) return null;
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border/50 px-4 py-2.5 text-[11px] text-muted-foreground",
        props.className,
      )}
    >
      {items.map((item) => (
        <span key={item.label} className="inline-flex min-w-0 items-center gap-1">
          <span className="font-medium uppercase tracking-[0.14em] text-muted-foreground/70">{item.label}</span>
          <span className="truncate text-foreground/80">{item.value}</span>
        </span>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Loading skeletons                                                   */
/* ------------------------------------------------------------------ */

export function KpiSkeleton() {
  return (
    <div className="rounded-2xl border border-border/60 bg-card p-4 shadow-sm">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="mt-3 h-8 w-20" />
      <Skeleton className="mt-3 h-3 w-32" />
    </div>
  );
}

export function ChartCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-2xl border border-border/60 bg-card shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-border/50 px-4 py-3.5">
        <div className="space-y-2">
          <Skeleton className="h-4 w-44" />
          <Skeleton className="h-3 w-28" />
        </div>
        <Skeleton className="h-8 w-8 rounded-md" />
      </div>
      <div className="space-y-3 p-4">
        <div className="flex gap-2">
          <Skeleton className="h-9 w-24 rounded-full" />
          <Skeleton className="h-9 w-24 rounded-full" />
          <Skeleton className="h-9 w-24 rounded-full" />
        </div>
        <Skeleton className="h-[228px] w-full rounded-xl" />
      </div>
    </div>
  );
}

export function DashboardGridSkeleton(props: { count?: number; columns?: 2 | 3 | 4 }) {
  const { count = 3, columns = 3 } = props;
  return (
    <DashboardGrid columns={columns}>
      {Array.from({ length: count }).map((_, index) => (
        <ChartCardSkeleton key={index} />
      ))}
    </DashboardGrid>
  );
}
