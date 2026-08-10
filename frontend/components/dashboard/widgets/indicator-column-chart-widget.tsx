import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { DashboardPanel } from "@/components/dashboard/components/dashboard-panel";
import { ChartEmptyState } from "@/components/dashboard/components/chart-empty-state";
import { ChartLegend } from "@/components/dashboard/components/chart-legend";
import { chartTooltipContentStyle } from "@/components/dashboard/components/chart-tooltip";
import { buildWidgetMetricRows } from "@/components/dashboard/engine/target-engine";
import { actualSeriesColor, formatWholeNumber } from "@/components/dashboard/engine/normalize-indicators";
import {
  getPerformanceStatusFromValues,
  PERFORMANCE_RAG_LEGEND_ITEMS,
} from "@/components/dashboard/engine/performance-status";
import type { WidgetMetricCollection } from "@/components/dashboard/engine/types";
import { renderAngledTick } from "./shared-chart-utils";

export function IndicatorColumnChartWidget({
  metrics,
  subtitle,
  title,
  performanceColors = true,
}: {
  metrics: WidgetMetricCollection;
  subtitle?: string;
  title: string;
  performanceColors?: boolean;
}) {
  const rows = useMemo(
    () =>
      buildWidgetMetricRows(metrics, 8).map((row) => ({
        ...row,
        statusColor: getPerformanceStatusFromValues(row.value, row.target).color,
      })),
    [metrics],
  );

  return (
    <DashboardPanel eyebrow="Custom widget" subtitle={subtitle} title={title}>
      {rows.length === 0 ? (
        <ChartEmptyState message="Choose one or more indicators with reported values for this chart." />
      ) : (
        <div className="space-y-2">
          {performanceColors ? <ChartLegend items={PERFORMANCE_RAG_LEGEND_ITEMS} /> : null}
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
                  formatter={(value: number) => [formatWholeNumber(Number(value)), "Actual"]}
                  labelFormatter={(value, payload) =>
                    String(payload?.[0]?.payload?.label || value || "Indicator")
                  }
                />
                <Bar dataKey="value" fill={actualSeriesColor} radius={[8, 8, 0, 0]}>
                  {performanceColors
                    ? rows.map((row) => <Cell key={`${row.indicatorId}-cell`} fill={row.statusColor} />)
                    : null}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </DashboardPanel>
  );
}
