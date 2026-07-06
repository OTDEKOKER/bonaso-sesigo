"use client";

import React, { useMemo, useRef, useState } from "react";
import { Download, Upload, FileSpreadsheet, Loader2, CheckCircle2, AlertTriangle, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useRouter, usePathname } from "next/navigation";
import { useToast } from "@/hooks/use-toast";
import { useProject } from "@/lib/hooks/use-api";
import {
  aggregatesService,
  type ReportingWorkbookImportResult,
} from "@/lib/api/services/aggregates";
import { uploadsService } from "@/lib/api/services/uploads";

type Option = { id: string | number; name?: string; code?: string };
/** Project options carry dates so the dialog can show only projects active in the chosen period. */
type ProjectOption = Option & { start_date?: string; end_date?: string; status?: string };

type ReportingWorkbookDialogProps = {
  projects: ProjectOption[];
  organizations: Option[];
  /** Permission-scoped coordinator organizations (parents). */
  coordinators?: Option[];
  /** Coordinator id → organizations that report under it (self + descendants). */
  organizationsByCoordinator?: Record<string, Option[]>;
  defaultProject?: string;
  defaultOrganization?: string;
  defaultCoordinator?: string;
  onImported?: () => void;
};

const QUARTERS = ["Q1", "Q2", "Q3", "Q4"] as const;

function currentFiscal(): { quarter: string; fiscalYear: number } {
  const now = new Date();
  const month = now.getMonth() + 1; // 1-12
  const year = now.getFullYear();
  // Botswana FY starts in April. Q1=Apr-Jun … Q4=Jan-Mar.
  if (month >= 4 && month <= 6) return { quarter: "Q1", fiscalYear: year };
  if (month >= 7 && month <= 9) return { quarter: "Q2", fiscalYear: year };
  if (month >= 10 && month <= 12) return { quarter: "Q3", fiscalYear: year };
  return { quarter: "Q4", fiscalYear: year - 1 }; // Jan-Mar belongs to prior FY start
}

const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const monthEnd = (y: number, m: number) => new Date(y, m, 0).getDate(); // m is 1-12

/**
 * Inclusive [start, end] ISO range for the selected period. Botswana FY starts in
 * April. Year = whole FY; quarter = that quarter; month = that calendar month.
 */
function periodRange(
  periodType: "quarter" | "year" | "month",
  quarter: string,
  month: string,
  fiscalYear: string,
): { start: string; end: string } | null {
  const fy = Number(fiscalYear);
  if (!Number.isFinite(fy)) return null;
  if (periodType === "year") {
    return { start: iso(fy, 4, 1), end: iso(fy + 1, 3, 31) };
  }
  if (periodType === "month") {
    const m = Number(month);
    if (!m) return null;
    return { start: iso(fy, m, 1), end: iso(fy, m, monthEnd(fy, m)) };
  }
  // quarter
  switch (quarter) {
    case "Q1": return { start: iso(fy, 4, 1), end: iso(fy, 6, 30) };
    case "Q2": return { start: iso(fy, 7, 1), end: iso(fy, 9, 30) };
    case "Q3": return { start: iso(fy, 10, 1), end: iso(fy, 12, 31) };
    case "Q4": return { start: iso(fy + 1, 1, 1), end: iso(fy + 1, 3, 31) };
    default: return null;
  }
}

/** BFS over a parent→children adjacency map; the returned set includes the root. */
function collectSubtree(rootId: string, childrenByParent: Map<string, string[]>): Set<string> {
  const visited = new Set<string>();
  const queue = [rootId];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current)) continue;
    visited.add(current);
    for (const childId of childrenByParent.get(current) || []) {
      if (!visited.has(childId)) queue.push(childId);
    }
  }
  return visited;
}

