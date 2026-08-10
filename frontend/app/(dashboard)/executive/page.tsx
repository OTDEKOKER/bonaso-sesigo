"use client";

// Executive Dashboard (Increment 1): hierarchy-scoped filter cascade
// (Project -> Coordinator -> Organisation -> District -> Indicator -> Period),
// KPI strip, and Programme Performance (Target vs Achieved) table with RAG.
// Data + scoping via useExecutiveData (reuses the home-dashboard hierarchy scope).
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatPercent, formatWholeNumber } from "@/components/dashboard/engine/normalize-indicators";
import { getPerformanceStatusFromValues } from "@/components/dashboard/engine/performance-status";
import { PerformanceStatusPill } from "@/components/dashboard/components/performance-status-pill";
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
  const { indicatorMetrics, kpis, isLoading, options } = useExecutiveData(filters);
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
        <h2 className="mb-3 text-sm font-semibold text-foreground">Programme Performance (Target vs Achieved)</h2>
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
    </div>
  );
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
