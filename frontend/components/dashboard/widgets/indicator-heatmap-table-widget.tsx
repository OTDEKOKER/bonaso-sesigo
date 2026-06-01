import { useMemo } from "react";
import { DashboardPanel } from "@/components/dashboard/components/dashboard-panel";
import { ChartEmptyState } from "@/components/dashboard/components/chart-empty-state";
import { buildWidgetMetricRows } from "@/components/dashboard/engine/target-engine";
import { clamp, formatPercent, formatWholeNumber } from "@/components/dashboard/engine/normalize-indicators";
import type { WidgetMetricCollection } from "@/components/dashboard/engine/types";

export function IndicatorHeatmapTableWidget({
  metrics,
  subtitle,
  title,
}: {
  metrics: WidgetMetricCollection;
  subtitle?: string;
  title: string;
}) {
  const rows = useMemo(() => buildWidgetMetricRows(metrics, 10), [metrics]);
  const maxValue = useMemo(
    () => Math.max(1, ...rows.map((row) => row.value)),
    [rows],
  );

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
                {rows.map((row) => {
                  const valueIntensity = clamp(row.value / maxValue, 0, 1);
                  const progressIntensity = clamp(row.percentage / 100, 0, 1);
                  return (
                    <tr key={row.indicatorId} className="border-t border-border first:border-t-0">
                      <td className="px-3 py-2.5 text-foreground">{row.label}</td>
                      <td
                        className="px-3 py-2.5 text-right tabular-nums text-foreground"
                        style={{ backgroundColor: `rgba(14, 165, 233, ${0.08 + valueIntensity * 0.32})` }}
                      >
                        {formatWholeNumber(row.value)}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                        {row.target > 0 ? formatWholeNumber(row.target) : "Not set"}
                      </td>
                      <td
                        className="px-3 py-2.5 text-right tabular-nums text-foreground"
                        style={{ backgroundColor: row.target > 0 ? `rgba(34, 197, 94, ${0.08 + progressIntensity * 0.3})` : undefined }}
                      >
                        {row.target > 0 ? `${formatPercent(row.percentage)}%` : "No target"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </DashboardPanel>
  );
}