export function ReportingWorkbookDialog({
  projects,
  organizations,
  coordinators = [],
  organizationsByCoordinator = {},
  defaultProject,
  defaultOrganization,
  defaultCoordinator,
  onImported,
}: ReportingWorkbookDialogProps) {
  const { toast } = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const initial = useMemo(currentFiscal, []);
  const fiscalYears = useMemo(() => {
    const base = initial.fiscalYear;
    return [base - 2, base - 1, base, base + 1];
  }, [initial.fiscalYear]);

  const [open, setOpen] = useState(false);
  const [project, setProject] = useState(defaultProject && defaultProject !== "all" ? defaultProject : "");
  const [organization, setOrganization] = useState(
    defaultOrganization && defaultOrganization !== "all" ? defaultOrganization : "",
  );
  const [coordinator, setCoordinator] = useState(
    defaultCoordinator && defaultCoordinator !== "all" ? defaultCoordinator : "",
  );
  const [quarter, setQuarter] = useState<string>(initial.quarter);
  const [fiscalYear, setFiscalYear] = useState<string>(String(initial.fiscalYear));
  const [periodType, setPeriodType] = useState<"quarter" | "year" | "month">("quarter");
  const [month, setMonth] = useState<string>("4"); // April = FY start

  // Reset every selection back to the default period and a blank project/coordinator/
  // organisation so the user can start the picker fresh.
  const resetFilters = () => {
    setPeriodType("quarter");
    setQuarter(initial.quarter);
    setFiscalYear(String(initial.fiscalYear));
    setMonth("4");
    setProject("");
    setCoordinator("");
    setOrganization("");
  };
  // True when anything has been narrowed from the defaults (drives the button's enabled state).
  const filtersDirty =
    periodType !== "quarter" ||
    quarter !== initial.quarter ||
    fiscalYear !== String(initial.fiscalYear) ||
    month !== "4" ||
    !!project ||
    !!coordinator ||
    !!organization;

  // ── Cascade: Period → Project → Coordinator → Organization ──────────────────
  //
  // 1) Period (fiscal/calendar year + quarter/month) filters which projects show.
  // 2) The chosen project's hierarchy determines the coordinator options.
  // 3) The chosen coordinator determines which organizations (its subtree) show.

  // (1) Projects active during the selected period (date-range overlap).
  const visibleProjects = useMemo(() => {
    const range = periodRange(periodType, quarter, month, fiscalYear);
    if (!range) return projects;
    return projects.filter((p) => {
      const start = p.start_date;
      const end = p.end_date;
      if (!start || !end) return true; // keep projects without a defined range
      return start <= range.end && end >= range.start;
    });
  }, [projects, periodType, quarter, month, fiscalYear]);

  // (2) Fetch the selected project's detail for its hierarchy links.
  const { data: projectDetail } = useProject(project ? Number(project) : null, {
    keepPreviousData: false,
  });
  const activeLinks = useMemo(() => {
    if (!project || String(projectDetail?.id) !== project) return [];
    return (projectDetail?.project_hierarchy_links ?? []).filter((link) => link.is_active);
  }, [project, projectDetail]);

  // Permission universe the page is allowed to act on (writable orgs + coordinators).
  const allowedOrgIds = useMemo(() => {
    const ids = new Set<string>();
    organizations.forEach((o) => ids.add(String(o.id)));
    coordinators.forEach((o) => ids.add(String(o.id)));
    return ids;
  }, [organizations, coordinators]);

  // Coordinator options = hierarchy parents in the selected project (∩ permission scope).
  // Falls back to the page-supplied list when the project has no hierarchy links yet.
  const projectDetailLoaded = !!project && String(projectDetail?.id) === project;
  const coordinatorOptions = useMemo<Option[]>(() => {
    if (activeLinks.length === 0) {
      // A project is selected but its hierarchy hasn't loaded yet: do NOT show
      // the global coordinator fallback (it isn't scoped to this project and can
      // include orgs that don't implement it, e.g. BONELA in NSC 2026/27). Wait
      // for the hierarchy; only use the fallback when no project is selected or
      // the project genuinely has no hierarchy links.
      if (project && !projectDetailLoaded) return [];
      return coordinators;
    }
    const byId = new Map<string, Option>();
    activeLinks.forEach((link) => {
      const id = String(link.parent_organization);
      if (allowedOrgIds.size > 0 && !allowedOrgIds.has(id)) return;
      if (!byId.has(id)) byId.set(id, { id, name: link.parent_organization_name });
    });
    return Array.from(byId.values()).sort((a, b) =>
      String(a.name || "").localeCompare(String(b.name || "")),
    );
  }, [activeLinks, coordinators, allowedOrgIds, project, projectDetailLoaded]);

  // (3) Coordinator → its subtree of organizations, derived from the project hierarchy.
  const orgsByCoordinator = useMemo<Record<string, Option[]>>(() => {
    if (activeLinks.length === 0) return organizationsByCoordinator;
    const childrenByParent = new Map<string, string[]>();
    const nameById = new Map<string, string | undefined>();
    activeLinks.forEach((link) => {
      const parentId = String(link.parent_organization);
      const childId = String(link.child_organization);
      childrenByParent.set(parentId, [...(childrenByParent.get(parentId) || []), childId]);
      nameById.set(parentId, link.parent_organization_name);
      nameById.set(childId, link.child_organization_name);
    });
    const result: Record<string, Option[]> = {};
    coordinatorOptions.forEach((coord) => {
      const ids = collectSubtree(String(coord.id), childrenByParent);
      result[String(coord.id)] = Array.from(ids)
        .filter((id) => allowedOrgIds.size === 0 || allowedOrgIds.has(id))
        .map((id) => ({ id, name: nameById.get(id) }))
        .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
    });
    return result;
  }, [activeLinks, coordinatorOptions, organizationsByCoordinator, allowedOrgIds]);

  // The Organization picker follows the chosen Coordinator: only orgs that report
  // under it (self + descendants). With no coordinator selected, show all writable orgs.
  const scopedOrganizations = useMemo(() => {
    if (coordinator && orgsByCoordinator[coordinator]?.length) {
      return orgsByCoordinator[coordinator];
    }
    return organizations;
  }, [coordinator, orgsByCoordinator, organizations]);

  // Keep the cascade consistent: clear downstream selections that fall out of scope.
  React.useEffect(() => {
    if (project && !visibleProjects.some((p) => String(p.id) === project)) {
      setProject("");
    }
  }, [project, visibleProjects]);
  React.useEffect(() => {
    if (coordinator && !coordinatorOptions.some((o) => String(o.id) === coordinator)) {
      setCoordinator("");
    }
  }, [coordinator, coordinatorOptions]);
  React.useEffect(() => {
    if (organization && !scopedOrganizations.some((o) => String(o.id) === organization)) {
      setOrganization("");
    }
  }, [organization, scopedOrganizations]);

  const [busy, setBusy] = useState<null | "blank" | "data" | "coordinator" | "upload" | "confirm">(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ReportingWorkbookImportResult | null>(null);
  // Success acknowledgement: after a real import, show a confirmation the user
  // must click "OK" on (rather than a transient toast) before we navigate on.
  const [uploadSuccess, setUploadSuccess] = useState<
    { created: number; updated: number; organization: string; quarter: string; navTo: string } | null
  >(null);

  const fyLabel = (startYear: number | string) => {
    const y = Number(startYear);
    return `${y}/${String(y + 1).slice(-2)}`;
  };

  const MONTHS = [
    ["1", "January"], ["2", "February"], ["3", "March"], ["4", "April"],
    ["5", "May"], ["6", "June"], ["7", "July"], ["8", "August"],
    ["9", "September"], ["10", "October"], ["11", "November"], ["12", "December"],
  ] as const;

  const periodReady = Boolean(
    project && fiscalYear &&
    (periodType === "year" || (periodType === "quarter" && quarter) || (periodType === "month" && month)),
  );
  const singleReady = periodReady && Boolean(organization);
  const coordinatorReady = periodReady && Boolean(coordinator);

  const triggerFriendlyError = (err: unknown, fallback: string) => {
    const payload = (err as { payload?: ReportingWorkbookImportResult })?.payload;
    const messages = payload?.messages?.length
      ? payload.messages.join(" ")
      : (err as Error)?.message || fallback;
    toast({ title: payload?.error || fallback, description: messages, variant: "destructive" });
  };

  const handleDownload = async (withData: boolean) => {
    if (!singleReady) {
      toast({ title: "Select project, organization and period first.", variant: "destructive" });
      return;
    }
    setBusy(withData ? "data" : "blank");
    try {
      const blob = await aggregatesService.downloadReportingWorkbook({
        project,
        organization,
        quarter,
        fiscal_year: fiscalYear,
        withData,
        periodType,
        month,
      });
      const selectedOrg = scopedOrganizations.find((o) => String(o.id) === organization);
      const orgName = selectedOrg?.code || selectedOrg?.name || "org";
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `reporting_workbook_${orgName}_${quarter}_${fiscalYear}_${withData ? "data" : "blank"}.xlsx`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      triggerFriendlyError(err, "Failed to download workbook");
    } finally {
      setBusy(null);
    }
  };

  const handleCoordinatorDownload = async () => {
    if (!coordinatorReady) {
      toast({ title: "Select project, coordinator and period first.", variant: "destructive" });
      return;
    }
    setBusy("coordinator");
    try {
      // A coordinator workbook fans out one sheet per sub-organisation plus a
      // cross-sheet TOTAL; for large coordinators it exceeds the gateway timeout
      // and 502s if generated inline. Build it in a background export job and
      // poll for the result instead.
      const job = await uploadsService.createExportJob({
        job_type: "coordinator_workbook",
        parameters: {
          project,
          coordinator,
          quarter,
          fiscal_year: fiscalYear,
          period_type: periodType,
          ...(periodType === "month" ? { month } : {}),
        },
      });
      toast({
        title: "Preparing coordinator workbook…",
        description: "This can take a couple of minutes for large coordinators. The download will start automatically.",
      });

      // Poll until the worker finishes. ~2.5s × 240 = up to 10 minutes, well
      // beyond the synchronous endpoint's ceiling.
      const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
      let current = job;
      for (let attempt = 0; attempt < 240 && (current.status === "pending" || current.status === "processing"); attempt += 1) {
        await sleep(2500);
        current = await uploadsService.getExportJob(job.id);
      }

      if (current.status !== "completed") {
        const detail = Array.isArray(current.errors) && current.errors.length
          ? (current.errors[0] as { detail?: string; error?: string })?.detail
            || (current.errors[0] as { detail?: string; error?: string })?.error
          : undefined;
        throw new Error(
          current.status === "failed"
            ? detail || "Coordinator workbook generation failed."
            : "Coordinator workbook is taking longer than expected. Check back shortly.",
        );
      }

      const blob = await uploadsService.downloadExportJob(job.id);
      const selectedCoord = coordinatorOptions.find((o) => String(o.id) === coordinator);
      const orgName = selectedCoord?.code || selectedCoord?.name || "coordinator";
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = current.file_name || `coordinator_workbook_${orgName}_${quarter}_${fiscalYear}.xlsx`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      triggerFriendlyError(err, "Failed to download coordinator workbook");
    } finally {
      setBusy(null);
    }
  };

  const handleFileSelected = async (file: File) => {
    setPendingFile(file);
    setPreview(null);
    setBusy("upload");
    try {
      // Dry-run first so the user can confirm project/org/quarter/version.
      const result = await aggregatesService.importReportingWorkbook(file, { dryRun: true });
      setPreview(result);
    } catch (err) {
      setPendingFile(null);
      triggerFriendlyError(err, "Workbook Validation Failed");
    } finally {
      setBusy(null);
    }
  };

  const handleConfirmImport = async () => {
    if (!pendingFile) return;
    setBusy("confirm");
    try {
      const result = await aggregatesService.importReportingWorkbook(pendingFile);
      const s = result.summary;

      // Build the destination the user goes to after acknowledging: the aggregates
      // list scoped to exactly the data they just uploaded.
      const base = (pathname || "").startsWith("/training") ? "/training/aggregates" : "/aggregates";
      const params = new URLSearchParams();
      if (s?.project_id) params.set("project", String(s.project_id));
      if (s?.organization_id) params.set("organizations", String(s.organization_id));
      if (s?.period_start) params.set("date_from", s.period_start);
      if (s?.period_end) params.set("date_to", s.period_end);
      const query = params.toString();

      setPendingFile(null);
      setPreview(null);
      setOpen(false);
      onImported?.();
      // Show an explicit success confirmation the user must acknowledge with "OK".
      setUploadSuccess({
        created: s?.created ?? 0,
        updated: s?.updated ?? 0,
        organization: String(s?.organization ?? ""),
        quarter: String(s?.quarter ?? ""),
        navTo: query ? `${base}?${query}` : base,
      });
    } catch (err) {
      triggerFriendlyError(err, "Workbook import failed");
    } finally {
      setBusy(null);
    }
  };

  const acknowledgeUploadSuccess = () => {
    const navTo = uploadSuccess?.navTo;
    setUploadSuccess(null);
    if (navTo) router.push(navTo);
  };

  const summary = preview?.summary;

  return (
    <>
    <Dialog open={open} onOpenChange={(next) => {
      setOpen(next);
      if (!next) { setPendingFile(null); setPreview(null); }
    }}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <FileSpreadsheet className="mr-2 h-4 w-4" /> Reporting Workbook
        </Button>
      </DialogTrigger>
      <DialogContent className="w-[95vw] max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Reporting Workbook</DialogTitle>
          <DialogDescription>
            Download a familiar reporting workbook, fill it in, and upload it. The workbook knows its
            project, organization and quarter — you never enter ID columns.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Clear all selections back to the default period and a blank project/org. */}
          <div className="flex justify-end">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 text-muted-foreground hover:text-foreground"
              onClick={resetFilters}
              disabled={!filtersDirty || busy !== null}
            >
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Clear filters
            </Button>
          </div>

          {/* Step 1 — Period. Drives which projects are shown. */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Period type</Label>
              <Select value={periodType} onValueChange={(v) => setPeriodType(v as "quarter" | "year" | "month")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="year">Yearly</SelectItem>
                  <SelectItem value="quarter">Quarterly</SelectItem>
                  <SelectItem value="month">Monthly</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{periodType === "month" ? "Month" : "Quarter"}</Label>
              {periodType === "month" ? (
                <Select value={month} onValueChange={setMonth}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MONTHS.map(([v, name]) => <SelectItem key={v} value={v}>{name}</SelectItem>)}
                  </SelectContent>
                </Select>
              ) : (
                <Select value={quarter} onValueChange={setQuarter} disabled={periodType === "year"}>
                  <SelectTrigger><SelectValue placeholder={periodType === "year" ? "Full year" : undefined} /></SelectTrigger>
                  <SelectContent>
                    {QUARTERS.map((q) => <SelectItem key={q} value={q}>{q}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>{periodType === "month" ? "Calendar Year" : "Fiscal Year"}</Label>
              <Select value={fiscalYear} onValueChange={setFiscalYear}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {fiscalYears.map((y) => (
                    <SelectItem key={y} value={String(y)}>{periodType === "month" ? String(y) : fyLabel(y)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Step 2 — Project (only those active in the selected period). */}
          <div className="space-y-1.5">
            <Label>Project</Label>
            <Select value={project} onValueChange={setProject}>
              <SelectTrigger><SelectValue placeholder="Select a project" /></SelectTrigger>
              <SelectContent>
                {visibleProjects.length === 0 ? (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">No projects active in this period.</div>
                ) : (
                  visibleProjects.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>{p.name || `Project ${p.id}`}</SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>

          {/* Step 3 — Coordinator (project hierarchy) → Organization (its subtree). */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Coordinator</Label>
              <Select value={coordinator} onValueChange={setCoordinator} disabled={!project}>
                <SelectTrigger><SelectValue placeholder={project ? "Select a coordinator" : "Select a project first"} /></SelectTrigger>
                <SelectContent>
                  {coordinatorOptions.length === 0 ? (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">No coordinators in this project.</div>
                  ) : (
                    coordinatorOptions.map((o) => (
                      <SelectItem key={o.id} value={String(o.id)}>{o.name || `Organization ${o.id}`}</SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">For the coordinator rollup download.</p>
            </div>
            <div className="space-y-1.5">
              <Label>Organization</Label>
              <Select value={organization} onValueChange={setOrganization} disabled={!project}>
                <SelectTrigger>
                  <SelectValue placeholder={!project ? "Select a project first" : coordinator ? "Select a sub-grantee" : "Select an organization"} />
                </SelectTrigger>
                <SelectContent>
                  {scopedOrganizations.map((o) => (
                    <SelectItem key={o.id} value={String(o.id)}>{o.name || `Organization ${o.id}`}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                {coordinator
                  ? "Scoped to the selected coordinator. For the single-organisation download."
                  : "For the single-organisation download."}
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-3 pt-2">
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">Single organisation</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" disabled={!singleReady || busy !== null} onClick={() => handleDownload(false)}>
                {busy === "blank" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                Download Blank
              </Button>
              <Button variant="outline" disabled={!singleReady || busy !== null} onClick={() => handleDownload(true)}>
                {busy === "data" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                Download With Data
              </Button>
            </div>
          </div>
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">Coordinator (a sheet per sub-grantee + a TOTAL rollup)</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" disabled={!coordinatorReady || busy !== null} onClick={handleCoordinatorDownload}>
                {busy === "coordinator" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                Download Coordinator Workbook
              </Button>
            </div>
            {busy === "coordinator" ? (
              <p className="text-xs text-muted-foreground">
                Generating… coordinators with many sub-grantees can take up to a minute. Please keep this open.
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy !== null} onClick={() => fileInputRef.current?.click()}>
              {busy === "upload" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
              Upload Workbook
            </Button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handleFileSelected(file);
              if (fileInputRef.current) fileInputRef.current.value = "";
            }}
          />
        </div>

        {preview && summary && (
          <div className="mt-2 rounded-lg border bg-muted/30 p-4 text-sm">
            <p className="mb-1 flex items-center gap-2 font-semibold">
              <CheckCircle2 className="h-4 w-4 text-green-600" /> Workbook loaded successfully
            </p>
            <p className="mb-2 text-xs text-muted-foreground">
              Check the details below, then submit to open the entries for review — you can view and edit each one before it&apos;s finalised.
            </p>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
              <dt className="text-muted-foreground">Project</dt><dd>{summary.project}</dd>
              <dt className="text-muted-foreground">Organization</dt><dd>{summary.organization}</dd>
              <dt className="text-muted-foreground">Quarter</dt><dd>{summary.quarter}</dd>
              <dt className="text-muted-foreground">Workbook version</dt><dd className="truncate">{summary.workbook_version}</dd>
              <dt className="text-muted-foreground">Indicators with data</dt>
              <dd>{summary.indicators_valid} of {summary.indicators_found}</dd>
            </dl>
            {preview.errors && preview.errors.length > 0 && (
              <div className="mt-3 rounded border border-amber-300 bg-amber-50 p-2 text-amber-800">
                <p className="flex items-center gap-1 font-medium"><AlertTriangle className="h-4 w-4" /> Some rows need attention:</p>
                <ul className="ml-5 list-disc">
                  {preview.errors.slice(0, 8).map((e, i) => (
                    <li key={i}>{String(e.indicator ?? "")}: {e.error}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="mt-3 flex justify-end gap-2">
              <Button variant="outline" onClick={() => { setPreview(null); setPendingFile(null); }}>Cancel</Button>
              <Button disabled={busy !== null || (summary.indicators_valid ?? 0) === 0} onClick={handleConfirmImport}>
                {busy === "confirm" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Submit &amp; Review
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>

    <AlertDialog open={!!uploadSuccess} onOpenChange={(next) => { if (!next) acknowledgeUploadSuccess(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-green-600" /> Report uploaded successfully
          </AlertDialogTitle>
          <AlertDialogDescription>
            {uploadSuccess ? (
              <>
                Your report for <strong>{uploadSuccess.organization}</strong>
                {uploadSuccess.quarter ? <> ({uploadSuccess.quarter})</> : null} was received and
                queued for review — {uploadSuccess.created} created, {uploadSuccess.updated} updated.
              </>
            ) : null}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction onClick={acknowledgeUploadSuccess}>OK</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}

export default ReportingWorkbookDialog;
