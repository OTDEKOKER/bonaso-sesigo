"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, Loader2, RefreshCcw, Search } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PageHeader } from "@/components/shared/page-header";
import { WorkbookImportReview } from "@/components/aggregates/WorkbookImportReview";
import { useAllExportJobs, useAllImportJobs } from "@/lib/hooks/use-api";
import { reportsService, uploadsService } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

const MANUAL_IMPORTS_STORAGE_KEY = "bonaso.manualImportHistory";

type ManualImportRecord = {
  id: string;
  source: string;
  fileName: string;
  importedRows: number;
  failedRows: number;
  status?: "draft" | "validated" | "failed";
  indicatorsCreated?: number;
  periodStart?: string | null;
  periodEnd?: string | null;
  error?: string | null;
  reportGroups?: Array<{
    project: number;
    organization: number;
    period_start: string;
    period_end: string;
  }>;
  validatedAt?: string | null;
  createdAt: string;
};

const STATUS_OPTIONS = [
  { value: "all", label: "All statuses" },
  { value: "uploaded", label: "Uploaded" },
  { value: "analyzing", label: "Analyzing" },
  { value: "ready_for_review", label: "Ready for review" },
  { value: "pending", label: "Pending" },
  { value: "processing", label: "Processing" },
  { value: "validated", label: "Validated" },
  { value: "completed", label: "Completed" },
  { value: "imported", label: "Imported" },
  { value: "failed", label: "Failed" },
];

const formatDateTime = (value?: string | null) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
};

const COMPLETED_STATUSES = new Set(["completed", "imported", "validated"]);
const ACTIVE_STATUSES = new Set(["pending", "uploaded", "analyzing", "ready_for_review", "processing"]);

function importStatusBadgeVariant(status: string) {
  if (status === "failed") return "destructive";
  if (COMPLETED_STATUSES.has(status)) return "default";
  return "secondary";
}

