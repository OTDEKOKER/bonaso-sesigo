"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AlertCircle, Download, Filter, Layers3, Loader2, Plus } from "lucide-react";

import {
  coordinatorTargetsService,
  type CoordinatorTarget,
  type CoordinatorTargetBulkAssignRequest,
  type CoordinatorTargetFilters,
} from "@/lib/api";
import type { Project, ProjectIndicatorTarget } from "@/lib/types";
import { useAuth } from "@/lib/contexts/auth-context";
import { useSessionMode } from "@/lib/contexts/session-mode-context";
import {
  useAllProjects,
  useCoordinatorTargets,
  useCoordinatorTargetOptions,
  useCoordinatorTargetRollup,
  useProject,
  useProjectCoordinators,
} from "@/lib/hooks/use-api";
import { useDefaultProject } from "@/lib/hooks/use-default-project";
import { NoProjectEmptyState } from "@/components/shared/no-project-empty-state";
import { canManageCoordinatorTargets } from "@/lib/permissions";
import { PageHeader } from "@/components/shared/page-header";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import {
  CoordinatorTargetBulkAssignDialog,
} from "@/components/targets/coordinator-target-bulk-assign-dialog";
import {
  CoordinatorTargetFormDialog,
  type CoordinatorTargetSaveItem,
} from "@/components/targets/coordinator-target-form-dialog";
import { CoordinatorTargetsFilterBar } from "@/components/targets/coordinator-targets-filter-bar";
import { CoordinatorTargetsTable } from "@/components/targets/coordinator-targets-table";
import type {
  CoordinatorPerformanceRow,
  CoordinatorTargetsFilterState,
  NamedOption,
} from "@/components/targets/coordinator-targets-types";
import {
  buildFiscalYearOptions,
  getCurrentFiscalYear,
} from "@/components/targets/coordinator-targets-utils";

const EMPTY_ITEMS: never[] = [];

const quarterSortWeight: Record<string, number> = {
  Q1: 1,
  Q2: 2,
  Q3: 3,
  Q4: 4,
};

function isBackendUnavailable(error: unknown): boolean {
  if (
    typeof error !== "object" ||
    error === null ||
    !("status" in error) ||
    (error as { status?: unknown }).status !== 404
  ) {
    return false;
  }

  if (!("message" in error) || typeof (error as { message?: unknown }).message !== "string") {
    return false;
  }

  const message = (error as { message: string }).message.toLowerCase();
  return (
    message.includes("not available on this backend") ||
    message.includes("page not found at /api/analysis/coordinator-targets/") ||
    message.includes("/api/analysis/coordinator-targets/") ||
    message.includes("the requested resource was not found") ||
    message.includes("<!doctype html>") ||
    message.includes("<html")
  );
}

function coerceId(value: unknown): string {
  return String(value ?? "").trim();
}

// Prepend `{ value, label }` to an option list when that id isn't already
// present, so a Select bound to it renders its label instead of a blank trigger.
function ensureOption(options: NamedOption[], id: unknown, name?: string | null): NamedOption[] {
  const value = coerceId(id);
  if (!value || options.some((option) => option.value === value)) return options;
  return [{ value, label: name || `#${value}` }, ...options];
}

/**
 * Display-only mapper (readiness R3). All coordinator totals — actual, own vs
 * subgrantee contribution, achievement %, and status — are computed by the
 * certified server-side rollup engine and arrive on each target. The frontend
 * no longer calculates rollups; it only shapes the rows for the table and
 * applies a stable display sort.
 */
