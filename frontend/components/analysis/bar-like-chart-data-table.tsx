"use client";

import { useMemo } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { BarLikeChart } from "@/lib/visualization/engine";

function formatCellValue(value: unknown) {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric.toLocaleString();
  return "-";
}

export function BarLikeChartDataTable(props: { chart: BarLikeChart }) {
  const { chart } = props;

  const categories = useMemo(
    () => chart.data.map((row) => String(row[chart.xKey] ?? "-")),
    [chart.data, chart.xKey],
  );

  const rows = useMemo(
    () =>
      chart.series.map((series) => ({
        key: series.key,
        label: series.label,
        color: series.color,
        values: chart.data.map((entry) => entry[series.key]),
      })),
    [chart.data, chart.series],
  );

  if (categories.length === 0 || rows.length === 0) return null;

  return (
    <Card className="border-border/60 bg-muted/10">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold text-foreground">Chart data table</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-auto rounded-xl border border-border/60 bg-background">
          <table className="min-w-max border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 top-0 z-20 min-w-[12rem] border-b border-r border-border bg-muted/80 px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Series
                </th>
                {categories.map((category) => (
                  <th
                    key={`category-${category}`}
                    className="sticky top-0 z-10 min-w-[7rem] border-b border-r border-border bg-muted/80 px-3 py-2.5 text-center text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground"
                  >
                    {category}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={row.key} className={rowIndex % 2 === 0 ? "bg-background" : "bg-muted/20"}>
                  <th className="sticky left-0 z-10 border-b border-r border-border bg-background px-3 py-2 text-left font-medium text-foreground">
                    <span className="inline-flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: row.color }} />
                      <span>{row.label}</span>
                    </span>
                  </th>
                  {row.values.map((value, valueIndex) => (
                    <td
                      key={`${row.key}-${valueIndex}`}
                      className="border-b border-r border-border px-3 py-2 text-center tabular-nums text-foreground"
                    >
                      {formatCellValue(value)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

