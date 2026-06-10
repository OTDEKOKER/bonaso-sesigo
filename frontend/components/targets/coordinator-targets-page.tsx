"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AlertCircle, Filter, Layers3, Loader2, Plus } from "lucide-react";

import {
  coordinatorTargetsService,
  type AggregateFilters,
  type CoordinatorTarget,
  type CoordinatorTargetBulkAssignRequest,
  type CoordinatorTargetFilters,
} from "@/lib/api";
import type { Aggregate, Indicator, Organization, Project } from "@/lib/types";
import { getAggregateTotal } from "@/lib/aggregates/aggregate-helpers";
import { buildOrganizationDescendantMap } from "@/lib/analytics/org-scope";
import { resolveIndicatorIdString } from "@/lib/indicators/id-aliases";
import { useAuth } from "@/lib/contexts/auth-context";
import { useSessionMode } from "@/lib/contexts/session-mode-context";
import {
  useAllAggregates,
  useAllIndicators,
  useAllOrganizations,
  useAllProjects,
  useCoordinatorTargets,
} from "@/lib/hooks/use-api";
import { useDefaultProject } from "@/lib/hooks/use-default-project";
import { NoProjectEmptyState } from "@/components/shared/no-project-empty-state";
import { isBonasoOrganizationName } from "@/lib/organization-hierarchy";
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
  type CoordinatorTargetFormValue,
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
  calculatePerformanceStatus,
  getCurrentFiscalYear,
  getFiscalQuarterDateRange,
  isIsoRangeOverlapping,
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

function getFiscalYearDateRange(year: number) {
  return {
    start: `${year}-04-01`,
    end: `${year + 1}-03-31`,
  };
}

function coerceId(value: unknown): string {
  return String(value ?? "").trim();
}

function toIdArray(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const deduped = new Set<string>();
  values.forEach((value) => {
    const nested =
      typeof value === "object" && value !== null
        ? coerceId((value as { id?: unknown; value?: unknown; pk?: unknown }).id ?? (value as { value?: unknown }).value ?? (value as { pk?: unknown }).pk)
        : coerceId(value);
    if (!nested) return;
    deduped.add(nested);
  });
  return Array.from(deduped);
}

function normalizeHierarchyOverrides(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const normalized: Record<string, string[]> = {};

  Object.entries(value as Record<string, unknown>).forEach(([rawParentId, rawChildren]) => {
    const parentId = coerceId(rawParentId);
    if (!parentId || !Array.isArray(rawChildren)) return;

    const childIds = Array.from(
      new Set(
        rawChildren
          .map((rawChildId) => coerceId(rawChildId))
          .filter((childId) => childId.length > 0 && childId !== parentId),
      ),
    );
    normalized[parentId] = childIds;
  });

  return normalized;
}

type NormalizedAggregate = {
  id: string;
  projectId: string;
  indicatorId: string;
  organizationId: string;
  start: string;
  end: string;
  total: number;
};

function normalizeAggregates(aggregates: Aggregate[]): NormalizedAggregate[] {
  return aggregates
    .map((aggregate) => {
      const start = String(aggregate.period_start || aggregate.period_end || "");
      const end = String(aggregate.period_end || aggregate.period_start || "");
      if (!start || !end) return null;

      return {
        id: coerceId(aggregate.id),
        projectId: coerceId(aggregate.project),
        indicatorId: coerceId(aggregate.indicator),
        organizationId: coerceId(aggregate.organization),
        start,
        end,
        total: getAggregateTotal(aggregate),
      } as NormalizedAggregate;
    })
    .filter((value): value is NormalizedAggregate => value !== null);
}

