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
 *
 * Every figure also renders a labelled data table beneath the chart — matching
 * the published report layout (chart + values table) so each number is fully
 * labelled by category (e.g. CSO/coordinator) and series (e.g. message type).
 */
import {
  Bar, BarChart, CartesianGrid, Cell, LabelList, Legend, Line, LineChart, Pie,
  PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

import { SESIGO_SEMANTIC_COLORS, seriesColor } from "@/lib/chart-theme";
import type { GeneratedFigure } from "@/lib/api/services/funderReports";

const fmt = (n: number) => new Intl.NumberFormat().format(Math.round(n));
// Truncate long category labels on the axis; the full name still shows in the
// tooltip and the data table below.
const shortLabel = (s: string) => (s.length > 16 ? `${s.slice(0, 15)}…` : s);

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

/** Labelled values table — rows are series (with colour swatch), columns are
 *  categories. Mirrors the report's chart-plus-table figure layout. */
function FigureTable({ figure }: { figure: GeneratedFigure }) {
  const cats = figure.categories;
  if (!cats.length) return null;
  const hasTarget = Array.isArray(figure.target) && figure.target.length > 0;
  const hasPct = Array.isArray(figure.achievement_percent) && figure.achievement_percent.length > 0;
  const th = "px-2 py-1.5 text-left font-normal whitespace-nowrap";
  const td = "px-2 py-1.5 text-right tabular-nums";
  const swatch = (color: string) => (
    <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm align-middle" style={{ background: color }} />
  );
  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-b">
            <th className="px-2 py-1.5 text-left font-medium text-muted-foreground" />
            {cats.map((c) => (
              <th key={c} className="px-2 py-1.5 text-right font-medium text-slate-700 whitespace-nowrap">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {figure.series.map((s, i) => (
            <tr key={s.name} className="border-b border-slate-100">
              <th className={th}>{swatch(seriesColor(i))}{s.name}</th>
              {cats.map((c, ci) => (
                <td key={c} className={td}>{fmt(Number(s.data[ci]) || 0)}</td>
              ))}
            </tr>
          ))}
          {hasTarget && (
            <tr className="border-b border-slate-100">
              <th className={th}>{swatch(SESIGO_SEMANTIC_COLORS.target)}Target</th>
              {cats.map((c, ci) => (
                <td key={c} className={`${td} text-muted-foreground`}>{fmt(Number(figure.target![ci]) || 0)}</td>
              ))}
            </tr>
          )}
          {hasPct && (
            <tr>
              <th className={th}>Achievement %</th>
              {cats.map((c, ci) => {
                const v = figure.achievement_percent![ci];
                return <td key={c} className={td}>{v == null ? "—" : `${v}%`}</td>;
              })}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function FigureChart({ figure, height = 320 }: { figure: GeneratedFigure; height?: number }) {
  const rows = toRows(figure);
  const seriesNames = figure.series.map((s) => s.name);
  const isHorizontal = figure.chart_type === "horizontal_bar";
  const isStacked = figure.chart_type === "stacked_bar";
  const isTarget = figure.chart_type === "achieved_vs_target";

  if (!rows.length) {
    return <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">No data for this period.</div>;
  }

  // Angle + reserve height for category labels so they're never clipped, and
  // always render every tick (interval={0}) so no category goes unlabelled.
  const many = rows.length > 3;
  const barLabels = !isStacked && rows.length <= 8 && seriesNames.length <= 2;

  const chart = (() => {
    // Pie only for a single-series small breakdown (kept rare by design).
    if (figure.chart_type === "pie" && seriesNames.length === 1) {
      const data = rows.map((r) => ({ name: r.name, value: Number(r[seriesNames[0]]) || 0 }));
      return (
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" outerRadius={110} label={(e: { name: string }) => shortLabel(e.name)}>
            {data.map((_, i) => <Cell key={i} fill={seriesColor(i)} />)}
          </Pie>
          <Tooltip formatter={(v: number) => fmt(v)} />
          <Legend />
        </PieChart>
      );
    }

    if (figure.chart_type === "line") {
      return (
        <LineChart data={rows} margin={{ top: 8, right: 16, bottom: many ? 40 : 8, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="name" {...AXIS} interval={0} tickFormatter={shortLabel}
                 angle={many ? -25 : 0} textAnchor={many ? "end" : "middle"} height={many ? 70 : 30} />
          <YAxis tickFormatter={fmt} {...AXIS} />
          <Tooltip formatter={(v: number) => fmt(v)} />
          <Legend />
          {seriesNames.map((name, i) => (
            <Line key={name} type="monotone" dataKey={name} stroke={seriesColor(i)} strokeWidth={2} dot={false} />
          ))}
        </LineChart>
      );
    }

    return (
      <BarChart
        data={rows}
        layout={isHorizontal ? "vertical" : "horizontal"}
        margin={{ top: barLabels ? 20 : 8, right: 16, bottom: isHorizontal ? 8 : (many ? 12 : 8), left: isHorizontal ? 24 : 8 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        {isHorizontal ? (
          <>
            <XAxis type="number" tickFormatter={fmt} {...AXIS} />
            <YAxis type="category" dataKey="name" width={170} interval={0} tickFormatter={shortLabel} {...AXIS} />
          </>
        ) : (
          <>
            <XAxis dataKey="name" {...AXIS} interval={0} tickFormatter={shortLabel}
                   angle={many ? -25 : 0} textAnchor={many ? "end" : "middle"} height={many ? 80 : 30} />
            <YAxis tickFormatter={fmt} {...AXIS} />
          </>
        )}
        <Tooltip formatter={(v: number) => fmt(v)} />
        <Legend />
        {seriesNames.map((name, i) => (
          <Bar key={name} dataKey={name} stackId={isStacked ? "s" : undefined}
               fill={isTarget ? SESIGO_SEMANTIC_COLORS.achieved : seriesColor(i)} radius={[2, 2, 0, 0]}>
            {barLabels && !isHorizontal && (
              <LabelList dataKey={name} position="top" formatter={(v: number) => fmt(v)} style={{ fontSize: 10, fill: "#475569" }} />
            )}
          </Bar>
        ))}
        {isTarget && figure.target && (
          <Bar dataKey="Target" fill={SESIGO_SEMANTIC_COLORS.target} radius={[2, 2, 0, 0]} />
        )}
      </BarChart>
    );
  })();

  return (
    <div>
      <ResponsiveContainer width="100%" height={height + (many && !isHorizontal ? 50 : 0)}>
        {chart}
      </ResponsiveContainer>
      <FigureTable figure={figure} />
    </div>
  );
}

export default FigureChart;
