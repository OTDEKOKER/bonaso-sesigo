"use client";

// Executive Dashboard — mirrors the shared mockup: project-scoped, permission-
// focused. Filter cascade (Project → Coordinator → Organisation → District →
// Indicator → Period), 6 KPI cards, Programme Performance (Target vs Achieved),
// Performance Trend, Reporting Compliance donut, Top Orgs, Attention, Submissions.
// Data + hierarchy scope via useExecutiveData.
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Database,
  Download,
  Target,
  Users,
} from "lucide-react";
import {
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatPercent, formatWholeNumber } from "@/components/dashboard/engine/normalize-indicators";
import {
  getPerformanceStatusFromValues,
  PERFORMANCE_STATUS_COLORS,
  PERFORMANCE_STATUS_LABELS,
  PERFORMANCE_STATUS_ORDER,
  type PerformanceStatus,
  type PerformanceStatusResult,
} from "@/components/dashboard/engine/performance-status";
import { downloadMetricsCsv } from "@/lib/dashboard/export-metrics";
import { useExecutiveData, DEFAULT_EXECUTIVE_FILTERS, type ExecutiveFilters } from "@/lib/executive/use-executive-data";
import { ProgrammeFigures } from "@/components/executive/programme-figures";

function fyPresets(now = new Date()) {
  const fy = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const suffix = `${fy}/${String((fy + 1) % 100).padStart(2, "0")}`;
  return [
    { key: "fy", label: `FY ${suffix}`, from: iso(fy, 4, 1), to: iso(fy + 1, 3, 31) },
    { key: "q1", label: "Q1", from: iso(fy, 4, 1), to: iso(fy, 6, 30) },
    { key: "q2", label: "Q2", from: iso(fy, 7, 1), to: iso(fy, 9, 30) },
    { key: "q3", label: "Q3", from: iso(fy, 10, 1), to: iso(fy, 12, 31) },
    { key: "q4", label: "Q4", from: iso(fy + 1, 1, 1), to: iso(fy + 1, 3, 31) },
  ];
}

function StatusBadge({ status }: { status: PerformanceStatusResult }) {
  return (
    <span
      className="inline-block rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
      style={{ color: status.color, backgroundColor: `${status.color}18` }}
    >
      {status.label}
    </span>
  );
}

function KpiCard({
  icon: Icon,
  label,
  value,
  note,
  accent,
  badge,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  note?: string;
  accent?: string;
  badge?: PerformanceStatusResult;
  onClick?: () => void;
}) {
  return (
    <div className="min-w-0 rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
        {onClick ? (
          <button
            type="button"
            onClick={onClick}
            aria-label={label}
            title={`View ${label} details`}
            className="group rounded-xl border border-border p-1.5 text-muted-foreground transition hover:border-primary/60 hover:bg-primary/10 hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <Icon className="h-4 w-4 transition group-hover:scale-110" />
          </button>
        ) : (
          <span className="rounded-xl border border-border p-1.5 text-muted-foreground">
            <Icon className="h-4 w-4" />
          </span>
        )}
      </div>
      <p className="mt-2 text-3xl font-bold tracking-tight" style={accent ? { color: accent } : undefined}>
        {value}
      </p>
      <div className="mt-1 flex items-center gap-2">
        {badge ? <StatusBadge status={badge} /> : null}
        {note ? <span className="text-xs text-muted-foreground">{note}</span> : null}
      </div>
    </div>
  );
}

