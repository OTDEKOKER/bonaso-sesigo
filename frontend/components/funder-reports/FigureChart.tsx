"use client";

/**
 * FigureChart — standardized renderer for a generated funder-report figure.
 *
 * Deliberately one component for every figure so funder charts are visually
 * consistent: the SESIGO palette (single source of truth in lib/chart-theme),
 * uniform axes, thousands-separated numbers, a shared tooltip and legend, and
 * bar charts preferred over pie (easier to compare, per funder-reporting best
 * practice). It consumes the backend's normalized {categories, series, target}
 * payload so no chart logic is duplicated per figure.
 */
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

import { SESIGO_SEMANTIC_COLORS, seriesColor } from "@/lib/chart-theme";
import type { GeneratedFigure } from "@/lib/api/services/funderReports";

const fmt = (n: number) => new Intl.NumberFormat().format(Math.round(n));

interface Row { name: string; [series: string]: string | number }

function toRows(figure: GeneratedFigure): Row[] {
  return figure.categories.map((cat, i) => {
    const row: Row = { name: cat };
    figure.series.forEach((s) => { row[s.name] = s.data[i] ?? 0; });
    if (figure.target) row["Target"] = figure.target[i] ?? 0;
    if (figure.achievement_percent) row["Achievement %"] = figure.achievement_percent[i] ?? 0;
    return row;
  });
}

const AXIS = { fontSize: 12, tick: { fill: "#475569" } } as const;

export function FigureChart({ figure, height = 320 }: { figure: GeneratedFigure; height?: number }) {
  const rows = toRows(figure);
  const seriesNames = figure.series.map((s) => s.name);
  const isHorizontal = figure.chart_type === "horizontal_bar";
  const isStacked = figure.chart_type === "stacked_bar";
  const isTarget = figure.chart_type === "achieved_vs_target";

  if (!rows.length) {
    return <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">No data for this period.</div>;
  }

  // Pie only for a single-series small breakdown (kept rare by design).
  if (figure.chart_type === "pie" && seriesNames.length === 1) {
    const data = rows.map((r) => ({ name: r.name, value: Number(r[seriesNames[0]]) || 0 }));
    return (
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" outerRadius={110} label>
            {data.map((_, i) => <Cell key={i} fill={seriesColor(i)} />)}
          </Pie>
          <Tooltip formatter={(v: number) => fmt(v)} />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
    );
  }

  if (figure.chart_type === "line") {
    return (
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="name" {...AXIS} />
          <YAxis tickFormatter={fmt} {...AXIS} />
          <Tooltip formatter={(v: number) => fmt(v)} />
          <Legend />
          {seriesNames.map((name, i) => (
            <Line key={name} type="monotone" dataKey={name} stroke={seriesColor(i)} strokeWidth={2} dot={false} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={rows}
        layout={isHorizontal ? "vertical" : "horizontal"}
        margin={{ top: 8, right: 16, bottom: 8, left: isHorizontal ? 24 : 8 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        {isHorizontal ? (
          <>
            <XAxis type="number" tickFormatter={fmt} {...AXIS} />
            <YAxis type="category" dataKey="name" width={160} {...AXIS} />
          </>
        ) : (
          <>
            <XAxis dataKey="name" {...AXIS} interval={0} angle={rows.length > 6 ? -25 : 0} textAnchor={rows.length > 6 ? "end" : "middle"} height={rows.length > 6 ? 70 : 30} />
            <YAxis tickFormatter={fmt} {...AXIS} />
          </>
        )}
        <Tooltip formatter={(v: number) => fmt(v)} />
        <Legend />
        {seriesNames.map((name, i) => (
          <Bar key={name} dataKey={name} stackId={isStacked ? "s" : undefined}
               fill={isTarget ? SESIGO_SEMANTIC_COLORS.achieved : seriesColor(i)} radius={[2, 2, 0, 0]} />
        ))}
        {isTarget && figure.target && (
          <Bar dataKey="Target" fill={SESIGO_SEMANTIC_COLORS.target} radius={[2, 2, 0, 0]} />
        )}
      </BarChart>
    </ResponsiveContainer>
  );
}

export default FigureChart;
