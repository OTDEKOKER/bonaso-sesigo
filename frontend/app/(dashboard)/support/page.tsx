"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import { LifeBuoy, Loader2, Plus, AlertTriangle } from "lucide-react";
import {
  supportService,
  SUPPORT_CATEGORIES,
  SUPPORT_STATUSES,
  SUPPORT_SEVERITIES,
  type SupportTicket,
  type SupportStats,
} from "@/lib/api";
import { useOrganizations, useAllProjects } from "@/lib/hooks/use-api";
import { useToast } from "@/hooks/use-toast";

const STATUS_STYLES: Record<string, string> = {
  new: "bg-blue-100 text-blue-800",
  acknowledged: "bg-indigo-100 text-indigo-800",
  investigating: "bg-amber-100 text-amber-800",
  awaiting_user: "bg-purple-100 text-purple-800",
  resolved: "bg-green-100 text-green-800",
  closed: "bg-gray-200 text-gray-700",
  reopened: "bg-red-100 text-red-800",
};

const SEVERITY_STYLES: Record<string, string> = {
  low: "bg-gray-100 text-gray-700",
  medium: "bg-blue-100 text-blue-800",
  high: "bg-amber-100 text-amber-800",
  critical: "bg-red-100 text-red-800",
};

const EMPTY_FORM = {
  title: "",
  description: "",
  category: "other",
  severity: "medium" as const,
  affected_organization: "",
  affected_project: "",
  reporting_period_label: "",
  related_reference: "",
};

