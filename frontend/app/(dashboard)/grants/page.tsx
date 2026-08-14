"use client";

import { Fragment, useMemo, useState, type ReactNode } from "react";
import useSWR, { mutate as globalMutate } from "swr";
import { Banknote, Download, Flame, Loader2, Plus, Receipt, ShieldAlert, Wallet } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  KpiStatCard,
  KpiSkeleton,
  type KpiStat,
} from "@/components/analysis/dashboard-primitives";

import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useModulePermissions } from "@/lib/permissions/module-permissions";
import { useToast } from "@/hooks/use-toast";
import { useProjects, useOrganizations } from "@/lib/hooks/use-api";
import {
  grantsService,
  type Grant,
  type GrantDetail,
  type GrantSummary,
  type GrantQuarterly,
  type GrantQuarterRow,
} from "@/lib/api/services/grants";

const ALL = "all";

function toArray<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  const results = (data as { results?: T[] } | undefined)?.results;
  return Array.isArray(results) ? results : [];
}

const CURRENCY = "P"; // Botswana Pula (default BWP)

function money(value: string | number | null | undefined): string {
  const n = Number(value ?? 0);
  return Number.isFinite(n)
    ? n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "0.00";
}

/** Compact currency for headline KPIs, e.g. "P 1.24M". */
function compactMoney(value: string | number | null | undefined): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return `${CURRENCY} 0`;
  const abs = Math.abs(n);
  const fmt = (v: number, suffix: string) =>
    `${CURRENCY} ${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}${suffix}`;
  if (abs >= 1_000_000) return fmt(n / 1_000_000, "M");
  if (abs >= 1_000) return fmt(n / 1_000, "K");
  return fmt(n, "");
}

/** Burn = spent / awarded. Over budget is the risk here. */
function burnColor(pct: number | null): string {
  if (pct === null || pct === undefined) return "#6B7280"; // gray — no award
  if (pct > 100) return "#DC2626"; // red — overspent
  if (pct >= 90) return "#F59E0B"; // amber — near limit
  return "#16A34A"; // green — within budget
}

function BurnBadge({ pct }: { pct: number | null }) {
  if (pct === null || pct === undefined) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="font-semibold tabular-nums" style={{ color: burnColor(pct) }}>
      {pct.toFixed(0)}%
    </span>
  );
}