export default function ExecutiveDashboardPage() {
  const [filters, setFilters] = useState<ExecutiveFilters>(DEFAULT_EXECUTIVE_FILTERS);
  const { insights, indicatorMetrics, kpis, periodFraction, reportingAnalysis, recentSubmissions, reportedOrganizations, notReportedOrganizations, isLoading, options } = useExecutiveData(filters);
  const [openCard, setOpenCard] = useState<
    null | "overall" | "ontrack" | "reporting" | "completeness" | "total" | "offtrack"
  >(null);
  const presets = useMemo(() => fyPresets(), []);
  const activePreset = presets.find((p) => p.from === filters.dateFrom && p.to === filters.dateTo)?.key ?? null;

  // Land on the CURRENT project by default: the newest active (permission-scoped)
  // project + current FY. Sort by start_date descending so we deterministically
  // pick the current live project (e.g. NSC2026/27 over the prior year) instead of
  // relying on list order; fall back to newest, then first.
  useEffect(() => {
    if (filters.projectId !== "all" || options.projects.length === 0) return;
    const byNewest = [...options.projects].sort((a, b) =>
      String((b as { start_date?: string }).start_date ?? "").localeCompare(
        String((a as { start_date?: string }).start_date ?? ""),
      ),
    );
    const preferred =
      byNewest.find((p) => (p as { status?: string }).status === "active") ?? byNewest[0];
    const fy = presets[0];
    setFilters((f) => ({ ...f, projectId: String(preferred.id), dateFrom: f.dateFrom || fy.from, dateTo: f.dateTo || fy.to }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.projects]);

  const set = (patch: Partial<ExecutiveFilters>) => setFilters((f) => ({ ...f, ...patch }));
  const setProject = (v: string) => set({ projectId: v, coordinatorId: "all", organizationId: "all", district: "all" });
  const setCoordinator = (v: string) => set({ coordinatorId: v, organizationId: "all" });

  const periodPct = Math.round(periodFraction * 100);
  const rows = useMemo(
    () =>
      [...indicatorMetrics]
        .map((m) => {
          const target = Number(m.target) || 0;
          const value = Number(m.value) || 0;
          const expected = Number((m as { expected?: number }).expected) || 0;
          return {
            ...m,
            expected,
            target,
            value,
            hasTarget: target > 0,
            // vs annual target (for the volume column), and vs expected-to-date (pace).
            pct: target > 0 ? (value / target) * 100 : 0,
            pacePct: expected > 0 ? (value / expected) * 100 : 0,
            variance: value - expected,
            // Colour/status reflect PACE (achieved vs expected-to-date), so on-pace
            // work early in the year is no longer painted red.
            status: getPerformanceStatusFromValues(value, expected),
          };
        })
        // Worst pace first — executives scan for problems at the top.
        .sort((a, b) => a.pacePct - b.pacePct),
    [indicatorMetrics],
  );
  const attention = useMemo(() => rows.filter((r) => r.hasTarget && r.pacePct < 75).slice(0, 6), [rows]);
  const topOrgs = useMemo(
    () => [...(insights.organizations ?? [])].filter((o) => Number(o.target) > 0).sort((a, b) => b.percentage - a.percentage).slice(0, 5),
    [insights.organizations],
  );
  const trend = (insights.trend ?? []) as Array<Record<string, number | string>>;
  const trendSeries = (insights.trendSeries ?? []) as Array<{ color: string; key: string; label: string }>;
  const trendXKey = useMemo(() => {
    if (!trend.length) return undefined;
    const keys = new Set(trendSeries.map((s) => s.key));
    return Object.keys(trend[0]).find((k) => !keys.has(k));
  }, [trend, trendSeries]);
  // Reporting is now indicator-level completeness (reported vs EXPECTED org×indicator
  // cells), with org submission as the compliance split.
  const completeness = reportingAnalysis.completenessPct;
  const compliance = useMemo(
    () => [
      { name: "Submitted", value: reportingAnalysis.orgsSubmitted, color: PERFORMANCE_STATUS_COLORS.met },
      { name: "Not submitted", value: Math.max(0, reportingAnalysis.orgsExpected - reportingAnalysis.orgsSubmitted), color: PERFORMANCE_STATUS_COLORS["off-track"] },
    ],
    [reportingAnalysis.orgsSubmitted, reportingAnalysis.orgsExpected],
  );
  const complianceTotal = reportingAnalysis.orgsExpected;

  // Indicator PACE mix: the portfolio decomposed by achieved-vs-expected-to-date
  // status (not raw annual %), so the pie reflects "who is behind pace", not "it's
  // early in the year". Same SSoT classifier as the KPIs and table.
  const statusMix = useMemo(() => {
    const counts = new Map<PerformanceStatus, number>();
    for (const r of rows) counts.set(r.status.status, (counts.get(r.status.status) ?? 0) + 1);
    return PERFORMANCE_STATUS_ORDER
      .map((s) => ({ name: PERFORMANCE_STATUS_LABELS[s], value: counts.get(s) ?? 0, color: PERFORMANCE_STATUS_COLORS[s] }))
      .filter((slice) => slice.value > 0);
  }, [rows]);
  const targetedCount = useMemo(() => rows.filter((r) => r.hasTarget).length, [rows]);
  const onPaceShare = useMemo(() => {
    if (targetedCount === 0) return 0;
    return Math.round((rows.filter((r) => r.hasTarget && r.pacePct >= 95).length / targetedCount) * 100);
  }, [rows, targetedCount]);

  const cardTitle: Record<string, string> = {
    overall: "Overall Achievement — indicators",
    ontrack: "Indicators On Pace (≥ expected-to-date)",
    offtrack: "Indicators Behind Pace (< expected-to-date)",
    total: "Total Achieved — by indicator",
    reporting: "Organisations Submitted",
    completeness: "Reporting Completeness",
  };
  const dialogRows = useMemo(() => {
    if (openCard === "ontrack") return rows.filter((r) => r.hasTarget && r.pacePct >= 95);
    if (openCard === "offtrack") return rows.filter((r) => r.hasTarget && r.pacePct < 75);
    if (openCard === "total") return [...rows].sort((a, b) => Number(b.value) - Number(a.value));
    return rows; // overall
  }, [openCard, rows]);
  const isOrgCard = openCard === "reporting" || openCard === "completeness";

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Executive Dashboard</h1>
        <p className="text-sm text-muted-foreground">Programme performance overview and insights</p>
      </div>

      {/* Filter cascade */}
      <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
          <FilterSelect label="Project" value={filters.projectId} onChange={setProject}
            options={[{ id: "all", name: "All Projects" }, ...options.projects.map((p) => ({ id: String(p.id), name: String(p.name) }))]} />
          <FilterSelect label="Coordinator" value={filters.coordinatorId} onChange={setCoordinator}
            options={[{ id: "all", name: "All Coordinators" }, ...options.coordinators.map((o: { id: unknown; name?: unknown }) => ({ id: String(o.id), name: String(o.name ?? `Org ${o.id}`) }))]} />
          <FilterSelect label="Organisation" value={filters.organizationId} onChange={(v) => set({ organizationId: v })}
            options={[{ id: "all", name: "All Organisations" }, ...options.organizations.map((o: { id: unknown; name?: unknown }) => ({ id: String(o.id), name: String(o.name ?? `Org ${o.id}`) }))]} />
          <FilterSelect label="District" value={filters.district} onChange={(v) => set({ district: v })}
            options={[{ id: "all", name: "All Districts" }, ...options.districts.map((d: unknown) => ({ id: String(d), name: String(d) }))]} />
          <FilterSelect label="Indicator" value={filters.indicatorId} onChange={(v) => set({ indicatorId: v })}
            options={[{ id: "all", name: "All Indicators" }, ...options.indicators.map((i) => ({ id: String(i.id), name: String(i.name) }))]} />
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Period</label>
            <div className="flex flex-wrap gap-1">
              {presets.map((p) => (
                <button key={p.key} onClick={() => set({ dateFrom: p.from, dateTo: p.to })}
                  className={`rounded-md border px-2 py-1 text-xs ${activePreset === p.key ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-3 flex justify-end">
          <Button variant="outline" size="sm" onClick={() => setFilters(DEFAULT_EXECUTIVE_FILTERS)}>Reset filters</Button>
        </div>
      </div>

      {/* KPI strip — pace-aware, with numerator/denominator visible. */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <KpiCard icon={BarChart3} label="Indicators On Pace" value={`${kpis.onPace} / ${kpis.indicatorsTargeted}`}
          accent={kpis.indicatorsTargeted > 0 ? kpis.overallPaceStatus.color : undefined}
          note={`vs expected · ${periodPct}% of period elapsed`} onClick={() => setOpenCard("ontrack")} />
        <KpiCard icon={Target} label="Overall Achievement"
          value={kpis.targetedOverall ? `${formatPercent(kpis.overallPct)}%` : "—"}
          accent={kpis.targetedOverall ? kpis.overallPaceStatus.color : undefined}
          badge={kpis.targetedOverall ? kpis.overallPaceStatus : undefined}
          note={kpis.targetedOverall ? `${formatWholeNumber(kpis.totalAchieved)} / ${formatWholeNumber(kpis.totalTarget)} · exp ${periodPct}%` : undefined}
          onClick={() => setOpenCard("overall")} />
        <KpiCard icon={AlertTriangle} label="Indicators Behind Pace" value={String(kpis.behindPace)}
          accent={kpis.behindPace > 0 ? PERFORMANCE_STATUS_COLORS["off-track"] : undefined}
          note="< expected-to-date" onClick={() => setOpenCard("offtrack")} />
        <KpiCard icon={Users} label="Organisations Submitted" value={`${reportingAnalysis.orgsSubmitted} / ${reportingAnalysis.orgsExpected}`}
          note="submitted this period" onClick={() => setOpenCard("reporting")} />
        <KpiCard icon={CheckCircle2} label="Reporting Completeness" value={`${completeness}%`}
          note={`${formatWholeNumber(reportingAnalysis.cellsReported)} / ${formatWholeNumber(reportingAnalysis.cellsExpected)} indicator cells`} onClick={() => setOpenCard("completeness")} />
        <KpiCard icon={Database} label="Total Achieved" value={formatWholeNumber(kpis.totalAchieved)}
          note={kpis.dominantShare >= 0.4 ? `${Math.round(kpis.dominantShare * 100)}% is "${kpis.dominantLabel}"` : `vs Target ${formatWholeNumber(kpis.totalTarget)}`}
          onClick={() => setOpenCard("total")} />
      </div>

      {/* Programme Performance + Trend */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-border bg-card p-4 shadow-sm lg:col-span-2">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-foreground">Programme Performance (vs expected-to-date · {periodPct}% elapsed)</h2>
            <Button variant="outline" size="sm" disabled={indicatorMetrics.length === 0}
              onClick={() => downloadMetricsCsv(indicatorMetrics, "executive-performance.csv")}>
              <Download className="mr-2 h-4 w-4" /> Export
            </Button>
          </div>
          {isLoading ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">No indicators with data for this project/period.</p>
          ) : (
            <div className="w-full max-w-full overflow-x-auto">
              <table className="w-full min-w-[680px] border-collapse text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                    <th className="px-2 py-2">Indicator</th>
                    <th className="px-2 py-2 text-right">Achieved / Target</th>
                    <th className="px-2 py-2 text-right">Pace</th>
                    <th className="px-2 py-2">Progress (bar=achieved · line=expected)</th>
                    <th className="px-2 py-2 text-right">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={String(r.indicatorId)} className="border-t border-border">
                      <td className="px-2 py-2.5 text-foreground">
                        <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-muted text-[10px] text-muted-foreground">{i + 1}</span>
                        {r.label}
                      </td>
                      <td className="px-2 py-2.5 text-right tabular-nums text-foreground">
                        {formatWholeNumber(r.value)}{r.hasTarget ? ` / ${formatWholeNumber(r.target)}` : ""}
                      </td>
                      <td className="px-2 py-2.5 text-right font-semibold tabular-nums" style={{ color: r.hasTarget ? r.status.color : undefined }}>
                        {r.hasTarget ? `${formatPercent(r.pacePct)}%` : "—"}
                      </td>
                      <td className="px-2 py-2.5">
                        {/* Bar = achieved as % of annual target (uncapped visually to 100 for
                            layout); the vertical line marks expected-to-date. Bar past the
                            line = ahead of pace, short of it = behind. */}
                        <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-muted">
                          <div className="h-full rounded-full" style={{ width: `${Math.min(Math.max(r.pct, 0), 100)}%`, backgroundColor: r.status.color }} />
                          {r.hasTarget ? (
                            <div className="absolute top-[-2px] h-[calc(100%+4px)] w-0.5 bg-foreground/70" style={{ left: `${Math.min(Math.max(periodFraction * 100, 0), 100)}%` }} />
                          ) : null}
                        </div>
                      </td>
                      <td className="px-2 py-2.5 text-right"><StatusBadge status={r.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-foreground">Volume Trend <span className="font-normal text-muted-foreground">(top indicators, raw counts)</span></h2>
          {trend.length > 0 && trendXKey ? (
            <div className="h-[300px] w-full min-w-0 overflow-hidden">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trend} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                  <CartesianGrid vertical={false} stroke="hsl(var(--border) / 0.45)" />
                  <XAxis dataKey={trendXKey} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} tickLine={false} axisLine={false} width={36} />
                  <Tooltip />
                  {trendSeries.map((s) => <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} dot={false} strokeWidth={2} />)}
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="py-10 text-center text-sm text-muted-foreground">No trend data in scope.</p>
          )}
        </div>
      </div>

      {/* Programme Figures — config-driven funder-report figures for the current
          project (hidden when no project is selected or none is configured).
          These are PROJECT+PERIOD scoped only (funder-report engine); they do not
          follow the coordinator/organisation/district/indicator filters, so we say
          so when one of those is active to avoid a false "filtered" impression. */}
      {(filters.coordinatorId !== "all" || filters.organizationId !== "all" || filters.district !== "all" || filters.indicatorId !== "all") ? (
        <p className="-mb-1 text-[11px] text-muted-foreground">Programme Figures below are project-level (funder-report figures) and are not narrowed by the coordinator/organisation/district/indicator filters.</p>
      ) : null}
      <ProgrammeFigures
        projectId={filters.projectId !== "all" ? Number(filters.projectId) : null}
        periodStart={filters.dateFrom || undefined}
        periodEnd={filters.dateTo || undefined}
      />

      {/* Compliance donut + Performance mix + Top Orgs + Attention */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <h2 className="mb-2 text-sm font-semibold text-foreground">Reporting Compliance</h2>
          <div className="relative h-[220px] w-full min-w-0 overflow-hidden">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={compliance} dataKey="value" nameKey="name" innerRadius={60} outerRadius={88} paddingAngle={2}>
                  {compliance.map((c) => <Cell key={c.name} fill={c.color} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-2xl font-bold text-foreground">{complianceTotal}</span>
              <span className="text-[11px] text-muted-foreground">Organisations</span>
            </div>
          </div>
          <div className="flex flex-wrap justify-center gap-3 text-xs text-muted-foreground">
            {compliance.map((c) => (
              <span key={c.name} className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: c.color }} />
                {c.name} ({c.value})
              </span>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <h2 className="mb-2 text-sm font-semibold text-foreground">Indicator Pace Mix</h2>
          {statusMix.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">No indicator data in scope.</p>
          ) : (
            <>
              <div className="relative h-[220px] w-full min-w-0 overflow-hidden">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={statusMix} dataKey="value" nameKey="name" innerRadius={60} outerRadius={88} paddingAngle={2}>
                      {statusMix.map((slice) => <Cell key={slice.name} fill={slice.color} />)}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-2xl font-bold text-foreground">{onPaceShare}%</span>
                  <span className="text-[11px] text-muted-foreground">on pace</span>
                </div>
              </div>
              <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                {statusMix.map((slice) => (
                  <span key={slice.name} className="inline-flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: slice.color }} />
                    {slice.name} ({slice.value})
                  </span>
                ))}
              </div>
              <p className="mt-2 text-center text-[11px] text-muted-foreground">
                {targetedCount} targeted indicator{targetedCount === 1 ? "" : "s"} · {onPaceShare}% on/ahead of pace ({periodPct}% elapsed)
              </p>
            </>
          )}
        </div>

        <MiniPanel title="Top Performing Organisations">
          {topOrgs.length === 0 ? <EmptyRow text="No organisation targets in scope." /> : (
            <table className="w-full text-sm">
              <tbody>
                {topOrgs.map((o) => (
                  <tr key={o.label} className="border-t border-border first:border-t-0">
                    <td className="py-2 pr-2 text-foreground">{o.label}</td>
                    <td className="py-2 text-right font-semibold tabular-nums" style={{ color: getPerformanceStatusFromValues(o.value, o.target).color }}>{formatPercent(o.percentage)}%</td>
                    <td className="py-2 pl-2 text-right"><StatusBadge status={getPerformanceStatusFromValues(o.value, o.target)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </MiniPanel>

        <MiniPanel title="Indicators Behind Pace">
          {attention.length === 0 ? <EmptyRow text="No indicators behind pace. 🎉" /> : (
            <table className="w-full text-sm">
              <tbody>
                {attention.map((r) => (
                  <tr key={String(r.indicatorId)} className="border-t border-border first:border-t-0">
                    <td className="py-2 pr-2 text-foreground">{r.label}</td>
                    <td className="py-2 text-right font-semibold tabular-nums" style={{ color: r.status.color }}>{formatPercent(r.pacePct)}%</td>
                    <td className="py-2 pl-2 text-right"><StatusBadge status={r.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </MiniPanel>
      </div>

      {/* Reporting gaps by coordinator + district + the non-reporting exception list
          — the two dimensions (coordinator, district) that were previously only
          filterable, plus who has NOT submitted, so gaps are actionable at a glance. */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <MiniPanel title="Reporting by Coordinator (worst first)">
          {reportingAnalysis.byCoordinator.length === 0 ? <EmptyRow text="No coordinators in scope." /> : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                  <th className="py-2 pr-2">Coordinator</th>
                  <th className="py-2 px-2 text-right">Orgs</th>
                  <th className="py-2 pl-2 text-right">Completeness</th>
                </tr>
              </thead>
              <tbody>
                {reportingAnalysis.byCoordinator.map((c) => (
                  <tr key={c.id} className="border-t border-border">
                    <td className="py-2 pr-2 text-foreground">{c.name}</td>
                    <td className="py-2 px-2 text-right tabular-nums text-muted-foreground">{c.orgsReported}/{c.orgsExpected}</td>
                    <td className="py-2 pl-2 text-right font-semibold tabular-nums" style={{ color: getPerformanceStatusFromValues(c.completeness, 100).color }}>{c.completeness}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </MiniPanel>

        <MiniPanel title="Reporting by District (worst first)">
          {reportingAnalysis.byDistrict.length === 0 ? <EmptyRow text="No districts in scope." /> : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                  <th className="py-2 pr-2">District</th>
                  <th className="py-2 px-2 text-right">Orgs submitted</th>
                  <th className="py-2 pl-2 text-right">Reporting</th>
                </tr>
              </thead>
              <tbody>
                {reportingAnalysis.byDistrict.slice(0, 12).map((d) => (
                  <tr key={d.district} className="border-t border-border">
                    <td className="py-2 pr-2 text-foreground">{d.district}</td>
                    <td className="py-2 px-2 text-right tabular-nums text-muted-foreground">{d.orgsReported}/{d.orgsExpected}</td>
                    <td className="py-2 pl-2 text-right font-semibold tabular-nums" style={{ color: getPerformanceStatusFromValues(d.reportingPct, 100).color }}>{d.reportingPct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </MiniPanel>

        <MiniPanel title={`Not Yet Submitted (${notReportedOrganizations.length})`}>
          {notReportedOrganizations.length === 0 ? <EmptyRow text="Every organisation in scope has submitted. 🎉" /> : (
            <ul className="max-h-[220px] space-y-1 overflow-y-auto text-sm">
              {notReportedOrganizations.map((n) => (
                <li key={n} className="text-foreground">{n}</li>
              ))}
            </ul>
          )}
        </MiniPanel>
      </div>

      {/* Recent Submissions */}
      <MiniPanel title="Recent Data Submissions">
        {recentSubmissions.length === 0 ? <EmptyRow text="No submissions in scope." /> : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                <th className="py-2 pr-2">Organisation</th>
                <th className="py-2 px-2">Indicator</th>
                <th className="py-2 px-2">Period</th>
                <th className="py-2 px-2">Submitted</th>
                <th className="py-2 pl-2 text-right">Status</th>
              </tr>
            </thead>
            <tbody>
              {recentSubmissions.map((s, i) => (
                <tr key={`${s.organization}-${s.indicator}-${i}`} className="border-t border-border">
                  <td className="py-2 pr-2 text-foreground">{s.organization}</td>
                  <td className="py-2 px-2 text-muted-foreground">{s.indicator}</td>
                  <td className="py-2 px-2 text-muted-foreground">{s.period}</td>
                  <td className="py-2 px-2 text-muted-foreground">{s.submittedOn}</td>
                  <td className="py-2 pl-2 text-right capitalize text-muted-foreground">{s.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </MiniPanel>

      <Dialog open={openCard !== null} onOpenChange={(o) => { if (!o) setOpenCard(null); }}>
        <DialogContent className="max-h-[80vh] max-w-lg overflow-y-auto">
          <DialogHeader><DialogTitle>{cardTitle[openCard ?? "overall"]}</DialogTitle></DialogHeader>
          {isOrgCard ? (
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="mb-2 font-semibold" style={{ color: PERFORMANCE_STATUS_COLORS.met }}>
                  Reported ({reportedOrganizations.length})
                </p>
                <ul className="space-y-1">
                  {reportedOrganizations.length === 0
                    ? <li className="text-muted-foreground">None</li>
                    : reportedOrganizations.map((n) => <li key={n} className="text-foreground">{n}</li>)}
                </ul>
              </div>
              <div>
                <p className="mb-2 font-semibold" style={{ color: PERFORMANCE_STATUS_COLORS["off-track"] }}>
                  Not reported ({notReportedOrganizations.length})
                </p>
                <ul className="space-y-1">
                  {notReportedOrganizations.length === 0
                    ? <li className="text-muted-foreground">None</li>
                    : notReportedOrganizations.map((n) => <li key={n} className="text-foreground">{n}</li>)}
                </ul>
              </div>
            </div>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {dialogRows.length === 0 ? (
                  <tr><td className="py-4 text-center text-muted-foreground">No indicators in scope.</td></tr>
                ) : (
                  dialogRows.map((r) => (
                    <tr key={String(r.indicatorId)} className="border-t border-border first:border-t-0">
                      <td className="py-2 pr-2 text-foreground">{r.label}</td>
                      <td className="py-2 text-right tabular-nums text-foreground">
                        {openCard === "total"
                          ? `${formatWholeNumber(Number(r.value))} / ${formatWholeNumber(Number(r.target))}`
                          : r.hasTarget ? `${formatPercent(r.pct)}%` : "—"}
                      </td>
                      <td className="py-2 pl-2 text-right"><StatusBadge status={r.status} /></td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MiniPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <h2 className="mb-2 text-sm font-semibold text-foreground">{title}</h2>
      <div className="max-w-full overflow-x-auto">{children}</div>
    </div>
  );
}

function EmptyRow({ text }: { text: string }) {
  return <p className="py-6 text-center text-sm text-muted-foreground">{text}</p>;
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ id: string; name: string }>;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-9 w-full"><SelectValue /></SelectTrigger>
        <SelectContent>
          {options.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}
