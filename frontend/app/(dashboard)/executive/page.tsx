"use client";

// Executive Dashboard (Increment 1): hierarchy-scoped filter cascade
// (Project -> Coordinator -> Organisation -> District -> Indicator -> Period),
// KPI strip, and Programme Performance (Target vs Achieved) table with RAG.
// Data + scoping via useExecutiveData (reuses the home-dashboard hierarchy scope).
import { useMemo, useState } from "react";
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
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatPercent, formatWholeNumber } from "@/components/dashboard/engine/normalize-indicators";
import {
  getPerformanceStatusFromValues,
  PERFORMANCE_STATUS_COLORS,
} from "@/components/dashboard/engine/performance-status";
import { PerformanceStatusPill } from "@/components/dashboard/components/performance-status-pill";
import { downloadMetricsCsv } from "@/lib/dashboard/export-metrics";
import {
  useExecutiveData,
  DEFAULT_EXECUTIVE_FILTERS,
  type ExecutiveFilters,
} from "@/lib/executive/use-executive-data";

function fyPresets(now = new Date()) {
  const fy = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const iso = (y: number, m: number, d: number) =>
    `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const suffix = `${fy}/${String((fy + 1) % 100).padStart(2, "0")}`;
  return [
    { key: "fy", label: `FY ${suffix}`, from: iso(fy, 4, 1), to: iso(fy + 1, 3, 31) },
    { key: "q1", label: "Q1", from: iso(fy, 4, 1), to: iso(fy, 6, 30) },
    { key: "q2", label: "Q2", from: iso(fy, 7, 1), to: iso(fy, 9, 30) },
    { key: "q3", label: "Q3", from: iso(fy, 10, 1), to: iso(fy, 12, 31) },
    { key: "q4", label: "Q4", from: iso(fy + 1, 1, 1), to: iso(fy + 1, 3, 31) },
  ];
}

function KpiCard({
  label,
  value,
  note,
  accent,
}: {
  label: string;
  value: string;
  note?: string;
  accent?: string;
}) {
  return (
    <div className="min-w-0 rounded-2xl border border-border bg-card p-4 shadow-sm">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      <p className="mt-2 text-3xl font-bold tracking-tight" style={accent ? { color: accent } : undefined}>
        {value}
      </p>
      {note ? <p className="mt-1 text-xs text-muted-foreground">{note}</p> : null}
    </div>
  );
}

export default function ExecutiveDashboardPage() {
  const [filters, setFilters] = useState<ExecutiveFilters>(DEFAULT_EXECUTIVE_FILTERS);
  const { insights, indicatorMetrics, kpis, recentSubmissions, isLoading, options } = useExecutiveData(filters);
  const presets = useMemo(() => fyPresets(), []);
  const activePreset = presets.find((p) => p.from === filters.dateFrom && p.to === filters.dateTo)?.key ?? null;

  const set = (patch: Partial<ExecutiveFilters>) => setFilters((f) => ({ ...f, ...patch }));
  // Cascade resets: changing a higher level clears the lower ones.
  const setProject = (v: string) => set({ projectId: v, coordinatorId: "all", organizationId: "all", district: "all" });
  const setCoordinator = (v: string) => set({ coordinatorId: v, organizationId: "all" });

  const rows = useMemo(
    () =>
      [...indicatorMetrics]
        .map((m) => ({
          ...m,
          status: getPerformanceStatusFromValues(Number(m.value), Number(m.target)),
          pct: Number(m.target) > 0 ? (Number(m.value) / Number(m.target)) * 100 : 0,
        }))
        .sort((a, b) => b.pct - a.pct),
    [indicatorMetrics],
  );

  // Indicators requiring attention: at-risk / off-track, worst first.
  const attention = useMemo(
    () => rows.filter((r) => Number(r.target) > 0 && r.pct < 75).sort((a, b) => a.pct - b.pct).slice(0, 6),
    [rows],
  );

  // Top performing organisations (hierarchy-scoped org rollups).
  const topOrgs = useMemo(
    () =>
      [...(insights.organizations ?? [])]
        .filter((o) => Number(o.target) > 0)
        .sort((a, b) => b.percentage - a.percentage)
        .slice(0, 5),
    [insights.organizations],
  );

  // Performance trend: reuse the insights trend/series; x-axis = the non-series key.
  const trend = (insights.trend ?? []) as Array<Record<string, number | string>>;
  const trendSeries = (insights.trendSeries ?? []) as Array<{ color: string; key: string; label: string }>;
  const trendXKey = useMemo(() => {
    if (!trend.length) return undefined;
    const seriesKeys = new Set(trendSeries.map((s) => s.key));
    return Object.keys(trend[0]).find((k) => !seriesKeys.has(k));
  }, [trend, trendSeries]);

  // Reporting compliance (reported vs not-reported across scoped orgs).
  const compliance = useMemo(() => {
    const reported = kpis.reportingOrganizations;
    const notReported = Math.max(0, kpis.scopedOrgCount - reported);
    return [
      { name: "Reported", value: reported, color: PERFORMANCE_STATUS_COLORS.met },
      { name: "Not reported", value: notReported, color: PERFORMANCE_STATUS_COLORS["off-track"] },
    ];
  }, [kpis.reportingOrganizations, kpis.scopedOrgCount]);

  return (
    <div className="space-y-6 p-4 sm:p-6">
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
                <button
                  key={p.key}
                  onClick={() => set({ dateFrom: p.from, dateTo: p.to })}
                  className={`rounded-md border px-2 py-1 text-xs ${activePreset === p.key ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-3 flex justify-end">
          <Button variant="outline" size="sm" onClick={() => setFilters(DEFAULT_EXECUTIVE_FILTERS)}>
            Reset filters
          </Button>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard
          label="Overall Achievement"
          value={kpis.targetedOverall ? `${formatPercent(kpis.overallPct)}%` : "—"}
          accent={kpis.targetedOverall ? kpis.overallStatus.color : undefined}
          note={kpis.targetedOverall ? kpis.overallStatus.label : "no targets in range"}
        />
        <KpiCard
          label="Indicators On Track"
          value={`${kpis.onTrack} / ${kpis.indicatorsTargeted}`}
          note={`${kpis.indicatorCount} indicators in scope`}
        />
        <KpiCard
          label="Reporting Organisations"
          value={`${kpis.reportingOrganizations} / ${kpis.scopedOrgCount}`}
          note="organisations with data in scope"
        />
        <KpiCard
          label="Total Achieved"
          value={formatWholeNumber(kpis.totalAchieved)}
          note={`vs Target ${formatWholeNumber(kpis.totalTarget)}`}
        />
      </div>

      {/* Programme Performance (Target vs Achieved) */}
      <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-foreground">Programme Performance (Target vs Achieved)</h2>
          <Button
            variant="outline"
            size="sm"
            disabled={indicatorMetrics.length === 0}
            onClick={() => downloadMetricsCsv(indicatorMetrics, "executive-performance.csv")}
          >
            <Download className="mr-2 h-4 w-4" /> Export CSV
          </Button>
        </div>
        {isLoading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Loading performance…</p>
        ) : rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No indicators with data in the current scope. Pick a project/coordinator with reported targets.
          </p>
        ) : (
          <div className="w-full max-w-full overflow-x-auto">
            <table className="w-full min-w-[680px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                  <th className="px-3 py-2">Indicator</th>
                  <th className="px-3 py-2 text-right">Achievement</th>
                  <th className="px-3 py-2">Target vs Achieved</th>
                  <th className="px-3 py-2 text-right">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={String(r.indicatorId)} className="border-t border-border first:border-t-0">
                    <td className="px-3 py-2.5 text-foreground">{r.label}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-foreground">
                      {Number(r.target) > 0 ? `${formatPercent(r.pct)}%` : "—"}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${Math.min(Math.max(r.pct, 0), 100)}%`, backgroundColor: r.status.color }}
                        />
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <PerformanceStatusPill status={r.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Increment 2: Performance Trend + Reporting Compliance */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-border bg-card p-4 shadow-sm lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold text-foreground">Performance Trend</h2>
          {trend.length > 0 && trendXKey ? (
            <div className="h-[280px] w-full min-w-0 overflow-hidden">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trend} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
                  <CartesianGrid vertical={false} stroke="hsl(var(--border) / 0.45)" />
                  <XAxis dataKey={trendXKey} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} tickLine={false} axisLine={false} />
                  <Tooltip />
                  {trendSeries.map((s) => (
                    <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} dot={false} strokeWidth={2} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">No trend data in the current scope.</p>
          )}
        </div>
        <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-foreground">Reporting Compliance</h2>
          <div className="h-[220px] w-full min-w-0 overflow-hidden">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={compliance} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={2}>
                  {compliance.map((c) => (
                    <Cell key={c.name} fill={c.color} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex flex-wrap justify-center gap-4 text-xs text-muted-foreground">
            {compliance.map((c) => (
              <span key={c.name} className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: c.color }} />
                {c.name} ({c.value})
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Increment 3: Top Orgs / Attention / Recent Submissions */}
      <div className="grid gap-4 lg:grid-cols-3">
        <MiniPanel title="Top Performing Organisations">
          {topOrgs.length === 0 ? (
            <EmptyRow text="No organisation targets in scope." />
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {topOrgs.map((o) => (
                  <tr key={o.label} className="border-t border-border first:border-t-0">
                    <td className="py-2 pr-2 text-foreground">{o.label}</td>
                    <td className="py-2 text-right tabular-nums text-foreground">{formatPercent(o.percentage)}%</td>
                    <td className="py-2 pl-2 text-right">
                      <PerformanceStatusPill value={o.value} target={o.target} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </MiniPanel>

        <MiniPanel title="Indicators Requiring Attention">
          {attention.length === 0 ? (
            <EmptyRow text="No at-risk or off-track indicators. 🎉" />
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {attention.map((r) => (
                  <tr key={String(r.indicatorId)} className="border-t border-border first:border-t-0">
                    <td className="py-2 pr-2 text-foreground">{r.label}</td>
                    <td className="py-2 text-right tabular-nums text-foreground">{formatPercent(r.pct)}%</td>
                    <td className="py-2 pl-2 text-right">
                      <PerformanceStatusPill status={r.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </MiniPanel>

        <MiniPanel title="Recent Data Submissions">
          {recentSubmissions.length === 0 ? (
            <EmptyRow text="No submissions in scope." />
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {recentSubmissions.map((s, i) => (
                  <tr key={`${s.organization}-${s.indicator}-${i}`} className="border-t border-border first:border-t-0">
                    <td className="py-2 pr-2">
                      <div className="text-foreground">{s.organization}</div>
                      <div className="text-[11px] text-muted-foreground">{s.indicator} · {s.period}</div>
                    </td>
                    <td className="py-2 pl-2 text-right text-[11px] text-muted-foreground">
                      <div>{s.submittedOn}</div>
                      <div className="capitalize">{s.status}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </MiniPanel>
      </div>
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
        <SelectTrigger className="h-9 w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.id} value={o.id}>
              {o.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
