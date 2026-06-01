import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { DashboardPanel } from "@/components/dashboard/components/dashboard-panel";
import { ChartEmptyState } from "@/components/dashboard/components/chart-empty-state";
import { chartTooltipContentStyle } from "@/components/dashboard/components/chart-tooltip";
import { ChartLegend } from "@/components/dashboard/components/chart-legend";
import { buildWidgetMetricRows } from "@/components/dashboard/engine/target-engine";
import { actualSeriesColor, formatWholeNumber } from "@/components/dashboard/engine/normalize-indicators";
import type { WidgetMetricCollection } from "@/components/dashboard/engine/types";
import { renderAngledTick } from "./shared-chart-utils";

export function IndicatorStackedBarChartWidget({
  metrics,
  subtitle,
  title,
}: {
  metrics: WidgetMetricCollection;
  subtitle?: string;
  title: string;
}) {
  const rows = useMemo(() => buildWidgetMetricRows(metrics, 8), [metrics]);
  const hasTargets = rows.some((row) => row.target > 0);

  return (
    <DashboardPanel eyebrow="Custom widget" subtitle={subtitle} title={title}>
      {rows.length === 0 ? (
        <ChartEmptyState message="Choose one or more indicators with reported values for this chart." />
      ) : !hasTargets ? (
        <ChartEmptyState message="This stacked chart needs targets to visualize remaining coverage." />
      ) : (
        <div className="space-y-2">
          <ChartLegend
            items={[
              { color: actualSeriesColor, label: "Actual" },
              { color: "hsl(var(--muted-foreground) / 0.45)", label: "Remaining to target" },
            ]}
          />
          <div className="h-[320px] w-full min-w-0 overflow-hidden">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows} margin={{ top: 8, right: 10, left: 2, bottom: 28 }}>
                <CartesianGrid vertical={false} stroke="hsl(var(--border) / 0.45)" />
                <XAxis
                  axisLine={false}
                  dataKey="shortLabel"
                  height={74}
                  tick={renderAngledTick}
                  tickLine={false}
                />
                <YAxis
                  axisLine={false}
                  tickFormatter={(value: number) => formatWholeNumber(value)}
                  tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
                  tickLine={false}
                  width={88}
                />
                <Tooltip
                  contentStyle={chartTooltipContentStyle}
                  formatter={(value: number, name: string) => [formatWholeNumber(Number(value)), name]}
                  labelFormatter={(value, payload) =>
                    String(payload?.[0]?.payload?.label || value || "Indicator")
                  }
                />
                <Bar dataKey="value" fill={actualSeriesColor} name="Actual" stackId="coverage" />
                <Bar dataKey="remaining" fill="hsl(var(--muted-foreground) / 0.45)" name="Remaining to target" stackId="coverage" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </DashboardPanel>
  );
}