function downloadSummaryCsv(summary: GrantSummary | undefined) {
  if (!summary) return;
  const header = ["Organization", "Awarded", "Disbursed", "Spent", "Remaining", "Burn%"];
  const lines = summary.organizations.map((r) =>
    [r.organization_name, r.awarded, r.disbursed, r.spent, r.remaining, r.burn_pct ?? ""]
      .map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`)
      .join(","),
  );
  const g = summary.grand_total;
  lines.push(
    ["GRAND TOTAL", g.awarded, g.disbursed, g.spent, g.remaining, g.burn_pct ?? ""]
      .map((c) => `"${String(c ?? "")}"`)
      .join(","),
  );
  const csv = [header.join(","), ...lines].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `grants-summary-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

const STATUS_BADGE: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-800",
  draft: "bg-slate-100 text-slate-700",
  suspended: "bg-amber-100 text-amber-800",
  closed: "bg-slate-200 text-slate-600",
};

export default function GrantsPage() {
  const { canView, can } = useModulePermissions();
  const { toast } = useToast();
  const canAccess = canView("grants");
  const canManage = can("grants", "edit");

  const [projectFilter, setProjectFilter] = useState<string>(ALL);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const filterParams = useMemo(
    () => (projectFilter === ALL ? {} : { project: projectFilter }),
    [projectFilter],
  );

  const { data: summaryData, isLoading: summaryLoading } = useSWR<GrantSummary>(
    canAccess ? ["grants-summary", projectFilter] : null,
    () => grantsService.summary(filterParams),
  );
  const { data: listData, isLoading: listLoading } = useSWR(
    canAccess ? ["grants-list", projectFilter] : null,
    () => grantsService.list(filterParams),
  );

  const { data: projectsRaw } = useProjects();
  const projects = toArray<{ id: number; name: string }>(projectsRaw);
  const grants = toArray<Grant>(listData);

  // Revalidate every grants surface (summary, list, quarterly) after any change.
  const refreshGrants = () =>
    globalMutate((k) => Array.isArray(k) && String(k[0] ?? "").startsWith("grants-"));

  if (!canAccess) {
    return (
      <div className="space-y-6">
        <PageHeader title="Grants" description="Grant and financial accounting" />
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <ShieldAlert className="h-10 w-10 text-muted-foreground" />
            <p className="text-lg font-medium">You do not have access to the grants module.</p>
            <p className="text-sm text-muted-foreground">
              Grant/financial data is restricted. Ask an administrator to grant you access.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const grand = summaryData?.grand_total;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Grants"
        description="Per-organization grant funding vs. money spent"
        actions={
          <div className="flex items-center gap-2">
            <Select value={projectFilter} onValueChange={setProjectFilter}>
              <SelectTrigger className="w-56">
                <SelectValue placeholder="All projects" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All projects</SelectItem>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={() => downloadSummaryCsv(summaryData)} disabled={!summaryData}>
              <Download className="mr-2 h-4 w-4" /> Export CSV
            </Button>
            {canManage && (
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="mr-2 h-4 w-4" /> New grant
              </Button>
            )}
          </div>
        }
      />

      {/* Grand total KPIs (standard executive stat cards) */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {summaryLoading || !grand
          ? Array.from({ length: 4 }).map((_, i) => <KpiSkeleton key={i} />)
          : kpiStats(grand).map((stat) => <KpiStatCard key={stat.key} stat={stat} />)}
      </div>

      {/* Awarded vs spent chart */}
      <Card>
        <CardHeader>
          <CardTitle>Awarded vs. spent, by organization</CardTitle>
        </CardHeader>
        <CardContent>
          {summaryLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <GrantsBurnChart rows={summaryData?.organizations ?? []} />
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            Spend bars are coloured by burn rate (spent ÷ awarded):{" "}
            <span style={{ color: burnColor(50) }}>● within budget</span>,{" "}
            <span style={{ color: burnColor(95) }}>● near limit (90–100%)</span>,{" "}
            <span style={{ color: burnColor(120) }}>● over budget</span>.
          </p>
        </CardContent>
      </Card>

      {/* Per-organization summary */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wallet className="h-4 w-4" /> Target grant vs. achieved spend, by organization
          </CardTitle>
        </CardHeader>
        <CardContent>
          {summaryLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Organization</TableHead>
                  <TableHead className="text-right">Awarded</TableHead>
                  <TableHead className="text-right">Disbursed</TableHead>
                  <TableHead className="text-right">Spent</TableHead>
                  <TableHead className="text-right">Remaining</TableHead>
                  <TableHead className="text-right">Burn</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(summaryData?.organizations ?? []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                      No grants in scope.
                    </TableCell>
                  </TableRow>
                ) : (
                  summaryData!.organizations.map((row) => (
                    <TableRow key={row.organization_id}>
                      <TableCell className="font-medium">{row.organization_name}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(row.awarded)}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(row.disbursed)}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(row.spent)}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(row.remaining)}</TableCell>
                      <TableCell className="text-right"><BurnBadge pct={row.burn_pct} /></TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
              {grand && (
                <tfoot>
                  <TableRow className="border-t-2 font-semibold">
                    <TableCell>GRAND TOTAL ({grand.organization_count})</TableCell>
                    <TableCell className="text-right tabular-nums">{money(grand.awarded)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(grand.disbursed)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(grand.spent)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(grand.remaining)}</TableCell>
                    <TableCell className="text-right"><BurnBadge pct={grand.burn_pct} /></TableCell>
                  </TableRow>
                </tfoot>
              )}
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Quarterly expenditure, grouped by coordinator (rollup) */}
      <QuarterlyExpenditure projectFilter={projectFilter} />

      {/* Grants list */}
      <Card>
        <CardHeader>
          <CardTitle>Grants</CardTitle>
        </CardHeader>
        <CardContent>
          {listLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Grant</TableHead>
                  <TableHead>Organization</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead className="text-right">Awarded</TableHead>
                  <TableHead className="text-right">Spent</TableHead>
                  <TableHead className="text-right">Burn</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {grants.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                      No grants yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  grants.map((g) => (
                    <TableRow
                      key={g.id}
                      className="cursor-pointer"
                      onClick={() => setDetailId(g.id)}
                    >
                      <TableCell className="font-medium">{g.code || g.title || `Grant #${g.id}`}</TableCell>
                      <TableCell>{g.organization_name}</TableCell>
                      <TableCell>{g.project_name}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {g.currency} {money(g.total_amount)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{money(g.financials?.spent)}</TableCell>
                      <TableCell className="text-right"><BurnBadge pct={g.financials?.burn_pct ?? null} /></TableCell>
                      <TableCell>
                        <Badge className={STATUS_BADGE[g.status] ?? ""} variant="secondary">
                          {g.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {detailId !== null && (
        <GrantDetailDialog
          grantId={detailId}
          canManage={canManage}
          onClose={() => setDetailId(null)}
          onChanged={refreshGrants}
        />
      )}

      {createOpen && (
        <GrantFormDialog
          onClose={() => setCreateOpen(false)}
          onSaved={() => {
            setCreateOpen(false);
            refreshGrants();
            toast({ title: "Grant created" });
          }}
        />
      )}
    </div>
  );
}

function kpiStats(grand: GrantSummary["grand_total"]): KpiStat[] {
  const burn = grand.burn_pct;
  return [
    { key: "awarded", label: "Total awarded", value: compactMoney(grand.awarded), icon: Wallet, accent: "#0f766e", helper: `${grand.organization_count} organizations` },
    { key: "disbursed", label: "Disbursed", value: compactMoney(grand.disbursed), icon: Banknote, accent: "#2563eb" },
    { key: "spent", label: "Spent", value: compactMoney(grand.spent), icon: Receipt, accent: "#7c3aed" },
    { key: "burn", label: "Overall burn", value: burn === null ? "—" : `${burn.toFixed(0)}%`, icon: Flame, accent: burnColor(burn), helper: "spent ÷ awarded" },
  ];
}

function GrantsBurnChart({ rows }: { rows: GrantSummary["organizations"] }) {
  const data = useMemo(
    () =>
      [...rows]
        .sort((a, b) => Number(b.awarded) - Number(a.awarded))
        .slice(0, 10)
        .map((r) => ({
          name: r.organization_name,
          awarded: Number(r.awarded),
          spent: Number(r.spent),
          burn: r.burn_pct,
        })),
    [rows],
  );

  if (data.length === 0) {
    return <p className="py-10 text-center text-sm text-muted-foreground">No grants in scope.</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={Math.max(220, data.length * 42)}>
      <BarChart data={data} layout="vertical" margin={{ left: 12, right: 24 }}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} />
        <XAxis type="number" tickFormatter={(v) => compactMoney(v)} fontSize={12} />
        <YAxis type="category" dataKey="name" width={130} fontSize={12} />
        <Tooltip
          formatter={(value: number, key) => [`${CURRENCY} ${money(value)}`, key === "awarded" ? "Awarded" : "Spent"]}
        />
        <Legend />
        <Bar dataKey="awarded" name="Awarded" fill="#CBD5E1" radius={[0, 4, 4, 0]} />
        <Bar dataKey="spent" name="Spent" radius={[0, 4, 4, 0]}>
          {data.map((d, i) => (
            <Cell key={i} fill={burnColor(d.burn)} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function QuarterRow({
  row,
  quarters,
  label,
  bold,
  indent,
}: {
  row: GrantQuarterRow;
  quarters: string[];
  label?: string;
  bold?: boolean;
  indent?: boolean;
}) {
  return (
    <TableRow className={bold ? "bg-muted/40 font-semibold" : undefined}>
      <TableCell className={indent ? "pl-8" : "font-medium"}>{label ?? row.organization_name}</TableCell>
      <TableCell className="text-right tabular-nums">{money(row.awarded)}</TableCell>
      {quarters.map((q) => (
        <TableCell key={q} className="text-right tabular-nums">{money(row.quarters[q])}</TableCell>
      ))}
      <TableCell className="text-right tabular-nums">{money(row.fy_total)}</TableCell>
      <TableCell className="text-right"><BurnBadge pct={row.burn_pct} /></TableCell>
    </TableRow>
  );
}

function QuarterlyExpenditure({ projectFilter }: { projectFilter: string }) {
  const [fy, setFy] = useState<string>("");

  const params = useMemo(() => {
    const p: Record<string, string> = {};
    if (projectFilter !== ALL) p.project = projectFilter;
    if (fy) p.fy = fy;
    return p;
  }, [projectFilter, fy]);

  const { data, isLoading } = useSWR<GrantQuarterly>(
    ["grants-quarterly", projectFilter, fy],
    () => grantsService.quarterly(params),
  );

  const quarters = data?.quarters ?? ["Q1", "Q2", "Q3", "Q4"];
  const hasRows = !!data && (data.coordinators.length > 0 || data.ungrouped.length > 0);
  const fyLabel = (y: number) => `FY ${y}/${String((y + 1) % 100).padStart(2, "0")}`;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle>Quarterly expenditure by organisation (coordinator rollup)</CardTitle>
        {data && data.available_fiscal_years.length > 0 && (
          <Select value={fy || String(data.fiscal_year)} onValueChange={setFy}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Fiscal year" /></SelectTrigger>
            <SelectContent>
              {data.available_fiscal_years.map((y) => (
                <SelectItem key={y} value={String(y)}>{fyLabel(y)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : !hasRows ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No expenditure recorded{projectFilter === ALL ? " — select a project to group by coordinator" : ""}.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Organisation</TableHead>
                <TableHead className="text-right">Awarded</TableHead>
                {quarters.map((q) => (
                  <TableHead key={q} className="text-right">{q}</TableHead>
                ))}
                <TableHead className="text-right">FY total</TableHead>
                <TableHead className="text-right">% spent</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data!.coordinators.map((co) => (
                <Fragment key={co.organization_id}>
                  <QuarterRow row={co} quarters={quarters} bold label={`▾ ${co.organization_name}`} />
                  {co.members.map((m) => (
                    <QuarterRow
                      key={m.organization_id}
                      row={m}
                      quarters={quarters}
                      indent
                      label={m.organization_id === co.organization_id ? `${m.organization_name} (coordinator)` : m.organization_name}
                    />
                  ))}
                </Fragment>
              ))}
              {data!.ungrouped.map((r) => (
                <QuarterRow key={r.organization_id} row={r} quarters={quarters} />
              ))}
            </TableBody>
            <tfoot>
              <TableRow className="border-t-2 font-semibold">
                <TableCell>GRAND TOTAL</TableCell>
                <TableCell className="text-right tabular-nums">{money(data!.grand_total.awarded)}</TableCell>
                {quarters.map((q) => (
                  <TableCell key={q} className="text-right tabular-nums">{money(data!.grand_total.quarters[q])}</TableCell>
                ))}
                <TableCell className="text-right tabular-nums">{money(data!.grand_total.fy_total)}</TableCell>
                <TableCell className="text-right"><BurnBadge pct={data!.grand_total.burn_pct} /></TableCell>
              </TableRow>
            </tfoot>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function GrantDetailDialog({
  grantId,
  canManage,
  onClose,
  onChanged,
}: {
  grantId: number;
  canManage: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const { data, isLoading, mutate } = useSWR<GrantDetail>(["grant", grantId], () =>
    grantsService.get(grantId),
  );
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const [disb, setDisb] = useState({ date: today, amount: "" });
  const [exp, setExp] = useState({ date: today, amount: "", category: "" });
  const [bl, setBl] = useState({ category: "", budgeted_amount: "" });

  const addDisbursement = async () => {
    if (!disb.amount) return;
    setBusy(true);
    try {
      await grantsService.createDisbursement({ grant: grantId, date: disb.date, amount: disb.amount });
      setDisb({ date: today, amount: "" });
      await mutate();
      onChanged();
      toast({ title: "Disbursement recorded" });
    } catch {
      toast({ title: "Could not record disbursement", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const addExpenditure = async () => {
    if (!exp.amount) return;
    setBusy(true);
    try {
      await grantsService.createExpenditure({
        grant: grantId,
        date: exp.date,
        amount: exp.amount,
        category: exp.category,
      });
      setExp({ date: today, amount: "", category: "" });
      await mutate();
      onChanged();
      toast({ title: "Expenditure recorded" });
    } catch {
      toast({ title: "Could not record expenditure", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const addBudgetLine = async () => {
    if (!bl.category || !bl.budgeted_amount) return;
    setBusy(true);
    try {
      await grantsService.createBudgetLine({ grant: grantId, category: bl.category, budgeted_amount: bl.budgeted_amount });
      setBl({ category: "", budgeted_amount: "" });
      await mutate();
      onChanged();
      toast({ title: "Budget line added" });
    } catch {
      toast({ title: "Could not add budget line", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const deleteGrant = async () => {
    if (!window.confirm("Delete this grant and all its budget lines, disbursements and expenditures? This cannot be undone.")) return;
    setBusy(true);
    try {
      await grantsService.remove(grantId);
      toast({ title: "Grant deleted" });
      onChanged();
      onClose();
    } catch {
      toast({ title: "Could not delete grant", variant: "destructive" });
      setBusy(false);
    }
  };

  return (
    <>
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{data?.code || data?.title || `Grant #${grantId}`}</DialogTitle>
            <DialogDescription>
              {data?.organization_name} · {data?.project_name}
            </DialogDescription>
          </DialogHeader>

          {isLoading || !data ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <div className="space-y-5">
              <div className="grid grid-cols-3 gap-3 text-sm">
                <Stat label="Awarded" value={`${data.currency} ${money(data.financials.awarded)}`} />
                <Stat label="Disbursed" value={money(data.financials.disbursed)} />
                <Stat label="Spent" value={money(data.financials.spent)} />
                <Stat label="Budgeted" value={money(data.financials.budgeted)} />
                <Stat label="Remaining" value={money(data.financials.remaining)} />
                <Stat label="Burn" value={<BurnBadge pct={data.financials.burn_pct} />} />
              </div>

              <Section title={`Budget lines (${data.budget_lines.length})`}>
                {data.budget_lines.map((b) => (
                  <Row key={b.id} left={b.category} right={money(b.budgeted_amount)} />
                ))}
              </Section>

              <Section title={`Disbursements (${data.disbursements.length})`}>
                {data.disbursements.map((d) => (
                  <Row key={d.id} left={d.date} right={money(d.amount)} />
                ))}
              </Section>

              <Section title={`Expenditures (${data.expenditures.length})`}>
                {data.expenditures.map((e) => (
                  <Row key={e.id} left={`${e.date} ${e.category}`} right={money(e.amount)} />
                ))}
              </Section>

              {canManage && (
                <div className="space-y-4 rounded-md border p-3">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label className="text-xs">Add disbursement</Label>
                      <Input type="date" value={disb.date} onChange={(e) => setDisb({ ...disb, date: e.target.value })} />
                      <Input type="number" placeholder="Amount" value={disb.amount} onChange={(e) => setDisb({ ...disb, amount: e.target.value })} />
                      <Button size="sm" disabled={busy} onClick={addDisbursement}>
                        {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Record
                      </Button>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs">Add expenditure</Label>
                      <Input type="date" value={exp.date} onChange={(e) => setExp({ ...exp, date: e.target.value })} />
                      <Input placeholder="Category" value={exp.category} onChange={(e) => setExp({ ...exp, category: e.target.value })} />
                      <Input type="number" placeholder="Amount" value={exp.amount} onChange={(e) => setExp({ ...exp, amount: e.target.value })} />
                      <Button size="sm" disabled={busy} onClick={addExpenditure}>
                        {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Record
                      </Button>
                    </div>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                    <div className="space-y-1">
                      <Label className="text-xs">Budget category</Label>
                      <Input placeholder="e.g. Personnel" value={bl.category} onChange={(e) => setBl({ ...bl, category: e.target.value })} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Budgeted amount</Label>
                      <Input type="number" value={bl.budgeted_amount} onChange={(e) => setBl({ ...bl, budgeted_amount: e.target.value })} />
                    </div>
                    <Button size="sm" variant="outline" disabled={busy} onClick={addBudgetLine}>Add budget line</Button>
                  </div>
                </div>
              )}

              {canManage && (
                <div className="flex items-center justify-between border-t pt-3">
                  <Button variant="destructive" size="sm" disabled={busy} onClick={deleteGrant}>Delete grant</Button>
                  <Button variant="outline" size="sm" onClick={() => setEditing(true)}>Edit grant</Button>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {editing && data && (
        <GrantFormDialog
          grant={data}
          onClose={() => setEditing(false)}
          onSaved={async () => {
            setEditing(false);
            await mutate();
            onChanged();
          }}
        />
      )}
    </>
  );
}

const GRANT_STATUSES = ["draft", "active", "suspended", "closed"];

function GrantFormDialog({
  grant,
  onClose,
  onSaved,
}: {
  grant?: GrantDetail | Grant | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const { data: projectsRaw } = useProjects();
  const { data: orgsRaw } = useOrganizations();
  const projects = toArray<{ id: number; name: string }>(projectsRaw);
  const orgs = toArray<{ id: number; name: string }>(orgsRaw);
  const isEdit = !!grant;

  const [form, setForm] = useState({
    project: grant ? String(grant.project) : "",
    organization: grant ? String(grant.organization) : "",
    code: grant?.code ?? "",
    title: grant?.title ?? "",
    total_amount: grant ? String(grant.total_amount ?? "") : "",
    currency: grant?.currency ?? "BWP",
    status: grant?.status ?? "active",
    start_date: grant?.start_date ?? "",
    end_date: grant?.end_date ?? "",
  });
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!form.project || !form.organization || !form.total_amount) {
      toast({ title: "Project, organization and amount are required", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const payload = {
        project: Number(form.project),
        organization: Number(form.organization),
        code: form.code,
        title: form.title,
        total_amount: form.total_amount,
        currency: form.currency,
        status: form.status,
        start_date: form.start_date || null,
        end_date: form.end_date || null,
      };
      if (isEdit && grant) await grantsService.update(grant.id, payload);
      else await grantsService.create(payload);
      onSaved();
    } catch {
      toast({
        title: isEdit ? "Could not update grant" : "Could not create grant (check your access to this org)",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit grant" : "New grant"}</DialogTitle>
          <DialogDescription>Record a funding award to an organization.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Project</Label>
            <Select value={form.project} onValueChange={(v) => setForm({ ...form, project: v })}>
              <SelectTrigger><SelectValue placeholder="Select project" /></SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Organization</Label>
            <Select value={form.organization} onValueChange={(v) => setForm({ ...form, organization: v })}>
              <SelectTrigger><SelectValue placeholder="Select organization" /></SelectTrigger>
              <SelectContent>
                {orgs.map((o) => (
                  <SelectItem key={o.id} value={String(o.id)}>{o.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Grant code</Label>
              <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Title</Label>
              <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Amount</Label>
              <Input type="number" value={form.total_amount} onChange={(e) => setForm({ ...form, total_amount: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Currency</Label>
              <Input value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Status</Label>
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {GRANT_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Start date</Label>
              <Input type="date" value={form.start_date ?? ""} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">End date</Label>
              <Input type="date" value={form.end_date ?? ""} onChange={(e) => setForm({ ...form, end_date: e.target.value })} />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button disabled={busy} onClick={submit}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} {isEdit ? "Save changes" : "Create grant"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-md border p-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const items = Array.isArray(children) ? children : [children];
  return (
    <div>
      <p className="mb-1 text-sm font-medium">{title}</p>
      <div className="divide-y rounded-md border">
        {items.length === 0 ? (
          <p className="p-2 text-sm text-muted-foreground">None recorded.</p>
        ) : (
          children
        )}
      </div>
    </div>
  );
}

function Row({ left, right }: { left: ReactNode; right: ReactNode }) {
  return (
    <div className="flex items-center justify-between px-3 py-1.5 text-sm">
      <span>{left}</span>
      <span className="tabular-nums">{right}</span>
    </div>
  );
}