export default function UploadImportsPage() {
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [manualImports, setManualImports] = useState<ManualImportRecord[]>([]);
  const [validatingId, setValidatingId] = useState<string | null>(null);
  const [retryingImportId, setRetryingImportId] = useState<number | null>(null);
  const [retryingExportId, setRetryingExportId] = useState<number | null>(null);
  const [viewingImport, setViewingImport] = useState<ManualImportRecord | null>(null);

  const filters = useMemo(
    () => (statusFilter === "all" ? undefined : { status: statusFilter }),
    [statusFilter],
  );

  const { data: importsData, isLoading, error, mutate } = useAllImportJobs(filters);
  const {
    data: exportsData,
    isLoading: isLoadingExports,
    error: exportError,
    mutate: mutateExports,
  } = useAllExportJobs(filters);
  const imports = useMemo(() => importsData?.results ?? [], [importsData?.results]);
  const exports = useMemo(() => exportsData?.results ?? [], [exportsData?.results]);

  const loadManualImports = () => {
    try {
      const raw = window.localStorage.getItem(MANUAL_IMPORTS_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) {
        setManualImports(parsed as ManualImportRecord[]);
        return;
      }
      setManualImports([]);
    } catch {
      setManualImports([]);
    }
  };

  const persistManualImports = (next: ManualImportRecord[]) => {
    setManualImports(next);
    try {
      window.localStorage.setItem(MANUAL_IMPORTS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore persistence issues
    }
  };

  const updateManualImport = (id: string, updater: (item: ManualImportRecord) => ManualImportRecord) => {
    const next = manualImports.map((item) => (item.id === id ? updater(item) : item));
    persistManualImports(next);
  };

  const handleDeleteManualImport = (id: string) => {
    const next = manualImports.filter((item) => item.id !== id);
    persistManualImports(next);
  };

  const handleEditManualImport = (id: string, currentName: string) => {
    const nextName = window.prompt("Edit import name", currentName || "")?.trim();
    if (!nextName) return;
    updateManualImport(id, (item) => ({ ...item, fileName: nextName }));
  };

  const handleValidateManualImport = async (item: ManualImportRecord) => {
    if (!item.reportGroups?.length) {
      updateManualImport(item.id, (current) => ({ ...current, status: "validated", validatedAt: new Date().toISOString() }));
      toast({ title: "Validated", description: "Import marked as validated." });
      return;
    }

    setValidatingId(item.id);
    let failed = 0;

    try {
      for (const group of item.reportGroups) {
        try {
          const reportName = `Validated Report - Project ${group.project} - Org ${group.organization} - ${group.period_start} to ${group.period_end}`;
          const existing = await reportsService.list({ search: reportName, page_size: "5" });
          const match = existing.results.find((report) => report.name === reportName);
          let reportId = match?.id;

          if (!reportId) {
            const created = await reportsService.create({
              name: reportName,
              type: "indicator_summary",
              parameters: {
                project_id: Number(group.project),
                organization_id: Number(group.organization),
                date_from: group.period_start,
                date_to: group.period_end,
                format: "excel",
              },
            });
            reportId = created.id;
          }

          await reportsService.generate(reportId);
        } catch {
          failed += 1;
        }
      }

      if (failed > 0) {
        toast({
          title: "Validation incomplete",
          description: `${failed} report group(s) failed to generate.`,
          variant: "destructive",
        });
      } else {
        updateManualImport(item.id, (current) => ({ ...current, status: "validated", validatedAt: new Date().toISOString() }));
        toast({ title: "Validated", description: "Import validated and reports generated." });
      }
    } finally {
      setValidatingId(null);
    }
  };

  const handleSetDraft = (id: string) => {
    updateManualImport(id, (item) => ({ ...item, status: "draft", validatedAt: null }));
  };

  const handleRetryImportJob = async (id: number) => {
    setRetryingImportId(id);
    try {
      await uploadsService.retryImportJob(id);
      toast({
        title: "Import restarted",
        description: "The import worker has been queued again.",
      });
      void mutate();
    } catch (error) {
      console.error("Failed to retry import job", error);
      toast({
        title: "Retry failed",
        description: "The import job could not be restarted.",
        variant: "destructive",
      });
    } finally {
      setRetryingImportId(null);
    }
  };

  const handleRetryExportJob = async (id: number) => {
    setRetryingExportId(id);
    try {
      await uploadsService.retryExportJob(id);
      toast({
        title: "Export restarted",
        description: "The export worker has been queued again.",
      });
      void mutateExports();
    } catch (error) {
      console.error("Failed to retry export job", error);
      toast({
        title: "Retry failed",
        description: "The export job could not be restarted.",
        variant: "destructive",
      });
    } finally {
      setRetryingExportId(null);
    }
  };

  const handleDownloadExport = async (id: number, fileName?: string) => {
    try {
      const blob = await uploadsService.downloadExportJob(id);
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = fileName || `export_job_${id}.xlsx`;
      link.rel = "noopener";
      link.style.display = "none";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch (error) {
      console.error("Failed to download export", error);
      toast({
        title: "Download failed",
        description: "The export file could not be downloaded.",
        variant: "destructive",
      });
    }
  };

  useEffect(() => {
    loadManualImports();

    const handleStorage = (event: StorageEvent) => {
      if (event.key === MANUAL_IMPORTS_STORAGE_KEY) {
        loadManualImports();
      }
    };

    const handleVisibility = () => {
      if (!document.hidden) {
        loadManualImports();
      }
    };

    window.addEventListener("storage", handleStorage);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      window.removeEventListener("storage", handleStorage);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  const filteredImports = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return imports;
    return imports.filter((item) => {
      const name = String(item.upload_name || `Upload #${item.upload}`).toLowerCase();
      return name.includes(query) || String(item.id).includes(query);
    });
  }, [imports, search]);

  const filteredManualImports = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return manualImports;
    return manualImports.filter((item) => {
      const name = String(item.fileName || "").toLowerCase();
      return name.includes(query) || String(item.id).toLowerCase().includes(query);
    });
  }, [manualImports, search]);

  const filteredExports = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return exports;
    return exports.filter((item) => {
      const name = String(item.file_name || item.job_type || "").toLowerCase();
      return name.includes(query) || String(item.id).includes(query);
    });
  }, [exports, search]);

  const stats = useMemo(() => {
    const total = imports.length + manualImports.length + exports.length;
    const completed =
      imports.filter((item) => COMPLETED_STATUSES.has(item.status)).length +
      exports.filter((item) => item.status === "completed").length +
      manualImports.filter((item) => item.status === "validated").length;
    const failed =
      imports.filter((item) => item.status === "failed").length +
      exports.filter((item) => item.status === "failed").length +
      manualImports.filter((item) => item.status === "failed").length;
    const processing =
      imports.filter((item) => ACTIVE_STATUSES.has(item.status)).length +
      exports.filter((item) => item.status === "pending" || item.status === "processing").length +
      manualImports.filter((item) => (item.status || "draft") === "draft").length;
    return { total, completed, failed, processing };
  }, [exports, imports, manualImports]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Import and Export Jobs"
        description="View every import/export job and its processing status."
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Uploads", href: "/uploads" },
          { label: "All Imports" },
        ]}
        actions={
          <Button
            variant="outline"
            onClick={() => {
              loadManualImports();
              void mutate();
              void mutateExports();
            }}
            className="gap-2"
          >
            <RefreshCcw className="h-4 w-4" />
            Refresh
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Total Jobs</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{stats.total}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Completed</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{stats.completed}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Processing</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{stats.processing}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Failed</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{stats.failed}</CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Import Jobs</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search by upload name or job ID"
                className="pl-9"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full md:w-56">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {isLoading ? (
            <div className="text-sm text-muted-foreground">Loading import jobs...</div>
          ) : error ? (
            <div className="text-sm text-destructive">Failed to load import jobs.</div>
          ) : filteredImports.length === 0 ? (
            <div className="text-sm text-muted-foreground">No import jobs found.</div>
          ) : (
            <div className="space-y-3">
              {filteredImports.map((job) => (
                <div key={job.id} className="rounded-lg border border-border px-4 py-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="font-medium">{job.upload_name || `Upload #${job.upload}`}</div>
                      <div className="text-xs text-muted-foreground">Job #{job.id}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={importStatusBadgeVariant(job.status)}>
                        {job.status.replace(/_/g, " ")}
                      </Badge>
                      {job.status === "failed" && job.job_type === "aggregate_review_import" ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => void handleRetryImportJob(job.id)}
                          disabled={retryingImportId === job.id}
                        >
                          {retryingImportId === job.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                          Retry
                        </Button>
                      ) : null}
                    </div>
                  </div>
                  <div className="mt-2 grid gap-2 text-xs text-muted-foreground md:grid-cols-2 lg:grid-cols-4">
                    <div>Progress: {job.progress}%</div>
                    <div>Type: {job.job_type?.replace(/_/g, " ") || "upload import"}</div>
                    <div>Rows: {job.processed_rows}/{job.total_rows}</div>
                    <div>Success: {job.successful_rows}</div>
                    <div>Failed: {job.failed_rows}</div>
                    <div>Started: {formatDateTime(job.started_at)}</div>
                    <div>Completed: {formatDateTime(job.completed_at)}</div>
                    <div>Created: {formatDateTime(job.created_at)}</div>
                    <div>
                      Upload:{" "}
                      <Link
                        href={`/uploads?highlight=${job.upload}`}
                        className="text-primary hover:underline"
                      >
                        View upload
                      </Link>
                    </div>
                  </div>
                  {typeof job.result?.log_path === "string" ? (
                    <div className="mt-2 break-all text-xs text-muted-foreground">
                      Worker log: {job.result.log_path}
                    </div>
                  ) : null}
                  {job.status === "failed" && job.errors?.length ? (
                    <div className="mt-2 text-xs text-destructive">
                      Error: {JSON.stringify(job.errors[0])}
                    </div>
                  ) : null}
                  <WorkbookImportReview result={job.result} />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Export Jobs</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoadingExports ? (
            <div className="text-sm text-muted-foreground">Loading export jobs...</div>
          ) : exportError ? (
            <div className="text-sm text-destructive">Failed to load export jobs.</div>
          ) : filteredExports.length === 0 ? (
            <div className="text-sm text-muted-foreground">No export jobs found.</div>
          ) : (
            <div className="space-y-3">
              {filteredExports.map((job) => (
                <div key={job.id} className="rounded-lg border border-border px-4 py-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="font-medium">{job.file_name || job.job_type.replace(/_/g, " ")}</div>
                      <div className="text-xs text-muted-foreground">Export job #{job.id}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={job.status === "completed" ? "default" : job.status === "failed" ? "destructive" : "secondary"}>
                        {job.status.replace(/_/g, " ")}
                      </Badge>
                      {job.status === "completed" && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => void handleDownloadExport(job.id, job.file_name)}
                        >
                          <Download className="mr-2 h-4 w-4" />
                          Download
                        </Button>
                      )}
                      {job.status === "failed" ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => void handleRetryExportJob(job.id)}
                          disabled={retryingExportId === job.id}
                        >
                          {retryingExportId === job.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                          Retry
                        </Button>
                      ) : null}
                    </div>
                  </div>
                  <div className="mt-2 grid gap-2 text-xs text-muted-foreground md:grid-cols-2 lg:grid-cols-4">
                    <div>Type: {job.job_type.replace(/_/g, " ")}</div>
                    <div>Size: {typeof job.result?.size_bytes === "number" ? `${Math.round(job.result.size_bytes / 1024)} KB` : "-"}</div>
                    <div>Started: {formatDateTime(job.started_at)}</div>
                    <div>Completed: {formatDateTime(job.completed_at)}</div>
                    <div>Created: {formatDateTime(job.created_at)}</div>
                  </div>
                  {typeof job.result?.log_path === "string" ? (
                    <div className="mt-2 break-all text-xs text-muted-foreground">
                      Worker log: {job.result.log_path}
                    </div>
                  ) : null}
                  {job.status === "failed" && job.errors?.length ? (
                    <div className="mt-2 text-xs text-destructive">
                      Error: {JSON.stringify(job.errors[0])}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Manual Aggregate Imports</CardTitle>
        </CardHeader>
        <CardContent>
          {filteredManualImports.length === 0 ? (
            <div className="text-sm text-muted-foreground">No manual aggregate imports found.</div>
          ) : (
            <div className="space-y-3">
              {filteredManualImports.map((item) => (
                <div key={item.id} className="rounded-lg border border-border px-4 py-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="font-medium">{item.fileName || "Manual import"}</div>
                      <div className="text-xs text-muted-foreground">{formatDateTime(item.createdAt)}</div>
                    </div>
                    <Badge
                      variant={
                        (item.status || "draft") === "validated"
                          ? "default"
                          : (item.status || "draft") === "failed"
                            ? "destructive"
                            : "secondary"
                      }
                    >
                      {item.status || "draft"}
                    </Badge>
                  </div>
                  <div className="mt-2 grid gap-2 text-xs text-muted-foreground md:grid-cols-2 lg:grid-cols-4">
                    <div>Imported: {item.importedRows}</div>
                    <div>Failed: {item.failedRows}</div>
                    <div>New indicators: {item.indicatorsCreated || 0}</div>
                    <div>
                      Period: {item.periodStart || "-"} to {item.periodEnd || "-"}
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setViewingImport(item)}
                    >
                      View Data
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => handleEditManualImport(item.id, item.fileName || "")}
                    >
                      Edit
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => handleDeleteManualImport(item.id)}
                    >
                      Delete
                    </Button>
                    {(item.status || "draft") !== "validated" ? (
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => void handleValidateManualImport(item)}
                        disabled={validatingId === item.id}
                      >
                        {validatingId === item.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                        Validate
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => handleSetDraft(item.id)}
                      >
                        Draft
                      </Button>
                    )}
                  </div>
                  {item.error ? (
                    <div className="mt-2 text-xs text-destructive">Error: {item.error}</div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={Boolean(viewingImport)} onOpenChange={(open) => !open && setViewingImport(null)}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Manual Import Data</DialogTitle>
            <DialogDescription>
              Read-only details for this import record.
            </DialogDescription>
          </DialogHeader>

          {viewingImport ? (
            <div className="space-y-4 text-sm">
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <p className="font-medium">File Name</p>
                  <p className="text-muted-foreground">{viewingImport.fileName || "-"}</p>
                </div>
                <div>
                  <p className="font-medium">Status</p>
                  <p className="text-muted-foreground">{viewingImport.status || "draft"}</p>
                </div>
                <div>
                  <p className="font-medium">Imported Rows</p>
                  <p className="text-muted-foreground">{viewingImport.importedRows}</p>
                </div>
                <div>
                  <p className="font-medium">Failed Rows</p>
                  <p className="text-muted-foreground">{viewingImport.failedRows}</p>
                </div>
                <div>
                  <p className="font-medium">Indicators Created</p>
                  <p className="text-muted-foreground">{viewingImport.indicatorsCreated || 0}</p>
                </div>
                <div>
                  <p className="font-medium">Created At</p>
                  <p className="text-muted-foreground">{formatDateTime(viewingImport.createdAt)}</p>
                </div>
                <div>
                  <p className="font-medium">Period Start</p>
                  <p className="text-muted-foreground">{viewingImport.periodStart || "-"}</p>
                </div>
                <div>
                  <p className="font-medium">Period End</p>
                  <p className="text-muted-foreground">{viewingImport.periodEnd || "-"}</p>
                </div>
              </div>

              {viewingImport.error ? (
                <div>
                  <p className="font-medium">Error</p>
                  <p className="text-destructive">{viewingImport.error}</p>
                </div>
              ) : null}

              <div>
                <p className="mb-2 font-medium">Report Groups</p>
                {!viewingImport.reportGroups?.length ? (
                  <p className="text-muted-foreground">No report groups recorded.</p>
                ) : (
                  <div className="max-h-56 overflow-auto rounded-md border border-border p-2">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left text-muted-foreground">
                          <th className="p-1">Project</th>
                          <th className="p-1">Organization</th>
                          <th className="p-1">Period Start</th>
                          <th className="p-1">Period End</th>
                        </tr>
                      </thead>
                      <tbody>
                        {viewingImport.reportGroups.map((group, index) => (
                          <tr key={`${group.project}-${group.organization}-${index}`}>
                            <td className="p-1">{group.project}</td>
                            <td className="p-1">{group.organization}</td>
                            <td className="p-1">{group.period_start}</td>
                            <td className="p-1">{group.period_end}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={() => setViewingImport(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