function buildPerformanceRows(input: {
  targets: CoordinatorTarget[];
  organizations: Organization[];
  projectsById: Map<
    string,
    {
      name: string;
      organizationIds: string[];
      hierarchyOverrides: Record<string, string[]>;
    }
  >;
  indicatorsById: Map<string, string>;
  aggregates: NormalizedAggregate[];
}): CoordinatorPerformanceRow[] {
  const { targets, organizations, projectsById, indicatorsById, aggregates } = input;
  const globalDescendantsByParent = buildOrganizationDescendantMap(organizations);
  const descendantsByParentByProjectId = new Map<string, Record<string, string[]>>();
  const organizationNameById = new Map(organizations.map((organization) => [coerceId(organization.id), organization.name]));

  return targets
    .map((target) => {
      const coordinatorId = coerceId(target.coordinator_id);
      const targetProjectId = coerceId(target.project_id);
      const projectProfile = projectsById.get(targetProjectId);
      const descendantsByParent =
        descendantsByParentByProjectId.get(targetProjectId) ||
        (() => {
          const mapped = buildOrganizationDescendantMap(
            organizations,
            projectProfile
              ? {
                  hierarchyOverrides: projectProfile.hierarchyOverrides,
                  scopedOrganizationIds: projectProfile.organizationIds,
                }
              : undefined,
          );
          descendantsByParentByProjectId.set(targetProjectId, mapped);
          return mapped;
        })();
      const targetIndicatorIdRaw = coerceId(target.indicator_id);
      const targetIndicatorId = resolveIndicatorIdString(targetIndicatorIdRaw);
      const descendants =
        descendantsByParent[coordinatorId] ??
        globalDescendantsByParent[coordinatorId] ??
        [];
      const scopeOrgIds = new Set([coordinatorId, ...descendants]);
      const fiscalRange = getFiscalQuarterDateRange(Number(target.year), target.quarter);

      const seenAggregateIds = new Set<string>();
      const childTotalsByOrgId = new Map<string, number>();
      let ownActualValue = 0;
      let actualValue = 0;

      for (const aggregate of aggregates) {
        if (aggregate.projectId !== targetProjectId || aggregate.indicatorId !== targetIndicatorId) continue;
        if (!scopeOrgIds.has(aggregate.organizationId)) continue;
        if (
          !isIsoRangeOverlapping({
            leftStart: aggregate.start,
            leftEnd: aggregate.end,
            rightStart: fiscalRange.start,
            rightEnd: fiscalRange.end,
          })
        ) {
          continue;
        }
        if (seenAggregateIds.has(aggregate.id)) continue;
        seenAggregateIds.add(aggregate.id);

        actualValue += aggregate.total;
        if (aggregate.organizationId === coordinatorId) {
          ownActualValue += aggregate.total;
        } else {
          childTotalsByOrgId.set(
            aggregate.organizationId,
            (childTotalsByOrgId.get(aggregate.organizationId) || 0) + aggregate.total,
          );
        }
      }

      const childContributions = Array.from(childTotalsByOrgId.entries())
        .map(([organizationId, childValue]) => ({
          organization_id: Number(organizationId),
          organization_name: organizationNameById.get(organizationId) || `Organization ${organizationId}`,
          actual_value: childValue,
          share_percent: actualValue > 0 ? (childValue / actualValue) * 100 : 0,
        }))
        .sort((left, right) => right.actual_value - left.actual_value);

      const targetValue = Number(target.target_value || 0);
      const achievementPercent = targetValue > 0 ? (actualValue / targetValue) * 100 : null;
      const variance = actualValue - targetValue;

      return {
        target,
        projectName:
          target.project_name ||
          projectProfile?.name ||
          `Project ${targetProjectId}`,
        coordinatorName:
          target.coordinator_name ||
          organizationNameById.get(coordinatorId) ||
          `Coordinator ${coordinatorId}`,
        indicatorName:
          target.indicator_name ||
          indicatorsById.get(targetIndicatorIdRaw) ||
          indicatorsById.get(targetIndicatorId) ||
          `Indicator ${targetIndicatorId}`,
        ownActualValue,
        actualValue,
        achievementPercent,
        variance,
        status: calculatePerformanceStatus({
          targetValue,
          achievementPercent,
        }),
        childContributions,
      } satisfies CoordinatorPerformanceRow;
    })
    .sort((left, right) => {
      const yearDiff = Number(right.target.year) - Number(left.target.year);
      if (yearDiff !== 0) return yearDiff;
      const quarterDiff =
        (quarterSortWeight[right.target.quarter] || 0) - (quarterSortWeight[left.target.quarter] || 0);
      if (quarterDiff !== 0) return quarterDiff;
      return left.coordinatorName.localeCompare(right.coordinatorName);
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

  // Unfiltered-by-coordinator/indicator list (scoped only to project + year) used
  // to populate the Coordinator and Indicator dropdowns from the data that
  // actually exists for the project — so every coordinator/indicator with a
  // target is selectable (independent of org-tree/hierarchy_overrides).
  const optionFilters = useMemo<CoordinatorTargetFilters>(
    () => ({
      project_id: filters.projectId !== "all" ? filters.projectId : undefined,
      year: filters.year !== "all" ? filters.year : undefined,
      page_size: "1000",
    }),
    [filters.projectId, filters.year],
  );
  const { data: optionTargetsData } = useCoordinatorTargets(optionFilters);
  const optionTargets = (optionTargetsData?.results ?? EMPTY_ITEMS) as CoordinatorTarget[];
  const { data: allProjectsData } = useAllProjects();
  const { data: allOrganizationsData } = useAllOrganizations();
  const { data: allIndicatorsData } = useAllIndicators();

  const coordinatorTargetsUnavailable = isBackendUnavailable(coordinatorTargetsError);

  const targets = coordinatorTargetsData?.results ?? EMPTY_ITEMS;
  const totalCount = coordinatorTargetsData?.count ?? 0;
  const hasPrevPage = Boolean(coordinatorTargetsData?.previous);
  const hasNextPage = Boolean(coordinatorTargetsData?.next);

  const projects = (allProjectsData?.results ?? EMPTY_ITEMS) as Project[];
  const organizations = allOrganizationsData?.results ?? EMPTY_ITEMS;
  const indicators = (allIndicatorsData ?? EMPTY_ITEMS) as Indicator[];

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
    const seen = new Map<string, string>();
    for (const target of optionTargets) {
      const id = coerceId(target.coordinator_id);
      if (id && !seen.has(id)) seen.set(id, String(target.coordinator_name || `Coordinator ${id}`));
    }
    return Array.from(seen, ([value, label]) => ({ value, label })).sort((a, b) =>
      a.label.localeCompare(b.label),
    );
  }, [optionTargets]);

  const indicatorOptions = useMemo<NamedOption[]>(() => {
    const seen = new Map<string, string>();
    for (const target of optionTargets) {
      const id = coerceId(target.indicator_id);
      if (id && !seen.has(id)) seen.set(id, String(target.indicator_name || `Indicator ${id}`));
    }
    return Array.from(seen, ([value, label]) => ({ value, label })).sort((a, b) =>
      a.label.localeCompare(b.label),
    );
  }, [optionTargets]);

  const fiscalYears = useMemo(
    () =>
      buildFiscalYearOptions([
        ...targets.map((target) => Number(target.year)),
        Number(filters.year),
      ]),
    [filters.year, targets],
  );

  const aggregateFilters = useMemo<AggregateFilters | null>(() => {
    if (coordinatorTargetsUnavailable || targets.length === 0) return null;
    const query: AggregateFilters = {};
    if (filters.projectId !== "all") query.project = filters.projectId;
    if (filters.indicatorId !== "all") query.indicator = filters.indicatorId;

    if (filters.year !== "all") {
      const fiscalYear = Number(filters.year);
      if (Number.isFinite(fiscalYear)) {
        const range =
          filters.quarter === "all"
            ? getFiscalYearDateRange(fiscalYear)
            : getFiscalQuarterDateRange(fiscalYear, filters.quarter);
        query.date_from = range.start;
        query.date_to = range.end;
      }
    }
    query.status = "approved";

    return query;
  }, [coordinatorTargetsUnavailable, filters.indicatorId, filters.projectId, filters.quarter, filters.year, targets.length]);

  const {
    data: allAggregates,
    error: allAggregatesError,
    isLoading: allAggregatesLoading,
  } = useAllAggregates(aggregateFilters);

  const projectsById = useMemo(
    () =>
      new Map(
        projects.map((project) => {
          const projectId = coerceId(project.id);
          return [
            projectId,
            {
              name: String(project.name || "Project"),
              organizationIds: toIdArray((project as { organizations?: unknown[] }).organizations),
              hierarchyOverrides: normalizeHierarchyOverrides(project.hierarchy_overrides),
            },
          ] as const;
        }),
      ),
    [projects],
  );
  const indicatorsById = useMemo(
    () => new Map(indicators.map((indicator) => [coerceId(indicator.id), String(indicator.name || "Indicator")])),
    [indicators],
  );

  const normalizedAggregates = useMemo(
    () => normalizeAggregates((allAggregates ?? EMPTY_ITEMS) as Aggregate[]),
    [allAggregates],
  );

  const performanceRows = useMemo(
    () =>
      buildPerformanceRows({
        targets: targets as CoordinatorTarget[],
        organizations: organizations as Organization[],
        projectsById,
        indicatorsById,
        aggregates: normalizedAggregates,
      }),
    [indicatorsById, normalizedAggregates, organizations, projectsById, targets],
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

  const handleSaveTarget = async (value: CoordinatorTargetFormValue) => {
    setSaving(true);
    try {
      if (editTarget) {
        await coordinatorTargetsService.update(editTarget.id, value);
      } else {
        await coordinatorTargetsService.create(value);
      }
      await mutateCoordinatorTargets();
      setCreateOpen(false);
      setEditTarget(null);
      toast({
        title: editTarget ? "Coordinator target updated" : "Coordinator target created",
      });
    } catch (error) {
      toast({
        title: "Save failed",
        description: error instanceof Error ? error.message : "Unable to save coordinator target.",
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
    coordinatorTargetsError && !coordinatorTargetsUnavailable
      ? coordinatorTargetsError instanceof Error
        ? coordinatorTargetsError.message
        : "Unable to load coordinator targets."
      : null;

  const aggregateWarning =
    allAggregatesError instanceof Error
      ? allAggregatesError.message
      : allAggregatesError
        ? "Unable to load aggregates for actuals calculation."
        : null;

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
            coordinators={coordinatorOptions}
            indicators={indicatorOptions}
            years={fiscalYears}
            pending={coordinatorTargetsLoading}
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

          {aggregateWarning ? (
            <Card className="border-amber-500/30 bg-amber-500/5">
              <CardContent className="p-3 text-sm text-amber-700">{aggregateWarning}</CardContent>
            </Card>
          ) : null}

          <Card className="border-border/70 shadow-sm">
            <CardContent className="space-y-4 p-4">
              {allAggregatesLoading ? (
                <div className="flex items-center text-sm text-muted-foreground">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Calculating coordinator actuals...
                </div>
              ) : null}

              <CoordinatorTargetsTable
                rows={performanceRows}
                loading={coordinatorTargetsLoading}
                error={tableError}
                canEdit={canEditTargets}
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
          coordinators={coordinatorOptions}
          indicators={indicatorOptions}
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
          coordinators={coordinatorOptions}
          indicators={indicatorOptions}
          onSubmit={handleSaveTarget}
        />
      ) : null}

      {bulkAssignOpen ? (
        <CoordinatorTargetBulkAssignDialog
          open={bulkAssignOpen}
          onOpenChange={setBulkAssignOpen}
          submitting={bulkSaving}
          projects={projectOptions}
          coordinators={coordinatorOptions}
          indicators={indicatorOptions}
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
