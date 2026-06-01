import { useMemo } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { DashboardPanel } from "@/components/dashboard/components/dashboard-panel";
import { ChartEmptyState } from "@/components/dashboard/components/chart-empty-state";
import { chartTooltipContentStyle } from "@/components/dashboard/components/chart-tooltip";
import { buildChartData } from "@/components/dashboard/engine/chart-data-builder";
import { formatPercent, formatWholeNumber } from "@/components/dashboard/engine/normalize-indicators";
import type { WidgetMetricCollection } from "@/components/dashboard/engine/types";

export function IndicatorDoughnutWidget({
  metrics,
  subtitle,
  title,
}: {
  metrics: WidgetMetricCollection;
  subtitle?: string;
  title: string;
}) {
  const chartData = useMemo(
    () => buildChartData({ chartType: "indicator-doughnut-chart", metrics }),
    [metrics],
  ) as Array<{ color: string; label: string; value: number }>;

  const total = chartData.reduce((sum, item) => sum + item.value, 0);
  const chartSlices = chartData.map((item) => ({
    ...item,
    share: total > 0 ? (item.value / total) * 100 : 0,
  }));

  return (
    <DashboardPanel eyebrow="Custom widget" subtitle={subtitle} title={title}>
      {chartData.length === 0 ? (
        <ChartEmptyState message="Choose one or more indicators with reported values for this doughnut chart." />
      ) : (
        <div className="grid min-w-0 w-full max-w-full gap-4 xl:grid-cols-[minmax(260px,320px)_minmax(0,1fr)] xl:items-center">
          <div className="mx-auto aspect-square w-full min-w-0 max-w-[280px] overflow-hidden">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={chartSlices}
                  dataKey="value"
                  nameKey="label"
                  innerRadius="58%"
                  outerRadius="82%"
                  paddingAngle={2}
                  labelLine={false}
                  stroke="hsl(var(--card))"
                  strokeWidth={2}
                >
                  {chartSlices.map((item) => (
                    <Cell key={item.label} fill={item.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={chartTooltipContentStyle}
                  formatter={(value: number) => {
                    const share = total > 0 ? (Number(value) / total) * 100 : 0;
                    return [`${formatWholeNumber(Number(value))} (${formatPercent(share)}%)`, "Count"];
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="min-w-0 w-full max-w-full space-y-2">
            <div className="overflow-hidden rounded-[1rem] border border-border bg-card">
              <div className="w-full max-w-full overflow-x-auto">
                <table className="w-full min-w-[320px] table-fixed border-collapse">
                  <thead>
                    <tr className="border-b border-border bg-muted/40 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                      <th className="px-3 py-2 text-left">Indicator</th>
                      <th className="w-[88px] px-3 py-2 text-right sm:w-[92px]">Count</th>
                      <th className="w-[52px] px-3 py-2 text-right sm:w-[56px]">%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {chartSlices.map((item) => (
                      <tr key={item.label} className="border-t border-border first:border-t-0">
                        <td className="px-3 py-2.5 align-top">
                          <div className="flex min-w-0 items-start gap-2">
                            <span
                              className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
                              style={{ backgroundColor: item.color }}
                            />
                            <span className="min-w-0 text-[12px] leading-5 text-foreground sm:text-[13px]">
                              {item.label}
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-right align-top text-[12px] tabular-nums text-muted-foreground sm:text-[13px]">
                          {formatWholeNumber(item.value)}
                        </td>
                        <td className="px-3 py-2.5 text-right align-top text-[12px] tabular-nums text-muted-foreground sm:text-[13px]">
                          {formatPercent(item.share)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}
    </DashboardPanel>
  );
}
