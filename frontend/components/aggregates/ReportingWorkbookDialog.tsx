"use client";

import React, { useMemo, useRef, useState } from "react";
import { Download, Upload, FileSpreadsheet, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  aggregatesService,
  type ReportingWorkbookImportResult,
} from "@/lib/api/services/aggregates";

type Option = { id: string | number; name?: string; code?: string };

type ReportingWorkbookDialogProps = {
  projects: Option[];
  organizations: Option[];
  defaultProject?: string;
  defaultOrganization?: string;
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

export function ReportingWorkbookDialog({
  projects,
  organizations,
  defaultProject,
  defaultOrganization,
  onImported,
}: ReportingWorkbookDialogProps) {
  const { toast } = useToast();
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
  const [quarter, setQuarter] = useState<string>(initial.quarter);
  const [fiscalYear, setFiscalYear] = useState<string>(String(initial.fiscalYear));

  const [busy, setBusy] = useState<null | "blank" | "data" | "upload" | "confirm">(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ReportingWorkbookImportResult | null>(null);

  const fyLabel = (startYear: number | string) => {
    const y = Number(startYear);
    return `${y}/${String(y + 1).slice(-2)}`;
  };

  const ready = Boolean(project && organization && quarter && fiscalYear);

  const triggerFriendlyError = (err: unknown, fallback: string) => {
    const payload = (err as { payload?: ReportingWorkbookImportResult })?.payload;
    const messages = payload?.messages?.length
      ? payload.messages.join(" ")
      : (err as Error)?.message || fallback;
    toast({ title: payload?.error || fallback, description: messages, variant: "destructive" });
  };

  const handleDownload = async (withData: boolean) => {
    if (!ready) {
      toast({ title: "Select project, organization and quarter first.", variant: "destructive" });
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
      });
      const orgName = organizations.find((o) => String(o.id) === organization)?.code
        || organizations.find((o) => String(o.id) === organization)?.name
        || "org";
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
      toast({
        title: "Workbook imported",
        description: `${s?.created ?? 0} created, ${s?.updated ?? 0} updated for ${s?.organization ?? ""} (${s?.quarter ?? ""}).`,
      });
      setPendingFile(null);
      setPreview(null);
      setOpen(false);
      onImported?.();
    } catch (err) {
      triggerFriendlyError(err, "Workbook import failed");
    } finally {
      setBusy(null);
    }
  };

  const summary = preview?.summary;

  return (
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

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Project</Label>
            <Select value={project} onValueChange={setProject}>
              <SelectTrigger><SelectValue placeholder="Select a project" /></SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>{p.name || `Project ${p.id}`}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Organization</Label>
            <Select value={organization} onValueChange={setOrganization}>
              <SelectTrigger><SelectValue placeholder="Select an organization" /></SelectTrigger>
              <SelectContent>
                {organizations.map((o) => (
                  <SelectItem key={o.id} value={String(o.id)}>{o.name || `Organization ${o.id}`}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Quarter</Label>
            <Select value={quarter} onValueChange={setQuarter}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {QUARTERS.map((q) => <SelectItem key={q} value={q}>{q}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Fiscal Year</Label>
            <Select value={fiscalYear} onValueChange={setFiscalYear}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {fiscalYears.map((y) => (
                  <SelectItem key={y} value={String(y)}>{fyLabel(y)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 pt-2">
          <Button variant="outline" disabled={!ready || busy !== null} onClick={() => handleDownload(false)}>
            {busy === "blank" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
            Download Blank
          </Button>
          <Button variant="outline" disabled={!ready || busy !== null} onClick={() => handleDownload(true)}>
            {busy === "data" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
            Download With Data
          </Button>
          <Button disabled={busy !== null} onClick={() => fileInputRef.current?.click()}>
            {busy === "upload" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
            Upload Workbook
          </Button>
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
            <p className="mb-2 flex items-center gap-2 font-semibold">
              <CheckCircle2 className="h-4 w-4 text-green-600" /> Ready to import
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
                Confirm Import
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default ReportingWorkbookDialog;
