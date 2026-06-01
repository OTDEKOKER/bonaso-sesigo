"use client";

import { useEffect, useState } from "react";
import { Download, FileSearch, List, Loader2, Pencil, Plus, Search, Trash2 } from "lucide-react";

import { cleanLabel, formatAnalyticsValue, triggerBlobDownload } from "@/components/analysis/analytics-utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { lineListsService, type LineList, type LineListRequest } from "@/lib/api";
import {
  useAllOrganizations,
  useAllProjects,
  useAssessments,
  useLineList,
  useLineLists,
} from "@/lib/hooks/use-api";
import { formatDate } from "@/lib/date-utils";

const EMPTY_LINE_LISTS: never[] = [];

type LineListDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => Promise<void>;
  existing?: LineList | null;
  backendUnavailable?: boolean;
};

function isBackendUnavailable(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    (error as { status?: unknown }).status === 404 &&
    "message" in error &&
    typeof (error as { message?: unknown }).message === "string" &&
    (error as { message: string }).message.toLowerCase().includes("not available on this backend")
  );
}

function LineListSettingsDialog(props: LineListDialogProps) {
  const { open, onOpenChange, onSaved, existing, backendUnavailable = false } = props;
  const { toast } = useToast();
  const { data: assessmentsData } = useAssessments({ page_size: "200" });
  const { data: organizationsData } = useAllOrganizations();
  const { data: projectsData } = useAllProjects();

  const assessments = assessmentsData?.results ?? [];
  const organizations = organizationsData?.results ?? [];
  const projects = projectsData?.results ?? [];

  const [name, setName] = useState("");
  const [assessmentId, setAssessmentId] = useState("all");
  const [projectId, setProjectId] = useState("all");
  const [organizationId, setOrganizationId] = useState("all");
  const [cascadeOrganization, setCascadeOrganization] = useState(false);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(existing?.name || "");
    setAssessmentId(existing?.assessment ? String(existing.assessment) : "all");
    setProjectId(existing?.project ? String(existing.project) : "all");
    setOrganizationId(existing?.organization ? String(existing.organization) : "all");
    setCascadeOrganization(Boolean(existing?.cascade_organization));
    setStart(existing?.start || "");
    setEnd(existing?.end || "");
  }, [existing, open]);

  const handleSave = async () => {
    if (backendUnavailable) {
      toast({
        title: "Preview only",
        description: "Line lists are not available on this backend yet.",
      });
      return;
    }

    if (!name.trim()) {
      toast({
        title: "Name required",
        description: "Add a line list name before saving.",
        variant: "destructive",
      });
      return;
    }

    const payload: LineListRequest = {
      name: name.trim(),
      assessment: assessmentId !== "all" ? Number(assessmentId) : null,
      project: projectId !== "all" ? Number(projectId) : null,
      organization: organizationId !== "all" ? Number(organizationId) : null,
      cascade_organization: organizationId !== "all" ? cascadeOrganization : false,
      start: start || null,
      end: end || null,
    };

    setSaving(true);
    try {
      if (existing?.id) {
        await lineListsService.update(existing.id, payload);
      } else {
        await lineListsService.create(payload);
      }
      await onSaved();
      onOpenChange(false);
      toast({
        title: existing?.id ? "Line list updated" : "Line list created",
        description: name.trim(),
      });
    } catch (error) {
      if (!isBackendUnavailable(error)) {
        console.error("Failed to save line list", error);
      }
      toast({
        title: "Save failed",
        description: error instanceof Error ? error.message : "Unable to save this line list.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{existing?.id ? "Edit Line List" : "New Line List"}</DialogTitle>
          <DialogDescription>Save a reusable line-by-line export view for assessment responses.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          {backendUnavailable ? (
            <div className="rounded-lg border border-[var(--green-primary)]/30 bg-[var(--green-primary)]/8 px-4 py-3 text-sm text-foreground">
              Line lists are in preview mode because this backend does not support saving them yet.
            </div>
          ) : null}

          <div className="grid gap-2">
            <Label htmlFor="line-list-name">Name</Label>
            <Input id="line-list-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="GBV assessment line list" />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="grid gap-2">
              <Label>Assessment</Label>
              <Select value={assessmentId} onValueChange={setAssessmentId}>
                <SelectTrigger>
                  <SelectValue placeholder="All assessments" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All assessments</SelectItem>
                  {assessments.map((assessment) => (
                    <SelectItem key={assessment.id} value={String(assessment.id)}>
                      {assessment.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label>Project</Label>
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger>
                  <SelectValue placeholder="All projects" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All projects</SelectItem>
                  {projects.map((project) => (
                    <SelectItem key={project.id} value={String(project.id)}>
                      {project.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="grid gap-2">
              <Label>Organization</Label>
              <Select value={organizationId} onValueChange={setOrganizationId}>
                <SelectTrigger>
                  <SelectValue placeholder="All organizations" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All organizations</SelectItem>
                  {organizations.map((organization) => (
                    <SelectItem key={organization.id} value={String(organization.id)}>
                      {organization.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label>Date Range</Label>
              <div className="grid grid-cols-2 gap-2">
                <Input type="date" value={start} onChange={(event) => setStart(event.target.value)} />
                <Input type="date" value={end} onChange={(event) => setEnd(event.target.value)} />
              </div>
            </div>
          </div>

          {organizationId !== "all" ? (
            <label className="flex items-center gap-3 rounded-lg border px-3 py-3 text-sm">
              <Checkbox
                checked={cascadeOrganization}
                onCheckedChange={(checked) => setCascadeOrganization(checked === true)}
              />
              <span>Include subgrantees</span>
            </label>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || backendUnavailable}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {backendUnavailable ? "Preview Only" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function LineListsWorkspace() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const { data: lineListsData, mutate: mutateLineLists, isLoading: listLoading, error: listError } = useLineLists({
    search,
    page,
  });
  const lineListsUnavailable = isBackendUnavailable(listError);
  const availableLineListIds = lineListsData?.results?.map((list) => list.id) ?? EMPTY_LINE_LISTS;
  const selectedLineListFetchId =
    !selectedId ||
    (availableLineListIds.length > 0 && !availableLineListIds.includes(selectedId))
      ? null
      : selectedId;
  const { data: selectedLineList, mutate: mutateSelectedLineList, isLoading: detailLoading } = useLineList(selectedLineListFetchId);
  const dashboardBreakdowns = undefined;

  const lineLists = lineListsData?.results ?? EMPTY_LINE_LISTS;
  const currentLineList = selectedLineList ?? lineLists.find((list) => list.id === selectedId) ?? null;
  const totalCount = lineListsData?.count ?? 0;
  const hasNextPage = Boolean(lineListsData?.next);
  const hasPrevPage = Boolean(lineListsData?.previous);

  useEffect(() => {
    if (lineLists.length === 0) {
      setSelectedId(null);
      return;
    }

    if (!selectedId || !lineLists.some((list) => list.id === selectedId)) {
      setSelectedId(lineLists[0].id);
    }
  }, [lineLists, selectedId]);

  const handleRefresh = async () => {
    await Promise.all([mutateLineLists(), mutateSelectedLineList()]);
  };

  const handleDelete = async () => {
    if (!selectedId) return;
    setDeleting(true);
    try {
      await lineListsService.delete(selectedId);
      await mutateLineLists();
      setSelectedId(null);
      toast({
        title: "Line list deleted",
        description: "The saved line list has been removed.",
      });
    } catch (error) {
      console.error("Failed to delete line list", error);
      toast({
        title: "Delete failed",
        description: error instanceof Error ? error.message : "Unable to delete this line list.",
        variant: "destructive",
      });
    } finally {
      setDeleting(false);
    }
  };

  const handleDownload = async () => {
    if (!selectedId) return;
    setDownloading(true);
    try {
      const blob = await lineListsService.download(selectedId);
      const safeName = (currentLineList?.display_name || currentLineList?.name || "line_list")
        .replace(/[^a-z0-9_-]+/gi, "_")
        .slice(0, 60);
      triggerBlobDownload(blob, `${safeName || "line_list"}.csv`);
    } catch (error) {
      console.error("Failed to download line list", error);
      toast({
        title: "Download failed",
        description: error instanceof Error ? error.message : "Unable to download this line list.",
        variant: "destructive",
      });
    } finally {
      setDownloading(false);
    }
  };

  const rows = Array.isArray(currentLineList?.data) ? currentLineList.data : [];
  const headers = rows.length > 0 ? Object.keys(rows[0] || {}) : [];
  const assessmentLabel =
    currentLineList?.assessment_name || currentLineList?.assessment_detail?.display_name || currentLineList?.assessment_detail?.name;
  const projectLabel = currentLineList?.project_name || currentLineList?.project_detail?.name;
  const organizationLabel = currentLineList?.organization_name || currentLineList?.organization_detail?.name;

  const handleCreateRequest = () => {
    if (lineListsUnavailable) {
      toast({
        title: "Preview only",
        description: "Line lists are not available on this backend yet.",
      });
      return;
    }
    setCreateOpen(true);
  };

  const handleEditRequest = () => {
    if (!currentLineList) return;
    if (lineListsUnavailable) {
      toast({
        title: "Preview only",
        description: "This line list is shown for preview and cannot be edited on this backend yet.",
      });
      return;
    }
    setEditOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Create reusable row-level datasets for verification, case review, and downstream analysis.
        </p>
        <Button onClick={handleCreateRequest}>
          <Plus className="mr-2 h-4 w-4" />
          New Line List
        </Button>
      </div>

      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-[1.5rem] border border-border bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                Saved Line Lists
              </p>
              <p className="mt-3 text-3xl font-semibold text-foreground">{totalCount}</p>
            </div>
            <List className="h-8 w-8 text-[var(--green-primary)]" />
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            Prepared exports that preserve row-level detail for follow-up work.
          </p>
        </div>

        <div className="rounded-[1.5rem] border border-border bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                Visible Columns
              </p>
              <p className="mt-3 text-3xl font-semibold text-foreground">{headers.length}</p>
            </div>
            <FileSearch className="h-8 w-8 text-[var(--green-primary)]" />
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            Columns available in the currently selected line-list output.
          </p>
        </div>

        <div className="rounded-[1.5rem] border border-border bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                Current Scope
              </p>
              <p className="mt-3 text-xl font-semibold text-foreground">{organizationLabel || projectLabel || "All Data"}</p>
            </div>
            <Search className="h-8 w-8 text-[var(--green-primary)]" />
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            Filter lists by assessment, project, organization, and reporting period.
          </p>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
        <Card className="h-fit">
          <CardHeader className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Your Line Lists</CardTitle>
                <CardDescription>Row-level datasets ready for quality review and export</CardDescription>
              </div>
              <Badge variant="outline">{totalCount}</Badge>
            </div>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
                placeholder="Search line lists..."
                className="pl-9"
              />
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {listLoading ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
              </div>
            ) : lineLists.length === 0 ? (
              <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                No line lists found.
              </div>
            ) : (
              lineLists.map((list) => (
                <button
                  key={list.id}
                  type="button"
                  onClick={() => setSelectedId(list.id)}
                  className={`w-full rounded-lg border px-3 py-3 text-left transition-colors ${
                    selectedId === list.id
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/40 hover:bg-muted/50"
                  }`}
                >
                  <div className="font-medium">{list.display_name || list.name || "Line List"}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {list.assessment_name || "Assessment response export"}
                  </div>
                </button>
              ))
            )}

            <div className="flex items-center justify-between pt-2">
              <Button variant="outline" size="sm" onClick={() => setPage((value) => value - 1)} disabled={!hasPrevPage}>
                Previous
              </Button>
              <span className="text-xs text-muted-foreground">Page {page}</span>
              <Button variant="outline" size="sm" onClick={() => setPage((value) => value + 1)} disabled={!hasNextPage}>
                Next
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6 min-w-0">
          {!selectedId ? (
            <Card className="border-dashed">
              <CardContent className="flex min-h-[320px] flex-col items-center justify-center gap-3 text-center">
                <List className="h-14 w-14 text-muted-foreground" />
                <div className="text-lg font-semibold">Select or create a line list to begin.</div>
                <p className="max-w-xl text-sm text-muted-foreground">
                  Line lists preserve response-level records so teams can validate data, investigate cases, and export results quickly.
                </p>
              </CardContent>
            </Card>
          ) : (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>{currentLineList?.display_name || currentLineList?.name || "Line List"}</CardTitle>
                  <CardDescription>Configuration summary, scope, and export actions</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {detailLoading ? (
                    <div className="flex items-center justify-center py-12">
                      <Loader2 className="h-5 w-5 animate-spin text-primary" />
                    </div>
                  ) : (
                    <>
                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="rounded-lg border p-3">
                          <div className="text-xs uppercase tracking-wide text-muted-foreground">Assessment</div>
                          <div className="mt-1 font-medium">{assessmentLabel || "All assessments"}</div>
                        </div>
                        <div className="rounded-lg border p-3">
                          <div className="text-xs uppercase tracking-wide text-muted-foreground">Project</div>
                          <div className="mt-1 font-medium">{projectLabel || "All projects"}</div>
                        </div>
                        <div className="rounded-lg border p-3">
                          <div className="text-xs uppercase tracking-wide text-muted-foreground">Organization</div>
                          <div className="mt-1 font-medium">
                            {organizationLabel || "All organizations"}
                            {currentLineList?.cascade_organization ? " + subgrantees" : ""}
                          </div>
                        </div>
                        <div className="rounded-lg border p-3">
                          <div className="text-xs uppercase tracking-wide text-muted-foreground">Date Range</div>
                          <div className="mt-1 font-medium">
                            {currentLineList?.start || currentLineList?.end
                              ? `${formatDate(currentLineList?.start)} - ${formatDate(currentLineList?.end)}`
                              : "All dates"}
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <Button variant="outline" onClick={handleEditRequest}>
                          <Pencil className="mr-2 h-4 w-4" />
                          Edit
                        </Button>
                        <Button variant="outline" onClick={handleDownload} disabled={downloading}>
                          {downloading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                          Download CSV
                        </Button>
                        <Button variant="ghost" onClick={handleDelete} disabled={deleting}>
                          {deleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                          Delete
                        </Button>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Data</CardTitle>
                  <CardDescription>Live output for the selected line-list definition</CardDescription>
                </CardHeader>
                <CardContent>
                  {detailLoading ? (
                    <div className="flex items-center justify-center py-12">
                      <Loader2 className="h-5 w-5 animate-spin text-primary" />
                    </div>
                  ) : headers.length === 0 ? (
                    <div className="flex min-h-[240px] items-center justify-center text-muted-foreground">
                      No data available for this line list.
                    </div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          {headers.map((header) => (
                            <TableHead key={header}>{cleanLabel(header)}</TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {rows.map((row, rowIndex) => (
                          <TableRow key={`row-${rowIndex}`}>
                            {headers.map((header) => (
                              <TableCell key={`${rowIndex}-${header}`}>
                                {formatAnalyticsValue((row as Record<string, unknown>)[header], {
                                  field: header,
                                  breakdowns: dashboardBreakdowns,
                                })}
                              </TableCell>
                            ))}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>

      <LineListSettingsDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSaved={handleRefresh}
        backendUnavailable={lineListsUnavailable}
      />
      <LineListSettingsDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        onSaved={handleRefresh}
        existing={currentLineList || null}
        backendUnavailable={lineListsUnavailable}
      />
    </div>
  );
}