function mapTargetsToRows(targets: CoordinatorTarget[]): CoordinatorPerformanceRow[] {
  return targets
    .map((target) => {
      const targetValue = Number(target.target_value || 0);
      const actualValue = typeof target.actual_value === "number" ? target.actual_value : 0;
      const achievementPercent =
        target.achievement_percent ?? (targetValue > 0 ? (actualValue / targetValue) * 100 : null);
      return {
        target,
        projectName: target.project_name || `Project ${coerceId(target.project_id)}`,
        coordinatorName: target.coordinator_name || `Coordinator ${coerceId(target.coordinator_id)}`,
        indicatorName: target.indicator_name || `Indicator ${coerceId(target.indicator_id)}`,
        ownActualValue: target.own_actual_value ?? 0,
        actualValue,
        achievementPercent,
        variance: typeof target.variance === "number" ? target.variance : actualValue - targetValue,
        status: target.performance_status ?? "no_target",
        childContributions: target.child_contributions ?? [],
      } satisfies CoordinatorPerformanceRow;
    })
    .sort((left, right) => {
      const yearDiff = Number(right.target.year) - Number(left.target.year);
      if (yearDiff !== 0) return yearDiff;
      const quarterDiff =
        (quarterSortWeight[right.target.quarter] || 0) - (quarterSortWeight[left.target.quarter] || 0);
      if (quarterDiff !== 0) return quarterDiff;
      const coordinatorDiff = left.coordinatorName.localeCompare(right.coordinatorName);
      if (coordinatorDiff !== 0) return coordinatorDiff;
      return left.indicatorName.localeCompare(right.indicatorName);
    });
}

