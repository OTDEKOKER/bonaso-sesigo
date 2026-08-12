"use client";

import { useMemo, useState, type ReactNode } from "react";
import useSWR from "swr";
import { Download, Loader2, Plus, ShieldAlert, Wallet } from "lucide-react";

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
} from "@/lib/api/services/grants";

const ALL = "all";

function toArray<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  const results = (data as { results?: T[] } | undefined)?.results;
  return Array.isArray(results) ? results : [];
}

function money(value: string | number | null | undefined): string {
  const n = Number(value ?? 0);
  return Number.isFinite(n)
    ? n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "0.00";
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
  const { data: listData, isLoading: listLoading, mutate: mutateList } = useSWR(
    canAccess ? ["grants-list", projectFilter] : null,
    () => grantsService.list(filterParams),
  );

  const { data: projectsRaw } = useProjects();
  const projects = toArray<{ id: number; name: string }>(projectsRaw);
  const grants = toArray<Grant>(listData);

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

      {/* Grand total KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Total awarded" value={grand ? money(grand.awarded) : "—"} loading={summaryLoading} />
        <KpiCard label="Disbursed" value={grand ? money(grand.disbursed) : "—"} loading={summaryLoading} />
        <KpiCard label="Spent" value={grand ? money(grand.spent) : "—"} loading={summaryLoading} />
        <KpiCard
          label="Overall burn"
          value={grand ? <BurnBadge pct={grand.burn_pct} /> : "—"}
          loading={summaryLoading}
        />
      </div>

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
          onChanged={() => mutateList()}
        />
      )}

      {createOpen && (
        <CreateGrantDialog
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            setCreateOpen(false);
            mutateList();
            toast({ title: "Grant created" });
          }}
        />
      )}
    </div>
  );
}

function KpiCard({
  label,
  value,
  loading,
}: {
  label: string;
  value: ReactNode;
  loading?: boolean;
}) {
  return (
    <Card>
      <CardContent className="py-5">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        {loading ? (
          <Skeleton className="mt-2 h-7 w-24" />
        ) : (
          <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
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
  const today = new Date().toISOString().slice(0, 10);
  const [disb, setDisb] = useState({ date: today, amount: "" });
  const [exp, setExp] = useState({ date: today, amount: "", category: "" });

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

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
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
              <div className="grid gap-4 rounded-md border p-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label className="text-xs">Add disbursement</Label>
                  <Input type="date" value={disb.date} onChange={(e) => setDisb({ ...disb, date: e.target.value })} />
                  <Input
                    type="number"
                    placeholder="Amount"
                    value={disb.amount}
                    onChange={(e) => setDisb({ ...disb, amount: e.target.value })}
                  />
                  <Button size="sm" disabled={busy} onClick={addDisbursement}>
                    {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Record
                  </Button>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Add expenditure</Label>
                  <Input type="date" value={exp.date} onChange={(e) => setExp({ ...exp, date: e.target.value })} />
                  <Input
                    placeholder="Category"
                    value={exp.category}
                    onChange={(e) => setExp({ ...exp, category: e.target.value })}
                  />
                  <Input
                    type="number"
                    placeholder="Amount"
                    value={exp.amount}
                    onChange={(e) => setExp({ ...exp, amount: e.target.value })}
                  />
                  <Button size="sm" disabled={busy} onClick={addExpenditure}>
                    {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Record
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CreateGrantDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const { toast } = useToast();
  const { data: projectsRaw } = useProjects();
  const { data: orgsRaw } = useOrganizations();
  const projects = toArray<{ id: number; name: string }>(projectsRaw);
  const orgs = toArray<{ id: number; name: string }>(orgsRaw);

  const [form, setForm] = useState({
    project: "",
    organization: "",
    code: "",
    total_amount: "",
    currency: "BWP",
    status: "active",
  });
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!form.project || !form.organization || !form.total_amount) {
      toast({ title: "Project, organization and amount are required", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      await grantsService.create({
        project: Number(form.project),
        organization: Number(form.organization),
        code: form.code,
        total_amount: form.total_amount,
        currency: form.currency,
        status: form.status,
      });
      onCreated();
    } catch {
      toast({ title: "Could not create grant (check your access to this org)", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New grant</DialogTitle>
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
              <Label className="text-xs">Amount ({form.currency})</Label>
              <Input
                type="number"
                value={form.total_amount}
                onChange={(e) => setForm({ ...form, total_amount: e.target.value })}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button disabled={busy} onClick={submit}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Create grant
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
