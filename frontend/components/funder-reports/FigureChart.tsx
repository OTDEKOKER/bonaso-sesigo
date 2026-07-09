"use client";

/**
 * FigureChart — standardized renderer for a generated funder-report figure.
 *
 * One component for every figure so funder charts are visually consistent: the
 * SESIGO palette (single source of truth in lib/chart-theme), uniform axes,
 * thousands-separated numbers, a shared tooltip and legend, a labelled values
 * table beneath every chart (matching the published report layout), plus
 * chart-type-aware rendering:
 *   - cascade  → an ordered funnel with stage-to-stage drop-off
 *   - table    → a clean values/status table (no chart)
 *   - ratio    → a headline conversion % over the numerator/denominator bars
 *   - target   → achieved vs target with an achievement % read-out
 * It consumes the backend's normalized {categories, series, target, ...} payload
 * so no chart logic is duplicated per figure and nothing is recomputed here.
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

// ── empty states ────────────────────────────────────────────────────────────
function emptyState(figure: GeneratedFigure) {
  const w = (figure.warnings ?? []).map((x) => x.toLowerCase());
  const has = (s: string) => w.some((x) => x.includes(s));
  if (has("no mapped indicators"))
    return { title: "Not yet configured", body: "Map one or more indicators to this figure in the Report Builder." };
  if (has("no approved data"))
    return { title: "No approved data yet", body: "The mapped indicators have no approved data for this reporting period." };
  if (has("no data matches"))
    return { title: "No matching data", body: "No approved data matches the current filters for this period." };
  return { title: "No data", body: "Nothing to display for the selected period." };
}

function EmptyState({ figure }: { figure: GeneratedFigure }) {
  const { title, body } = emptyState(figure);
  return (
    <div className="flex h-40 flex-col items-center justify-center rounded-md border border-dashed text-center">
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="mt-1 max-w-sm text-xs text-muted-foreground">{body}</p>
    </div>
  );
}

// ── headline stats (target / achievement / conversion) ──────────────────────
function StatStrip({ figure }: { figure: GeneratedFigure }) {
  const t = figure.totals ?? { total: 0 };
  const items: Array<{ k: string; v: string; tone?: "good" | "warn" }> = [];
  items.push({ k: "Total", v: fmt(t.total ?? 0) });
  if (figure.target?.length && t.target != null) items.push({ k: "Target", v: fmt(t.target) });
  if (t.achievement_percent != null)
    items.push({ k: "Achievement", v: `${t.achievement_percent}%`, tone: t.achievement_percent >= 100 ? "good" : "warn" });
  if (figure.ratio_percent != null)
    items.push({ k: "Conversion rate", v: `${figure.ratio_percent}%` });
  return (
    <div className="mb-3 flex flex-wrap gap-x-6 gap-y-2">
      {items.map(({ k, v, tone }) => (
        <div key={k}>
          <div className="text-xs text-muted-foreground">{k}</div>
          <div className={`text-lg font-semibold tabular-nums ${tone === "good" ? "text-emerald-600" : tone === "warn" ? "text-amber-600" : ""}`}>{v}</div>
        </div>
      ))}
    </div>
  );
}

// ── shared tooltip ──────────────────────────────────────────────────────────
function makeTooltip(figure: GeneratedFigure) {
  const Custom = ({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) => {
    if (!active || !payload?.length) return null;
    const idx = figure.categories.indexOf(String(label));
    const ach = idx >= 0 ? figure.achievement_percent?.[idx] : undefined;
    return (
      <div className="rounded-md border bg-background px-3 py-2 text-xs shadow-md">
        <div className="mb-1 font-medium">{label}</div>
        {payload.map((p) => (
          <div key={p.name} className="flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-sm" style={{ background: p.color }} />
            <span className="text-muted-foreground">{p.name}</span>
            <span className="ml-auto font-medium tabular-nums">{fmt(Number(p.value) || 0)}</span>
          </div>
        ))}
        {ach != null && (
          <div className="mt-1 border-t pt-1">Achievement: <b className={ach >= 100 ? "text-emerald-600" : "text-amber-600"}>{ach}%</b></div>
        )}
      </div>
    );
  };
  return Custom;
}

// ── cascade / funnel ────────────────────────────────────────────────────────
function Funnel({ figure }: { figure: GeneratedFigure }) {
  const stages = figure.categories.map((name, i) => ({
    name,
    value: figure.series.reduce((sum, s) => sum + (Number(s.data[i]) || 0), 0),
  }));
  const max = Math.max(...stages.map((s) => s.value), 1);
  return (
    <div className="space-y-0.5">
      {stages.map((s, i) => {
        const prev = i > 0 ? stages[i - 1].value : null;
        const retained = prev && prev > 0 ? Math.round((s.value / prev) * 100) : null;
        return (
          <div key={`${s.name}-${i}`}>
            {i > 0 && (
              <div className="flex items-center gap-1.5 py-0.5 pl-40 text-[11px] text-muted-foreground">
                <span aria-hidden>↓</span>
                {retained != null ? (
                  <>
                    <span>{retained}% retained</span>
                    {retained < 100 && <span className="text-amber-600">(−{100 - retained}%)</span>}
                  </>
                ) : <span>—</span>}
              </div>
            )}
            <div className="flex items-center gap-2">
              <div className="w-40 shrink-0 truncate text-xs" title={s.name}>{s.name}</div>
              <div className="h-7 flex-1 rounded bg-slate-100">
                <div className="h-7 rounded" style={{ width: `${Math.max((s.value / max) * 100, 2)}%`, background: seriesColor(i) }} />
              </div>
              <div className="w-20 shrink-0 text-right text-xs font-medium tabular-nums">{fmt(s.value)}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── values / status table ───────────────────────────────────────────────────
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
                return <td key={c} className={`${td} ${v != null && v >= 100 ? "text-emerald-600" : v != null ? "text-amber-600" : ""}`}>{v == null ? "—" : `${v}%`}</td>;
              })}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ── reporting-compliance matrix (coordinator × quarter status badges) ────────
const COMPLIANCE_BADGE: Record<string, { label: string; cls: string }> = {
  submitted: { label: "Submitted", cls: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  late: { label: "Late", cls: "bg-amber-100 text-amber-800 border-amber-200" },
  not_submitted: { label: "Not submitted", cls: "bg-red-100 text-red-800 border-red-200" },
  not_opened: { label: "Not opened", cls: "bg-slate-100 text-slate-500 border-slate-200" },
  na: { label: "N/A", cls: "bg-slate-100 text-slate-500 border-slate-200" },
};

function ComplianceTable({ figure }: { figure: GeneratedFigure }) {
  const m = figure.compliance;
  if (!m || !m.rows.length) {
    return <div className="flex h-24 items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">No coordinators configured for this project.</div>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b">
            <th className="px-3 py-2 text-left font-medium text-muted-foreground">Coordinator / CSO</th>
            {m.quarters.map((q) => <th key={q} className="px-3 py-2 text-center font-medium text-slate-700">{q}</th>)}
          </tr>
        </thead>
        <tbody>
          {m.rows.map((row) => (
            <tr key={row.coordinator} className="border-b border-slate-100">
              <th className="px-3 py-2 text-left font-normal whitespace-nowrap">{row.coordinator}</th>
              {row.cells.map((c) => {
                const b = COMPLIANCE_BADGE[c.status] ?? COMPLIANCE_BADGE.na;
                return (
                  <td key={c.quarter} className="px-3 py-2 text-center">
                    <span className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${b.cls}`}>{b.label}</span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
        {["submitted", "late", "not_submitted", "not_opened"].map((s) => (
          <span key={s} className="inline-flex items-center gap-1">
            <span className={`inline-block h-2.5 w-2.5 rounded-full border ${COMPLIANCE_BADGE[s].cls}`} />{COMPLIANCE_BADGE[s].label}
          </span>
        ))}
        <span className="ml-auto">FY {m.fiscal_year}/{String((m.fiscal_year + 1) % 100).padStart(2, "0")}</span>
      </div>
    </div>
  );
}

export function FigureChart({ figure, height = 320 }: { figure: GeneratedFigure; height?: number }) {
  const rows = toRows(figure);
  const seriesNames = figure.series.map((s) => s.name);
  const isHorizontal = figure.chart_type === "horizontal_bar";
  const isStacked = figure.chart_type === "stacked_bar";
  const isTarget = figure.chart_type === "achieved_vs_target";
  const isCascade = figure.chart_type === "cascade";
  const isTableType = figure.chart_type === "table";
  const showStats = isTarget || isCascade || figure.ratio_percent != null;

  // Reporting-compliance matrix — its own status-badge table (not a chart).
  if (figure.chart_type === "compliance") return <ComplianceTable figure={figure} />;

  if (!figure.categories.length) return <EmptyState figure={figure} />;

  // Clean status/values table only — no chart (compliance & capacity tables).
  if (isTableType) {
    return <div>{showStats && <StatStrip figure={figure} />}<FigureTable figure={figure} /></div>;
  }

  // Cascade → ordered funnel with drop-off, then the values table.
  if (isCascade) {
    return (
      <div>
        <StatStrip figure={figure} />
        <Funnel figure={figure} />
        <FigureTable figure={figure} />
      </div>
    );
  }

  const many = rows.length > 3;
  const barLabels = !isStacked && rows.length <= 8 && seriesNames.length <= 2;
  const Tip = makeTooltip(figure);

  const chart = (() => {
    if (figure.chart_type === "pie" && seriesNames.length === 1) {
      const data = rows.map((r) => ({ name: r.name, value: Number(r[seriesNames[0]]) || 0 }));
      return (
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" outerRadius={110} label={(e: { name: string }) => shortLabel(e.name)}>
            {data.map((_, i) => <Cell key={i} fill={seriesColor(i)} />)}
          </Pie>
          <Tooltip content={Tip} />
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
          <Tooltip content={Tip} />
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
        <Tooltip content={Tip} />
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
      {showStats && <StatStrip figure={figure} />}
      <ResponsiveContainer width="100%" height={height + (many && !isHorizontal ? 50 : 0)}>
        {chart}
      </ResponsiveContainer>
      <FigureTable figure={figure} />
    </div>
  );
}

export default FigureChart;