export function CoordinatorTargetsPage() {
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const { toast } = useToast();

  const canEditTargets = canManageCoordinatorTargets(user);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<CoordinatorTargetsFilterState>({
    search: "",
    projectId: "all",
    coordinatorId: "all",
    indicatorId: "all",
    year: String(getCurrentFiscalYear()),
    quarter: "all",
    isActive: "all",
  });
  const [queryIndicatorApplied, setQueryIndicatorApplied] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<CoordinatorTarget | null>(null);
  const [bulkAssignOpen, setBulkAssignOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<CoordinatorTarget | null>(null);
  const [saving, setSaving] = useState(false);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (queryIndicatorApplied) return;
    const indicatorFromQuery = String(searchParams.get("indicator") || "").trim();
    if (indicatorFromQuery) {
      setFilters((current) => ({ ...current, indicatorId: indicatorFromQuery }));
    }
    setQueryIndicatorApplied(true);
  }, [queryIndicatorApplied, searchParams]);

  const targetFilters: CoordinatorTargetFilters = useMemo(() => {
    const query: CoordinatorTargetFilters = {
      page: String(page),
      search: filters.search.trim() || undefined,
      project_id: filters.projectId !== "all" ? filters.projectId : undefined,
      coordinator_id: filters.coordinatorId !== "all" ? filters.coordinatorId : undefined,
      indicator_id: filters.indicatorId !== "all" ? filters.indicatorId : undefined,
      year: filters.year !== "all" ? filters.year : undefined,
      quarter: filters.quarter !== "all" ? filters.quarter : undefined,
      is_active: filters.isActive !== "all" ? filters.isActive : undefined,
    };
    return query;
  }, [filters, page]);

  const {
    data: coordinatorTargetsData,
    error: coordinatorTargetsError,
    isLoading: coordinatorTargetsLoading,
    mutate: mutateCoordinatorTargets,
  } = useCoordinatorTargets(targetFilters);

  // Distinct indicators + coordinators (scoped to project + year) that have a
  // target, for the dropdowns — served by a lightweight endpoint (no rollup
  // actuals) instead of fetching 1000 fully-computed rows, which was the page's
  // slowest call.
  const { data: optionsData } = useCoordinatorTargetOptions(
    filters.projectId !== "all" ? filters.projectId : null,
    filters.year !== "all" ? filters.year : null,
  );
  const { data: allProjectsData } = useAllProjects();

  // Project-hierarchy coordinators (ProjectOrganization.is_coordinator) for the
  // selected project. The coordinator filter must list only the project's
  // actual coordinators — not every org that happens to have a target — so we
  // scope the dropdown to this authoritative set once a project is chosen.
  const { data: projectCoordinatorsData } = useProjectCoordinators(
    filters.projectId !== "all" ? filters.projectId : null,
  );

  // "All coordinators" within a project → per-indicator rollup (server-side).
  // A specific coordinator (or no project) keeps the normal per-target list.
  const isRollupView = filters.projectId !== "all" && filters.coordinatorId === "all";
  const {
    data: rollupData,
    error: rollupError,
    isLoading: rollupLoading,
  } = useCoordinatorTargetRollup(isRollupView ? targetFilters : null);

  const coordinatorTargetsUnavailable = isBackendUnavailable(coordinatorTargetsError);

  const activeData = isRollupView ? rollupData : coordinatorTargetsData;
  const activeError = isRollupView ? rollupError : coordinatorTargetsError;
  const activeLoading = isRollupView ? rollupLoading : coordinatorTargetsLoading;

  const targets = activeData?.results ?? EMPTY_ITEMS;
  const totalCount = activeData?.count ?? 0;
  const hasPrevPage = Boolean(activeData?.previous);
  const hasNextPage = Boolean(activeData?.next);

  const projects = (allProjectsData?.results ?? EMPTY_ITEMS) as Project[];

  const projectOptions = useMemo<NamedOption[]>(
    () =>
      projects
        .map((project) => ({ value: coerceId(project.id), label: String(project.name || "Project") }))
        .sort((left, right) => left.label.localeCompare(right.label)),
    [projects],
  );

  const selectedProject = useMemo(
    () =>
      filters.projectId !== "all"
        ? projects.find((project) => coerceId(project.id) === filters.projectId) || null
        : null,
    [filters.projectId, projects],
  );

  // Default-project workflow (risk R7), shared with the aggregates surface.
  const { isTrainingMode, trainingProjectId } = useSessionMode();
  const userDefaultProjectId =
    (user as { default_project_id?: number | string | null } | null)?.default_project_id ?? null;
  const { defaultProjectId, isSingleProject, isMultiProject, hasProjects } = useDefaultProject(
    projects,
    { isTrainingMode, trainingProjectId, preferredProjectId: userDefaultProjectId },
  );

  // Auto-select the resolved default once (single / backend-default / training),
  // while preserving any later manual choice (including switching back to "all").
  const projectAutoAppliedRef = useRef(false);
  useEffect(() => {
    if (projectAutoAppliedRef.current) return;
    if (!defaultProjectId) return;
    projectAutoAppliedRef.current = true;
    setFilters((current) =>
      current.projectId === "all" ? { ...current, projectId: defaultProjectId } : current,
    );
  }, [defaultProjectId]);

  // Assignment/target actions require an explicit project context.
  const projectContextMissing = !hasProjects || filters.projectId === "all";

  const coordinatorOptions = useMemo<NamedOption[]>(() => {
    return (optionsData?.coordinators ?? [])
      .map((coordinator) => ({ value: coerceId(coordinator.id), label: coordinator.name }))
      .filter((option) => option.value)
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [optionsData]);

  // The coordinator FILTER lists only the selected project's actual coordinators
  // (project hierarchy). It intentionally differs from `coordinatorOptions`
  // above, which still spans every org with a target so existing targets remain
  // editable. Fall back to the target-derived set when no project is chosen.
  const filterCoordinatorOptions = useMemo<NamedOption[]>(() => {
    if (filters.projectId !== "all" && projectCoordinatorsData) {
      return projectCoordinatorsData
        .map((coordinator) => ({ value: coerceId(coordinator.id), label: coordinator.name }))
        .filter((option) => option.value)
        .sort((a, b) => a.label.localeCompare(b.label));
    }
    return coordinatorOptions;
  }, [filters.projectId, projectCoordinatorsData, coordinatorOptions]);

  const indicatorOptions = useMemo<NamedOption[]>(() => {
    return (optionsData?.indicators ?? [])
      .map((indicator) => ({ value: coerceId(indicator.id), label: indicator.name }))
      .filter((option) => option.value)
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [optionsData]);

  // The `optionsData` sets above list only indicators/coordinators that ALREADY
  // have a target — right for the filter bar, but wrong for the create/bulk/edit
  // dialogs, which must be able to assign a target to any of the project's
  // indicators (not just the ones already targeted). Source the dialogs' full
  // indicator set from the project's own indicators (light detail ≈0.5s), and
  // their coordinators from the authoritative project-hierarchy set.
  const selectedProjectIdNumber =
    filters.projectId !== "all" && filters.projectId ? Number(filters.projectId) : null;
  const { data: projectDetail } = useProject(
    canEditTargets ? selectedProjectIdNumber : null,
    { light: true },
  );
  const dialogIndicatorOptions = useMemo<NamedOption[]>(() => {
    const projectIndicators =
      (projectDetail as { project_indicators?: ProjectIndicatorTarget[] } | undefined)
        ?.project_indicators ?? [];
    const byId = new Map<string, string>();
    for (const item of projectIndicators) {
      const value = coerceId(item.indicator);
      if (!value || byId.has(value)) continue;
      byId.set(value, item.indicator_name || `Indicator ${value}`);
    }
    // Fall back to the target-derived set before the project detail resolves (or
    // when no project is chosen) so the dialogs are never empty.
    if (byId.size === 0) return indicatorOptions;
    return Array.from(byId.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [projectDetail, indicatorOptions]);
  const dialogCoordinatorOptions = filterCoordinatorOptions;

  // The edit dialog opens on an EXISTING target whose coordinator/indicator may
  // sit outside the clean project sets (e.g. a legacy target on an org that is no
  // longer a project coordinator). Guarantee the record's own selection is
  // present so its Select isn't rendered blank.
  const editIndicatorOptions = useMemo<NamedOption[]>(
    () => ensureOption(dialogIndicatorOptions, editTarget?.indicator_id, editTarget?.indicator_name),
    [dialogIndicatorOptions, editTarget],
  );
  const editCoordinatorOptions = useMemo<NamedOption[]>(
    () =>
      ensureOption(dialogCoordinatorOptions, editTarget?.coordinator_id, editTarget?.coordinator_name),
    [dialogCoordinatorOptions, editTarget],
  );

  const fiscalYears = useMemo(
    () =>
      buildFiscalYearOptions([
        ...targets.map((target) => Number(target.year)),
        Number(filters.year),
      ]),
    [filters.year, targets],
  );

  // Display-only: rows come straight from the server-computed targets. No
  // aggregate fetching, no client-side rollup — the backend is the single
  // source of truth (readiness R3).
  const performanceRows = useMemo(
    () => mapTargetsToRows(targets as CoordinatorTarget[]),
    [targets],
  );

  const applyFilters = (patch: Partial<CoordinatorTargetsFilterState>) => {
    setFilters((current) => ({ ...current, ...patch }));
    setPage(1);
  };

  const withEditGuard = (action: () => void) => {
    if (canEditTargets) {
      action();
      return;
    }
    toast({
      title: "View only",
      description: "You do not have permission to edit coordinator targets.",
    });
  };

  const handleSaveTarget = async (items: CoordinatorTargetSaveItem[]) => {
    setSaving(true);
    try {
      let created = 0;
      let updated = 0;
      // One row per quarter: update when an existing target id is supplied,
      // otherwise create. Sequential so a failure surfaces the offending quarter.
      for (const item of items) {
        const { id, ...value } = item;
        if (id) {
          await coordinatorTargetsService.update(id, value);
          updated += 1;
        } else {
          await coordinatorTargetsService.create(value);
          created += 1;
        }
      }
      await mutateCoordinatorTargets();
      setCreateOpen(false);
      setEditTarget(null);
      toast({
        title: "Coordinator targets saved",
        description: `${created} created, ${updated} updated.`,
      });
    } catch (error) {
      toast({
        title: "Save failed",
        description: error instanceof Error ? error.message : "Unable to save coordinator targets.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleBulkAssign = async (request: CoordinatorTargetBulkAssignRequest) => {
    setBulkSaving(true);
    try {
      const result = await coordinatorTargetsService.bulkAssign(request);
      await mutateCoordinatorTargets();
      setBulkAssignOpen(false);
      toast({
        title: "Bulk assignment complete",
        description: `${result.created} created, ${result.updated} updated, ${result.skipped} skipped.`,
      });
    } catch (error) {
      toast({
        title: "Bulk assign failed",
        description: error instanceof Error ? error.message : "Unable to bulk assign coordinator targets.",
        variant: "destructive",
      });
    } finally {
      setBulkSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await coordinatorTargetsService.delete(deleteTarget.id);
      await mutateCoordinatorTargets();
      setDeleteTarget(null);
      toast({
        title: "Coordinator target deleted",
      });
    } catch (error) {
      toast({
        title: "Delete failed",
        description: error instanceof Error ? error.message : "Unable to delete coordinator target.",
        variant: "destructive",
      });
    } finally {
      setDeleting(false);
    }
  };

  const tableError =
    activeError && !coordinatorTargetsUnavailable
      ? activeError instanceof Error
        ? activeError.message
        : "Unable to load coordinator targets."
      : null;

  const handleExport = async () => {
    setExporting(true);
    try {
      const blob = await coordinatorTargetsService.exportCsv(targetFilters);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "coordinator-targets.csv";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast({
        title: "Export failed",
        description: error instanceof Error ? error.message : "Unable to export coordinator targets.",
        variant: "destructive",
      });
    } finally {
      setExporting(false);
    }
  };

  const handleExportAssigned = async () => {
    setExporting(true);
    try {
      const blob = await coordinatorTargetsService.exportAssignedTargetsCsv(targetFilters);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "assigned-indicator-targets.xlsx";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast({
        title: "Export failed",
        description: error instanceof Error ? error.message : "Unable to export assigned indicator targets.",
        variant: "destructive",
      });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Coordinator Portfolio Targets"
        description="Manage quarterly coordinator targets separately from indicator metadata."
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Targets", href: "/targets/coordinators" },
          { label: "Coordinator Targets" },
        ]}
        actions={
          <div className="flex flex-wrap gap-2">
            {!coordinatorTargetsUnavailable ? (
              <Button
                variant="outline"
                onClick={() => void handleExport()}
                disabled={exporting || totalCount === 0}
                title={totalCount === 0 ? "No targets to export" : undefined}
              >
                {exporting ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Download className="mr-2 h-4 w-4" />
                )}
                Export CSV
              </Button>
            ) : null}
            {!coordinatorTargetsUnavailable ? (
              <Button
                variant="outline"
                onClick={() => void handleExportAssigned()}
                disabled={exporting || totalCount === 0}
                title={totalCount === 0 ? "No targets to export" : "Excel: indicator with Q1–Q4 targets, workbook order"}
              >
                {exporting ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Download className="mr-2 h-4 w-4" />
                )}
                Download targets (Excel)
              </Button>
            ) : null}
            {canEditTargets ? (
              <>
                <Button
                  variant="outline"
                  onClick={() => setBulkAssignOpen(true)}
                  disabled={projectContextMissing}
                  title={projectContextMissing ? "Select a project first" : undefined}
                >
                  <Layers3 className="mr-2 h-4 w-4" />
                  Bulk Assign
                </Button>
                <Button
                  onClick={() => setCreateOpen(true)}
                  disabled={projectContextMissing}
                  title={projectContextMissing ? "Select a project first" : undefined}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  New Target
                </Button>
              </>
            ) : (
              <Badge variant="outline">View only</Badge>
            )}
          </div>
        }
      />

      {coordinatorTargetsUnavailable ? (
        <Card className="border-border/70 bg-muted/40">
          <CardContent className="flex items-start gap-3 p-4 text-sm text-muted-foreground">
            <AlertCircle className="mt-0.5 h-4 w-4 text-primary" />
            <p>This backend does not yet expose coordinator target endpoints.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <CoordinatorTargetsFilterBar
            filters={filters}
            onFiltersChange={applyFilters}
            projects={projectOptions}
            coordinators={filterCoordinatorOptions}
            indicators={indicatorOptions}
            years={fiscalYears}
            pending={activeLoading}
          />

          {/* Current-project context / guidance (risk R7) */}
          {!hasProjects ? (
            <NoProjectEmptyState
              title="No active project available"
              description="You are not assigned to any active project yet. Ask an administrator to assign you to a project before setting coordinator targets."
            />
          ) : filters.projectId !== "all" ? (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-border/60 bg-muted/40 px-3 py-2 text-sm">
              <span className="font-medium text-foreground">Current project:</span>
              <span className="text-muted-foreground">
                {selectedProject?.name || "Selected project"}
              </span>
              {isSingleProject ? (
                <Badge variant="secondary" className="rounded-full text-[10px]">
                  your only project
                </Badge>
              ) : null}
            </div>
          ) : isMultiProject ? (
            <div className="flex items-center gap-2 rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-400/30 dark:bg-amber-950/30 dark:text-amber-200">
              <Filter className="h-4 w-4 shrink-0" />
              <span>Select a project before setting targets — assignment actions are disabled until you choose one.</span>
            </div>
          ) : null}

          <Card className="border-border/70 shadow-sm">
            <CardContent className="space-y-4 p-4">
              <CoordinatorTargetsTable
                rows={performanceRows}
                loading={activeLoading}
                error={tableError}
                canEdit={canEditTargets && !isRollupView}
                onEdit={(target) => withEditGuard(() => setEditTarget(target))}
                onDelete={(target) => withEditGuard(() => setDeleteTarget(target))}
              />

              {totalCount > 0 ? (
                <div className="flex items-center justify-between">
                  <div className="text-sm text-muted-foreground">Total: {totalCount.toLocaleString()}</div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage((current) => Math.max(1, current - 1))}
                      disabled={!hasPrevPage}
                    >
                      Previous
                    </Button>
                    <span className="text-xs text-muted-foreground">Page {page}</span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage((current) => current + 1)}
                      disabled={!hasNextPage}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </>
      )}

      {createOpen ? (
        <CoordinatorTargetFormDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          submitting={saving}
          projects={projectOptions}
          coordinators={dialogCoordinatorOptions}
          indicators={dialogIndicatorOptions}
          defaultProjectId={filters.projectId !== "all" ? filters.projectId : undefined}
          onSubmit={handleSaveTarget}
        />
      ) : null}

      {editTarget ? (
        <CoordinatorTargetFormDialog
          open={Boolean(editTarget)}
          onOpenChange={(nextOpen) => {
            if (!nextOpen) setEditTarget(null);
          }}
          submitting={saving}
          existing={editTarget}
          projects={projectOptions}
          coordinators={editCoordinatorOptions}
          indicators={editIndicatorOptions}
          onSubmit={handleSaveTarget}
        />
      ) : null}

      {bulkAssignOpen ? (
        <CoordinatorTargetBulkAssignDialog
          open={bulkAssignOpen}
          onOpenChange={setBulkAssignOpen}
          submitting={bulkSaving}
          projects={projectOptions}
          coordinators={dialogCoordinatorOptions}
          indicators={dialogIndicatorOptions}
          preselectedIndicatorId={filters.indicatorId !== "all" ? filters.indicatorId : null}
          defaultProjectId={filters.projectId !== "all" ? filters.projectId : undefined}
          onSubmit={handleBulkAssign}
        />
      ) : null}

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete coordinator target?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes only the coordinator target configuration for the selected period.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={deleting} onClick={() => void handleDelete()}>
              {deleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
