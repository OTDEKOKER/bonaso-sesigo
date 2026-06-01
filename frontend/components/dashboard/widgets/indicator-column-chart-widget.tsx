import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { DashboardPanel } from "@/components/dashboard/components/dashboard-panel";
import { ChartEmptyState } from "@/components/dashboard/components/chart-empty-state";
import { chartTooltipContentStyle } from "@/components/dashboard/components/chart-tooltip";
import { buildWidgetMetricRows } from "@/components/dashboard/engine/target-engine";
import { actualSeriesColor, formatWholeNumber } from "@/components/dashboard/engine/normalize-indicators";
import type { WidgetMetricCollection } from "@/components/dashboard/engine/types";
import { renderAngledTick } from "./shared-chart-utils";

export function IndicatorColumnChartWidget({
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
        <ChartEmptyState message="Choose one or more indicators with reported values for this chart." />
      ) : (
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
              <Bar dataKey="value" fill={actualSeriesColor} radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </DashboardPanel>
  );
}
