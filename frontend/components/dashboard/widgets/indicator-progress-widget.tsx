import { DashboardPanel } from "@/components/dashboard/components/dashboard-panel";
import { ChartEmptyState } from "@/components/dashboard/components/chart-empty-state";
import { clamp, formatPercent, formatWholeNumber } from "@/components/dashboard/engine/normalize-indicators";
import type { WidgetMetricCollection } from "@/components/dashboard/engine/types";
import { cn } from "@/lib/utils";

type MetricBarsItem = { label: string; percentage: number; target: number; value: number };

export function MetricBarsPanel({
  eyebrow = "Campaign View",
  emptyCopy,
  items,
  subtitle,
  title,
  valueSuffix = "",
  className,
}: {
  eyebrow?: string;
  emptyCopy: string;
  items: MetricBarsItem[];
  subtitle?: string;
  title: string;
  valueSuffix?: string;
  className?: string;
}) {
  return (
    <DashboardPanel
      className={cn("min-h-[180px]", className)}
      eyebrow={eyebrow}
      subtitle={subtitle}
      title={title}
    >
      {items.length === 0 ? (
        <ChartEmptyState message={emptyCopy} />
      ) : (
        <div className="space-y-5">
          {items.map((item) => {
            const hasTarget = item.target > 0;
            const targetPercent = hasTarget ? (item.value / item.target) * 100 : 0;
            const width = hasTarget ? clamp(Math.round(targetPercent), 0, 100) : 0;
            return (
              <div key={item.label} className="min-w-0 space-y-2">
                <div className="flex min-w-0 items-center justify-between gap-3 text-xs uppercase tracking-[0.16em] text-foreground">
                  <span className="min-w-0 break-words">{item.label}</span>
                  <span className="text-muted-foreground">
                    {hasTarget ? `${formatPercent(item.percentage)}%` : "No target"}
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {hasTarget
                    ? `Achieved ${formatWholeNumber(item.value)}${valueSuffix} / Target ${formatWholeNumber(item.target)}${valueSuffix}`
                    : `Achieved ${formatWholeNumber(item.value)}${valueSuffix} / Target not set`}
                </p>
                <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
                  {hasTarget ? (
                    <div
                      className="h-full max-w-full rounded-full bg-primary/70"
                      style={{ width: `${Math.min(width, 100)}%` }}
                    />
                  ) : (
                    <div className="h-full w-full rounded-full border border-dashed border-border/70 bg-background/60" />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </DashboardPanel>
  );
}

export function IndicatorProgressWidget({
  metrics,
  subtitle,
  title,
}: {
  metrics: WidgetMetricCollection;
  subtitle?: string;
  title: string;
}) {
  return (
    <MetricBarsPanel
      eyebrow="Custom widget"
      emptyCopy="Choose one or more indicators for this widget."
      items={metrics}
      subtitle={subtitle}
      title={title}
    />
  );
}
