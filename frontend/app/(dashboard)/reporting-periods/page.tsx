"use client";

/**
 * Reporting Period Management — Quarterly Reporting Control Framework (admin).
 *
 * Administrators create per-project quarterly reporting windows and drive their
 * lifecycle: Draft → Scheduled → Open → Closed → Archived, plus late reporting
 * and duplicate-to-next-quarter. Every transition is audited server-side. This
 * page only issues those admin commands and shows progress; all enforcement (who
 * may act, quarter-completion floor, window rules) lives in the backend.
 */
import { useCallback, useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/contexts/auth-context";
import { projectsService } from "@/lib/api";
import {
  reportingPeriodsService,
  type ReportingPeriod,
  type ReportingPeriodProgress,
  type ReportingPeriodStatus,
} from "@/lib/api/services/reportingPeriods";

const QUARTERS = [1, 2, 3, 4];
const STATUS_VARIANT: Record<ReportingPeriodStatus, "default" | "secondary" | "destructive" | "outline"> = {
  open: "default", scheduled: "outline", draft: "outline", closed: "destructive", archived: "secondary",
};

function currentFiscalStartYear(): number {
  const now = new Date();
  // Botswana FY starts 1 April; Jan-Mar belongs to the previous start year.
  return now.getMonth() + 1 >= 4 ? now.getFullYear() : now.getFullYear() - 1;
}

export default function ReportingPeriodsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const isAdmin = user?.role === "admin";

  const [projects, setProjects] = useState<Array<{ id: number | string; name: string; code?: string }>>([]);
  const [projectId, setProjectId] = useState<string>("");
  const [periods, setPeriods] = useState<ReportingPeriod[]>([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<Record<number, ReportingPeriodProgress>>({});

  // Create form
  const [newFy, setNewFy] = useState<string>(String(currentFiscalStartYear()));
  const [newQuarter, setNewQuarter] = useState<string>("1");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    projectsService.list({ status: "active" })
      .then((res) => setProjects((res.results ?? []).map((p) => ({ id: p.id, name: p.name, code: p.code }))))
      .catch(() => setProjects([]));
  }, []);

  const loadPeriods = useCallback(async (pid: string) => {
    if (!pid) { setPeriods([]); return; }
    setLoading(true);
    try {
      const rows = await reportingPeriodsService.list({ project: pid });
      setPeriods(rows);
      const entries = await Promise.all(
        rows.map(async (r) => {
          try { return [r.id, await reportingPeriodsService.progress(r.id)] as const; }
          catch { return null; }
        }),
      );
      setProgress(Object.fromEntries(entries.filter(Boolean) as Array<readonly [number, ReportingPeriodProgress]>));
    } catch {
      toast({ title: "Failed to load reporting periods", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { void loadPeriods(projectId); }, [projectId, loadPeriods]);

  const runAction = useCallback(async (label: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
      toast({ title: label });
      await loadPeriods(projectId);
    } catch (e) {
      toast({ title: `${label} failed`, description: e instanceof Error ? e.message : undefined, variant: "destructive" });
    }
  }, [toast, loadPeriods, projectId]);

  const handleCreate = useCallback(async () => {
    if (!projectId) { toast({ title: "Select a project first", variant: "destructive" }); return; }
    setCreating(true);
    try {
      await reportingPeriodsService.create({
        project: Number(projectId), fiscal_year: Number(newFy), quarter: Number(newQuarter),
      });
      toast({ title: "Reporting period created" });
      await loadPeriods(projectId);
    } catch (e) {
      toast({ title: "Create failed", description: e instanceof Error ? e.message : undefined, variant: "destructive" });
    } finally {
      setCreating(false);
    }
  }, [projectId, newFy, newQuarter, toast, loadPeriods]);

  const totals = useMemo(() => {
    const values = Object.values(progress);
    const eligible = values.reduce((s, p) => s + p.eligible_organizations, 0);
    const submitted = values.reduce((s, p) => s + p.submitted_organizations, 0);
    return { eligible, submitted, pct: eligible ? Math.round((100 * submitted) / eligible) : 0 };
  }, [progress]);

  if (!isAdmin) {
    return (
      <div className="p-6">
        <Card>
          <CardHeader>
            <CardTitle>Reporting Period Management</CardTitle>
            <CardDescription>Administrator access is required to manage reporting windows.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Reporting Period Management</h1>
        <p className="text-muted-foreground">
          Control when organisations may report each quarter. Reporting only opens after a
          quarter has fully elapsed, during the window you set here.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Project</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-4">
          <div className="w-72">
            <Label>Project</Label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger><SelectValue placeholder="Select a project" /></SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>{p.name}{p.code ? ` (${p.code})` : ""}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {projectId && (
            <div className="flex items-end gap-2">
              <div className="w-28">
                <Label>Fiscal year</Label>
                <Input type="number" value={newFy} onChange={(e) => setNewFy(e.target.value)} />
              </div>
              <div className="w-24">
                <Label>Quarter</Label>
                <Select value={newQuarter} onValueChange={setNewQuarter}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {QUARTERS.map((q) => <SelectItem key={q} value={String(q)}>Q{q}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={handleCreate} disabled={creating}>Create period</Button>
            </div>
          )}
        </CardContent>
      </Card>

      {projectId && (
        <Card>
          <CardHeader>
            <CardTitle>Reporting overview</CardTitle>
            <CardDescription>
              {totals.submitted} of {totals.eligible} eligible organisation-submissions received across all periods below.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Progress value={totals.pct} />
            <p className="mt-1 text-sm text-muted-foreground">{totals.pct}% complete</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Reporting periods</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-muted-foreground">Loading…</p>
          ) : periods.length === 0 ? (
            <p className="text-muted-foreground">No reporting periods yet for this project.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Quarter</TableHead>
                  <TableHead>Covers</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Window</TableHead>
                  <TableHead>Completion</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {periods.map((p) => {
                  const prog = progress[p.id];
                  return (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">{p.quarter_label ?? `Q${p.quarter} FY${p.fiscal_year}`}</TableCell>
                      <TableCell className="text-sm">{p.coverage_start} → {p.coverage_end}</TableCell>
                      <TableCell>
                        <Badge variant={STATUS_VARIANT[p.status]}>{p.status}</Badge>
                        {p.allow_late_reporting && <Badge variant="secondary" className="ml-1">late</Badge>}
                      </TableCell>
                      <TableCell className="text-sm">
                        {p.submission_opens ? new Date(p.submission_opens).toLocaleDateString() : "—"}
                        {" – "}
                        {p.submission_closes ? new Date(p.submission_closes).toLocaleDateString() : "—"}
                      </TableCell>
                      <TableCell className="text-sm">
                        {prog ? `${prog.submitted_organizations}/${prog.eligible_organizations} (${prog.completion_percentage}%)` : "—"}
                        {prog && prog.outstanding_organizations > 0 && (
                          <span className="ml-1 text-muted-foreground">· {prog.outstanding_organizations} outstanding</span>
                        )}
                      </TableCell>
                      <TableCell className="space-x-1 text-right">
                        {(p.status === "draft" || p.status === "scheduled" || p.status === "closed") && (
                          <Button size="sm" variant="default"
                            onClick={() => runAction("Reporting opened", () => reportingPeriodsService.open(p.id, {}))}>
                            Open
                          </Button>
                        )}
                        {p.status === "draft" && (
                          <Button size="sm" variant="outline"
                            onClick={() => runAction("Reporting scheduled", () => reportingPeriodsService.schedule(p.id))}>
                            Schedule
                          </Button>
                        )}
                        {p.status === "open" && (
                          <Button size="sm" variant="outline"
                            onClick={() => runAction("Reporting closed", () => reportingPeriodsService.close(p.id))}>
                            Close
                          </Button>
                        )}
                        {(p.status === "closed" || p.status === "archived") && (
                          <Button size="sm" variant="outline"
                            onClick={() => runAction("Reporting reopened", () => reportingPeriodsService.reopen(p.id))}>
                            Reopen
                          </Button>
                        )}
                        {p.allow_late_reporting ? (
                          <Button size="sm" variant="ghost"
                            onClick={() => runAction("Late reporting disabled", () => reportingPeriodsService.disableLate(p.id))}>
                            Disable late
                          </Button>
                        ) : (
                          <Button size="sm" variant="ghost"
                            onClick={() => runAction("Late reporting enabled", () => reportingPeriodsService.enableLate(p.id, {}))}>
                            Enable late
                          </Button>
                        )}
                        {p.status !== "archived" && (
                          <Button size="sm" variant="ghost"
                            onClick={() => runAction("Reporting archived", () => reportingPeriodsService.archive(p.id))}>
                            Archive
                          </Button>
                        )}
                        <Button size="sm" variant="ghost"
                          onClick={() => runAction("Next quarter created", () => reportingPeriodsService.duplicate(p.id))}>
                          Duplicate →
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