export default function SupportPage() {
  const router = useRouter();
  const { toast } = useToast();

  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [stats, setStats] = useState<SupportStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [openOnly, setOpenOnly] = useState(true);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });

  const { data: orgData } = useOrganizations({ page_size: "1000" });
  const { data: projectData } = useAllProjects();
  const organizations = orgData?.results ?? [];
  const projects = projectData?.results ?? [];

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const filters: Record<string, string> = {};
      if (statusFilter !== "all") filters.status = statusFilter;
      if (categoryFilter !== "all") filters.category = categoryFilter;
      if (search.trim()) filters.search = search.trim();
      if (openOnly && statusFilter === "all") filters.open = "true";
      const [list, s] = await Promise.all([
        supportService.list({ ...filters, page_size: "200" }),
        supportService.stats().catch(() => null),
      ]);
      setTickets(list.results ?? []);
      setStats(s);
    } catch (err) {
      toast({
        title: "Could not load tickets",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [statusFilter, categoryFilter, search, openOnly, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const canSubmit = form.title.trim().length > 2 && form.description.trim().length > 2;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const created = await supportService.create({
        title: form.title.trim(),
        description: form.description.trim(),
        category: form.category,
        severity: form.severity,
        affected_organization: form.affected_organization
          ? Number(form.affected_organization)
          : null,
        affected_project: form.affected_project ? Number(form.affected_project) : null,
        reporting_period_label: form.reporting_period_label.trim(),
        related_reference: form.related_reference.trim(),
      });
      toast({ title: "Ticket submitted", description: `Ticket #${created.id} was created.` });
      setDialogOpen(false);
      setForm({ ...EMPTY_FORM });
      router.push(`/support/${created.id}`);
    } catch (err) {
      toast({
        title: "Could not submit ticket",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const statCards = useMemo(
    () => [
      { label: "Total", value: stats?.total ?? 0 },
      { label: "Open", value: stats?.open ?? 0 },
      { label: "Unassigned", value: stats?.unassigned_open ?? 0 },
      { label: "Overdue", value: stats?.overdue ?? 0, alert: (stats?.overdue ?? 0) > 0 },
    ],
    [stats],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Support"
        description="Report a problem or track help-desk tickets for your organisation."
        actions={
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> New ticket
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {statCards.map((c) => (
          <Card key={c.label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {c.label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div
                className={`text-2xl font-bold ${c.alert ? "text-red-600" : ""}`}
              >
                {c.value}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 pt-6">
          <div className="w-full sm:w-64">
            <Label className="text-xs">Search</Label>
            <Input
              placeholder="Search title or description…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="w-40">
            <Label className="text-xs">Status</Label>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {SUPPORT_STATUSES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-48">
            <Label className="text-xs">Category</Label>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {SUPPORT_CATEGORIES.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            variant={openOnly ? "default" : "outline"}
            onClick={() => setOpenOnly((v) => !v)}
            disabled={statusFilter !== "all"}
          >
            Open only
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading tickets…
            </div>
          ) : tickets.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
              <LifeBuoy className="h-8 w-8" />
              <p>No tickets found.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3">#</th>
                    <th className="px-4 py-3">Title</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Category</th>
                    <th className="px-4 py-3">Severity</th>
                    <th className="px-4 py-3">Organisation</th>
                    <th className="px-4 py-3">Assignee</th>
                    <th className="px-4 py-3">Reported</th>
                  </tr>
                </thead>
                <tbody>
                  {tickets.map((t) => (
                    <tr
                      key={t.id}
                      className="cursor-pointer border-b hover:bg-muted/50"
                      onClick={() => router.push(`/support/${t.id}`)}
                    >
                      <td className="px-4 py-3 font-mono text-xs">{t.id}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2 font-medium">
                          {t.is_overdue && (
                            <AlertTriangle className="h-4 w-4 text-red-500" aria-label="Overdue" />
                          )}
                          <span className="line-clamp-1">{t.title}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <Badge className={STATUS_STYLES[t.status] ?? ""} variant="secondary">
                          {t.status_display}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">{t.category_display}</td>
                      <td className="px-4 py-3">
                        <Badge className={SEVERITY_STYLES[t.severity] ?? ""} variant="secondary">
                          {t.severity_display}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">{t.affected_organization_name ?? "—"}</td>
                      <td className="px-4 py-3">{t.assigned_to_name ?? "Unassigned"}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                        {new Date(t.created_at).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Report a problem</DialogTitle>
            <DialogDescription>
              Describe the issue. Support staff are notified automatically.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Title *</Label>
              <Input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="Short summary of the issue"
              />
            </div>
            <div>
              <Label>Description *</Label>
              <Textarea
                value={form.description}
                rows={4}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="What happened? What did you expect? Include the period and steps if relevant."
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Category</Label>
                <Select
                  value={form.category}
                  onValueChange={(v) => setForm({ ...form, category: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SUPPORT_CATEGORIES.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Severity</Label>
                <Select
                  value={form.severity}
                  onValueChange={(v) =>
                    setForm({ ...form, severity: v as typeof form.severity })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SUPPORT_SEVERITIES.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Organisation</Label>
                <Select
                  value={form.affected_organization || "none"}
                  onValueChange={(v) =>
                    setForm({ ...form, affected_organization: v === "none" ? "" : v })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Optional" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Not specified</SelectItem>
                    {organizations.map((o) => (
                      <SelectItem key={o.id} value={String(o.id)}>
                        {o.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Project</Label>
                <Select
                  value={form.affected_project || "none"}
                  onValueChange={(v) =>
                    setForm({ ...form, affected_project: v === "none" ? "" : v })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Optional" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Not specified</SelectItem>
                    {projects.map((p) => (
                      <SelectItem key={p.id} value={String(p.id)}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Reporting period</Label>
                <Input
                  value={form.reporting_period_label}
                  onChange={(e) =>
                    setForm({ ...form, reporting_period_label: e.target.value })
                  }
                  placeholder="e.g. Q1 FY2026/27"
                />
              </div>
              <div>
                <Label>Related reference</Label>
                <Input
                  value={form.related_reference}
                  onChange={(e) => setForm({ ...form, related_reference: e.target.value })}
                  placeholder="Upload id, report id…"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={!canSubmit || submitting}>
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Submit ticket
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
