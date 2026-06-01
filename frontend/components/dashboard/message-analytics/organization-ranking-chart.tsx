import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatPercent, formatWholeNumber, toSafeNumber } from "@/components/dashboard/engine/normalize-indicators";
import { renderHorizontalCategoryTick } from "@/components/dashboard/widgets/shared-chart-utils";
import type { MessageAnalyticsRankingItem, MessageAnalyticsViewMode } from "@/components/dashboard/message-analytics/message-analytics-utils";

export function OrganizationRankingChart({
  items,
  viewMode,
}: {
  items: MessageAnalyticsRankingItem[];
  viewMode: MessageAnalyticsViewMode;
}) {
  const chartRows = useMemo(
    () => items.map((item) => ({ label: item.label, value: toSafeNumber(item.value) })),
    [items],
  );

  const xAxisLabel =
    viewMode === "absolute"
      ? "People reached"
      : viewMode === "percentage"
        ? "Share of all reached (%)"
        : "Average contribution (%)";

  const formatter = (value: number) => (viewMode === "absolute" ? formatWholeNumber(value) : `${formatPercent(value)}%`);

  return (
    <div className="rounded-2xl border border-border bg-card p-3">
      <div className="mb-2 text-sm font-medium text-foreground">Organization Ranking</div>
      <div className="h-[320px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart layout="vertical" data={chartRows} margin={{ top: 8, right: 84, left: 10, bottom: 22 }} barCategoryGap="22%">
            <CartesianGrid horizontal={false} stroke="hsl(var(--border) / 0.42)" />
            <XAxis
              axisLine={false}
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
              tickFormatter={formatter}
              tickLine={false}
              type="number"
              label={{
                value: xAxisLabel,
                position: "insideBottom",
                offset: -8,
                fill: "hsl(var(--muted-foreground))",
                fontSize: 11,
              }}
            />
            <YAxis axisLine={false} dataKey="label" interval={0} tick={renderHorizontalCategoryTick} tickLine={false} type="category" width={180} />
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: "16px",
                color: "hsl(var(--foreground))",
              }}
              formatter={(value: number) => [formatter(Number(value)), xAxisLabel]}
              labelFormatter={(label) => String(label || "Organization")}
            />
            <Bar dataKey="value" fill="#4F81BD" radius={[0, 8, 8, 0]} maxBarSize={30} minPointSize={5}>
              <LabelList dataKey="value" position="right" formatter={(value: number) => formatter(Number(value))} fill="hsl(var(--foreground))" fontSize={11} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
