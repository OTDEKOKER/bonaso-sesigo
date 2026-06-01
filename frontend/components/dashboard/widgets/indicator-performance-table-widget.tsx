import { useMemo } from "react";
import { DashboardPanel } from "@/components/dashboard/components/dashboard-panel";
import { ChartEmptyState } from "@/components/dashboard/components/chart-empty-state";
import { formatPercent, formatWholeNumber } from "@/components/dashboard/engine/normalize-indicators";
import { buildWidgetMetricRows } from "@/components/dashboard/engine/target-engine";
import type { WidgetMetricCollection } from "@/components/dashboard/engine/types";

export function IndicatorPerformanceTableWidget({
  metrics,
  subtitle,
  title,
}: {
  metrics: WidgetMetricCollection;
  subtitle?: string;
  title: string;
}) {
  const rows = useMemo(() => buildWidgetMetricRows(metrics, 8), [metrics]);

  return (
    <DashboardPanel eyebrow="Custom widget" subtitle={subtitle} title={title}>
      {rows.length === 0 ? (
        <ChartEmptyState message="Choose one or more indicators with reported values for this table." />
      ) : (
        <div className="w-full max-w-full overflow-hidden rounded-[1rem] border border-border bg-card">
          <div className="w-full max-w-full overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                <th className="px-3 py-2">Indicator</th>
                <th className="px-3 py-2 text-right">Actual</th>
                <th className="px-3 py-2 text-right">Target</th>
                <th className="px-3 py-2 text-right">Progress</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.indicatorId} className="border-t border-border first:border-t-0">
                  <td className="px-3 py-2.5 text-foreground">{row.label}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-foreground">
                    {formatWholeNumber(row.value)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                    {row.target > 0 ? formatWholeNumber(row.target) : "Not set"}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-foreground">
                    {row.target > 0 ? `${formatPercent(row.percentage)}%` : "No target"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </DashboardPanel>
  );
}
