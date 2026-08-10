import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DashboardPanel } from "@/components/dashboard/components/dashboard-panel";
import { ChartEmptyState } from "@/components/dashboard/components/chart-empty-state";
import { ChartLegend } from "@/components/dashboard/components/chart-legend";
import { PerformanceStatusPill } from "@/components/dashboard/components/performance-status-pill";
import { chartTooltipContentStyle } from "@/components/dashboard/components/chart-tooltip";
import { buildWidgetMetricRows } from "@/components/dashboard/engine/target-engine";
import {
  formatPercent,
  formatWholeNumber,
  truncateLabel,
} from "@/components/dashboard/engine/normalize-indicators";
import {
  getPerformanceStatusFromValues,
  PERFORMANCE_RAG_LEGEND_ITEMS,
} from "@/components/dashboard/engine/performance-status";
import type { WidgetMetricCollection } from "@/components/dashboard/engine/types";
import type { ScreeningDashboardInsights } from "@/lib/dashboard/screening-insights";
import { downloadMetricsCsv } from "@/lib/dashboard/export-metrics";

type BreakdownRow = { label: string; value: number; target: number; percentage: number };

/** Horizontal RAG bar for a list of target-vs-achieved rows. */
function RagBar({
  rows,
  performanceColors,
}: {
  rows: BreakdownRow[];
  performanceColors: boolean;
}) {
  const data = useMemo(
    () =>
      rows
        .filter((row) => row.value > 0 || row.target > 0)
        .slice(0, 12)
        .map((row) => ({
          ...row,
          shortLabel: truncateLabel(row.label, 28),
          statusColor: getPerformanceStatusFromValues(row.value, row.target).color,
        })),
    [rows],
  );

  if (data.length === 0) {
    return <ChartEmptyState message="No reported values in the current filter." />;
  }

  const height = Math.max(220, data.length * 34 + 24);
  return (
    <div className="space-y-2">
      {performanceColors ? <ChartLegend items={PERFORMANCE_RAG_LEGEND_ITEMS} /> : null}
      <div className="w-full min-w-0 overflow-hidden" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart layout="vertical" data={data} margin={{ top: 4, right: 24, left: 12, bottom: 4 }}>
            <CartesianGrid horizontal={false} stroke="hsl(var(--border) / 0.4)" />
            <XAxis
              type="number"
              allowDecimals={false}
              axisLine={false}
              tickLine={false}
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
              tickFormatter={(value: number) => formatWholeNumber(value)}
            />
            <YAxis
              type="category"
              dataKey="shortLabel"
              width={210}
              interval={0}
              axisLine={false}
              tickLine={false}
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
            />
            <Tooltip
              contentStyle={chartTooltipContentStyle}
              formatter={(value: number) => [formatWholeNumber(Number(value)), "Achieved"]}
              labelFormatter={(_value, payload) => String(payload?.[0]?.payload?.label ?? "")}
            />
            <Bar dataKey="value" radius={[0, 8, 8, 0]} maxBarSize={22}>
              {data.map((row) => (
                <Cell
                  key={row.label}
                  fill={performanceColors ? row.statusColor : "#0EA5E9"}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/**
 * Preference-gated drill-down beneath the widget grid: an Overview RAG bar,
 * a Breakdown (by organization / project) using already-computed insights,
 * and a Data tab with a CSV export of the filtered indicator metrics.
 */
export function PerformanceDetailPanel({
  metrics,
  organizations,
  projects,
  performanceColors = true,
}: {
  metrics: WidgetMetricCollection;
  organizations: ScreeningDashboardInsights["organizations"];
  projects: ScreeningDashboardInsights["projects"];
  performanceColors?: boolean;
}) {
  const [breakdown, setBreakdown] = useState<"organization" | "project">("organization");

  const indicatorRows = useMemo(() => buildWidgetMetricRows(metrics, 12), [metrics]);
  const overviewRows: BreakdownRow[] = useMemo(
    () =>
      indicatorRows.map((row) => ({
        label: row.label,
        value: row.value,
        target: row.target,
        percentage: row.percentage,
      })),
    [indicatorRows],
  );
  const breakdownRows: BreakdownRow[] =
    breakdown === "organization" ? organizations ?? [] : projects ?? [];

  const hasData = overviewRows.length > 0;

  return (
    <DashboardPanel
      eyebrow="Performance"
      title="Target vs. achieved"
      subtitle="RAG performance across indicators, with breakdowns and export"
    >
      {!hasData ? (
        <ChartEmptyState message="Performance detail appears once indicators report values in the current filter." />
      ) : (
        <Tabs defaultValue="overview" className="w-full">
          <TabsList className="h-auto flex-wrap justify-start rounded-full border border-border bg-card p-1">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="breakdown">Breakdown</TabsTrigger>
            <TabsTrigger value="data">Data</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="m-0 pt-4">
            <RagBar rows={overviewRows} performanceColors={performanceColors} />
          </TabsContent>

          <TabsContent value="breakdown" className="m-0 space-y-3 pt-4">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Group by</span>
              <Select value={breakdown} onValueChange={(value) => setBreakdown(value as typeof breakdown)}>
                <SelectTrigger className="h-8 w-[180px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="organization">Organization</SelectItem>
                  <SelectItem value="project">Project</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <RagBar rows={breakdownRows} performanceColors={performanceColors} />
          </TabsContent>

          <TabsContent value="data" className="m-0 space-y-3 pt-4">
            <div className="flex justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={() => downloadMetricsCsv(metrics, "dashboard-performance.csv")}
              >
                <Download className="mr-2 h-4 w-4" />
                Export CSV
              </Button>
            </div>
            <div className="w-full max-w-full overflow-hidden rounded-[1rem] border border-border bg-card">
              <div className="w-full max-w-full overflow-x-auto">
                <table className="w-full min-w-[640px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/40 text-left text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                      <th className="px-3 py-2">Indicator</th>
                      <th className="px-3 py-2 text-right">Achieved</th>
                      <th className="px-3 py-2 text-right">Target</th>
                      <th className="px-3 py-2 text-right">Progress</th>
                      <th className="px-3 py-2 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {indicatorRows.map((row) => (
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
                        <td className="px-3 py-2.5 text-right">
                          <PerformanceStatusPill value={row.value} target={row.target} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      )}
    </DashboardPanel>
  );
}
