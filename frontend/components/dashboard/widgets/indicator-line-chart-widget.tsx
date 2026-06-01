import { useMemo } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { DashboardPanel } from "@/components/dashboard/components/dashboard-panel";
import { ChartEmptyState } from "@/components/dashboard/components/chart-empty-state";
import { chartTooltipContentStyle } from "@/components/dashboard/components/chart-tooltip";
import { buildWidgetMetricRows } from "@/components/dashboard/engine/target-engine";
import { actualSeriesColor, formatWholeNumber } from "@/components/dashboard/engine/normalize-indicators";
import type { WidgetMetricCollection } from "@/components/dashboard/engine/types";
import { renderCenteredWrappedTick } from "./shared-chart-utils";

export function IndicatorLineChartWidget({
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
            <LineChart data={rows} margin={{ top: 8, right: 10, left: 2, bottom: 28 }}>
              <CartesianGrid vertical={false} stroke="hsl(var(--border) / 0.45)" />
              <XAxis
                axisLine={false}
                dataKey="shortLabel"
                height={74}
                tick={renderCenteredWrappedTick}
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
              <Line
                dataKey="value"
                dot={{ r: 3 }}
                stroke={actualSeriesColor}
                strokeWidth={2.5}
                type="monotone"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </DashboardPanel>
  );
}
