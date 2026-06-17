"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Calendar, Clock3, Download, Filter, Loader2, RefreshCcw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageHeader } from "@/components/shared/page-header";
import { ReportingWorkbookDialog } from "@/components/aggregates/ReportingWorkbookDialog";
import { OrganizationMultiSelect } from "@/components/shared/organization-multi-select";
import { NoProjectEmptyState } from "@/components/shared/no-project-empty-state";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/contexts/auth-context";
import { useSessionMode } from "@/lib/contexts/session-mode-context";
import { aggregatesService, uploadsService } from "@/lib/api";
import {
  useAllAggregates,
  useAggregateTemplates,
  useAllOrganizations,
  useAllIndicators,
  useAllProjects,
  useProject,
} from "@/lib/hooks/use-api";
import { useDefaultProject } from "@/lib/hooks/use-default-project";
import { useModulePermissions } from "@/lib/permissions/module-permissions";
import {
  buildEmptyEntryMatrix,
  buildEntryMatrixPayload,
  computeEntryMatrixTotal,
  dedupeRollupAggregates,
  getAggregateTotal,
  getAggregateEntryMatrixConfig,
  groupAggregatesByIndicator,
  isValidDateRange,
  parseNumberInput,
  resolveParentOrganizationId,
  type AggregateValue,
  type AggregateEntryMatrixConfig,
} from "@/lib/aggregates/aggregate-helpers";
import { AggregateEntryDialog } from "@/components/aggregates/AggregateEntryDialog";
import { AggregateAutoCalcDialog } from "@/components/aggregates/AggregateAutoCalcDialog";
import { AggregateChartDialog } from "@/components/aggregates/AggregateChartDialog";
import { AggregateMatrixTable } from "@/components/aggregates/AggregateMatrixTable";
import { AggregateReviewQueue } from "@/components/aggregates/AggregateReviewQueue";
import type { AggregateIndicatorGroup } from "@/lib/aggregates/aggregate-helpers";
import { isPlatformAdmin } from "@/lib/permissions";
import type { Indicator, Project } from "@/lib/types";
import {
  type AggregateEntryDraft,
  useAggregateChartState,
  useAggregateEntryForm,
  useAggregateFilters,
  useAggregateReviewActions,
  useAggregateVisibilityScope,
} from "./hooks";

function normalizeSearchValue(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function coerceId(value: unknown): string {
  return String(value ?? "").trim();
}

function toIdArray(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return Array.from(
    new Set(
      values
        .map((value) => {
          if (value && typeof value === "object") {
            const source = value as { id?: unknown; value?: unknown; pk?: unknown };
            return coerceId(source.id ?? source.value ?? source.pk);
          }
          return coerceId(value);
        })
        .filter((value) => value.length > 0),
    ),
  );
}

function AggregatesPageContent() {
  const { toast } = useToast();
  const { user } = useAuth();
  const { can } = useModulePermissions();
  const { isTrainingMode, trainingProjectId } = useSessionMode();
  const router = useRouter();
  const searchParams = useSearchParams();
  const reviewAggregateIdParam = searchParams.get("reviewAggregateId");
  const urlProjectParam = searchParams.get("project");
  const urlCoordinatorParam = searchParams.get("coordinator");
  const urlOrganizationsParam = searchParams.get("organizations");
  const urlSearchParam = searchParams.get("search");
  const urlDateFromParam = searchParams.get("date_from");
  const urlDateToParam = searchParams.get("date_to");
  const urlOrganizationIds = useMemo(
    () =>
      String(urlOrganizationsParam || "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    [urlOrganizationsParam],
  );

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isAutoCalcOpen, setIsAutoCalcOpen] = useState(false);
  const [isReviewQueueOpen, setIsReviewQueueOpen] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAutoCalcSubmitting, setIsAutoCalcSubmitting] = useState(false);
  // Phase 6: projectFilter lifted out of useAggregateFilters so we can derive filterProjectDetail before the hook call
  const [projectFilter, setProjectFilter] = useState("all");

  const appliedUrlBaseFiltersRef = useRef(false);
  const appliedUrlPeriodFilterRef = useRef(false);
  const [urlBaseFiltersApplied, setUrlBaseFiltersApplied] = useState(false);

  const {
    formDataSource,
    formNotes,
    formOrganization,
    formPeriodEnd,
    formPeriodStart,
    formProject,
    handleFormOrganizationChange,
    handleFormProjectChange,
    indicatorDrafts,
    resetForm,
    selectedIndicatorIds,
    setFormDataSource,
    setFormNotes,
    setFormOrganization,
    setFormPeriodEnd,
    setFormPeriodStart,
    setIndicatorDrafts,
    setSelectedIndicatorIds,
  } = useAggregateEntryForm();

  const [autoOutputIndicator, setAutoOutputIndicator] = useState("");
  const [autoSourceIndicator, setAutoSourceIndicator] = useState("");
  const [autoOperator, setAutoOperator] = useState<"equals" | "not_equals" | "contains">("equals");
  const [autoMatchValue, setAutoMatchValue] = useState("yes");
  const [autoCountDistinct, setAutoCountDistinct] = useState<"respondent" | "interaction">("respondent");
  const [autoProject, setAutoProject] = useState("");
  const [autoOrganization, setAutoOrganization] = useState("");
  const [autoPeriodStart, setAutoPeriodStart] = useState("");
  const [autoPeriodEnd, setAutoPeriodEnd] = useState("");
  const [autoSaveRule, setAutoSaveRule] = useState(true);
  const [autoSaveAggregate, setAutoSaveAggregate] = useState(true);
  const [autoComputed, setAutoComputed] = useState<number | null>(null);

  const aggregateApiFilters = isTrainingMode ? { include_training: 'true' } : undefined;
  const { data: aggregatesData, isLoading, error, mutate } = useAllAggregates(aggregateApiFilters, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
    shouldRetryOnError: true,
    errorRetryCount: 2,
    errorRetryInterval: 1500,
    dedupingInterval: 60_000,
  });
  const { data: projectsData } = useAllProjects();
  const { data: indicatorsData } = useAllIndicators();
  const { data: organizationsData } = useAllOrganizations();
  const selectedProjectId = formProject ? Number(formProject) : null;
  const { data: selectedProjectData } = useProject(selectedProjectId, {
    keepPreviousData: false,
  });
  const selectedProjectDetail =
    selectedProjectData && String(selectedProjectData.id) === formProject
      ? selectedProjectData
      : null;
  // Phase 6: fetch detail for the browse-side project filter (may differ from the entry form project)
  const filterProjectNumericId = projectFilter !== "all" ? Number(projectFilter) : null;
  const { data: filterProjectData } = useProject(filterProjectNumericId, {
    keepPreviousData: false,
  });
  const filterProjectDetail =
    filterProjectData && String(filterProjectData.id) === projectFilter
      ? filterProjectData
      : null;
  const { data: templatesData } = useAggregateTemplates({
    project: undefined,
    organization: undefined,
  });

  const aggregates = useMemo(() => aggregatesData || [], [aggregatesData]);
  const aggregateLoadErrorMessage = useMemo(() => {
    if (!error) return "";
    const message = typeof error === "object" && error && "message" in error ? String(error.message || "") : "";
    return message.trim() || "Failed to load aggregate data.";
  }, [error]);
  const aggregateLoadErrorStatus = useMemo(() => {
    if (!error || typeof error !== "object") return null;
    return "status" in error ? Number(error.status) || null : null;
  }, [error]);
  const projects = useMemo(
    () =>
      [...(projectsData?.results || [])].sort((left, right) =>
        String(left.name || "").localeCompare(String(right.name || "")),
      ),
    [projectsData],
  );
  // Default-project resolution (risk R7): auto-select when a single live/active
  // project (or the user's backend default, or the training project) applies, so
  // single-project users are never forced to pick, and multi-project users are
  // guided to choose. Mode isolation is preserved by the hook itself.
  const userDefaultProjectId =
    (user as { default_project_id?: number | string | null } | null)?.default_project_id ?? null;
  const {
    defaultProjectId,
    isSingleProject,
    isMultiProject,
    hasProjects,
  } = useDefaultProject(projects, {
    isTrainingMode,
    trainingProjectId,
    preferredProjectId: userDefaultProjectId,
  });

  const indicators = useMemo(
    () =>
      [...(indicatorsData || [])].sort((left, right) =>
        String(left.name || "").localeCompare(String(right.name || "")),
      ),
    [indicatorsData],
  );
  const organizations = useMemo(() => organizationsData?.results || [], [organizationsData?.results]);
  const templates = useMemo(() => templatesData || [], [templatesData]);

  const indicatorById = useMemo<Map<string, Indicator>>(
    () => new Map<string, Indicator>(indicators.map((indicator) => [String(indicator.id), indicator])),
    [indicators],
  );
  const indicatorNameById = useMemo<Map<string, string>>(
    () => new Map<string, string>(indicators.map((indicator) => [String(indicator.id), indicator.name])),
    [indicators],
  );
  const indicatorCodeById = useMemo<Map<string, string>>(
    () => new Map<string, string>(indicators.map((indicator) => [String(indicator.id), indicator.code])),
    [indicators],
  );
  const projectNameById = useMemo<Map<string, string>>(
    () => new Map<string, string>(projects.map((project) => [String(project.id), project.name])),
    [projects],
  );
  const organizationNameById = useMemo<Map<string, string>>(
    () =>
      new Map<string, string>(
        organizations.map((organization) => [String(organization.id), String(organization.name || "")]),
      ),
    [organizations],
  );
  const selectedProjectSummary = useMemo(
    () => projects.find((project) => String(project.id) === formProject) || null,
    [formProject, projects],
  );
  const projectOptions = useMemo(
    () =>
      projects.map((project) => ({
        id: project.id,
        name: String(project.name || `Project ${project.id}`),
      })),
    [projects],
  );
  const indicatorOptions = useMemo(
    () =>
      indicators.map((indicator) => ({
        id: indicator.id,
        name: String(indicator.name || `Indicator ${indicator.id}`),
        code: indicator.code || undefined,
        type: indicator.type || undefined,
      })),
    [indicators],
  );

  const {
    availableCoordinatorOrganizations,
    canReportAcrossOrganizations,
    canReviewAggregates,
    canApproveAggregates,
    canMarkReviewed,
    defaultOwnOrganizationValue,
    isOrganizationSelectionLocked,
    userOrganizationId,
    visibleOrganizationIds,
    visibleOrganizations,
    writableOrganizationIds,
    writableOrganizations,
  } = useAggregateVisibilityScope({
    organizations,
    user,
  });

  // Phase 6: when the browse filter has a project selected and that project has active hierarchy links,
  // restrict the coordinator dropdown to project parents and scope children via project hierarchy.
  const effectiveProjectHierarchyLinks = useMemo(
    () =>
      (filterProjectDetail?.project_hierarchy_links ?? []).filter((link) => link.is_active),
    [filterProjectDetail],
  );

  const effectiveCoordinatorOrganizationIds = useMemo(() => {
    if (effectiveProjectHierarchyLinks.length === 0) return null;
    return new Set(effectiveProjectHierarchyLinks.map((link) => String(link.parent_organization)));
  }, [effectiveProjectHierarchyLinks]);

  const effectiveCoordinatorOrganizations = useMemo(
    () =>
      effectiveCoordinatorOrganizationIds
        ? organizations.filter((org) =>
            effectiveCoordinatorOrganizationIds.has(String(org.id)),
          )
        : availableCoordinatorOrganizations,
    [availableCoordinatorOrganizations, effectiveCoordinatorOrganizationIds, organizations],
  );

  // Map each coordinator → the organizations that report under it (self + descendants),
  // so the workbook dialog's Organization picker can follow the chosen Coordinator.
  const organizationsByCoordinator = useMemo(() => {
    const childrenByParent = new Map<string, string[]>();
    if (effectiveProjectHierarchyLinks.length > 0) {
      effectiveProjectHierarchyLinks.forEach((link) => {
        const parentId = String(link.parent_organization);
        const childId = String(link.child_organization);
        childrenByParent.set(parentId, [...(childrenByParent.get(parentId) || []), childId]);
      });
    } else {
      writableOrganizations.forEach((organization) => {
        const parentId = resolveParentOrganizationId(organization);
        if (!parentId) return;
        childrenByParent.set(parentId, [
          ...(childrenByParent.get(parentId) || []),
          String(organization.id),
        ]);
      });
    }

    const collectSubtree = (rootId: string) => {
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
    };

    const result: Record<string, typeof writableOrganizations> = {};
    effectiveCoordinatorOrganizations.forEach((coordinator) => {
      const ids = collectSubtree(String(coordinator.id));
      result[String(coordinator.id)] = writableOrganizations
        .filter((organization) => ids.has(String(organization.id)))
        .slice()
        .sort((left, right) => String(left.name || "").localeCompare(String(right.name || "")));
    });
    return result;
  }, [effectiveCoordinatorOrganizations, effectiveProjectHierarchyLinks, writableOrganizations]);

  const {
    parentOrgFilter,
    periodFilter,
    periodOptions,
    scopedOrganizations,
    searchQuery,
    selectedOrganizationIds,
    selectedOrganizationIdsList,
    selectedPeriodOption,
    setCoordinatorFilter,
    setPeriodFilter,
    setSearchQuery,
    setSelectedOrganizationIdsList,
  } = useAggregateFilters({
    aggregates,
    availableCoordinatorOrganizations: effectiveCoordinatorOrganizations,
    projectFilter,
    projectHierarchyLinks: effectiveProjectHierarchyLinks,
    visibleOrganizations,
  });

  useEffect(() => {
    if (appliedUrlBaseFiltersRef.current) return;
    if (!organizationsData) return;

    if (urlProjectParam && urlProjectParam !== "all") {
      setProjectFilter(urlProjectParam);
    } else if (isTrainingMode && trainingProjectId) {
      setProjectFilter(trainingProjectId);
    } else if (defaultProjectId) {
      // Single-project / backend-default users land already focused on their
      // project instead of the ambiguous "All Projects".
      setProjectFilter(defaultProjectId);
    }

    if (
      urlCoordinatorParam &&
      availableCoordinatorOrganizations.some(
        (organization) => String(organization.id) === urlCoordinatorParam,
      )
    ) {
      setCoordinatorFilter(urlCoordinatorParam);
    }

    if (urlOrganizationIds.length > 0) {
      const visibleOrganizationIdSet = new Set(
        visibleOrganizations.map((organization) => String(organization.id)),
      );
      const allowedOrganizationIds = urlOrganizationIds.filter((id) =>
        visibleOrganizationIdSet.has(id),
      );
      if (allowedOrganizationIds.length > 0) {
        setSelectedOrganizationIdsList(allowedOrganizationIds);
      }
    }

    if (urlSearchParam && urlSearchParam.trim()) {
      setSearchQuery(urlSearchParam.trim());
    }
// Auto-scope non-admin users to their own organization by default
    if (
     !isPlatformAdmin(user) &&
     urlOrganizationIds.length === 0 &&
     !urlCoordinatorParam &&
     userOrganizationId
) {
  const ownOrgId = String(userOrganizationId);
  const isVisible = visibleOrganizations.some(
    (org) => String(org.id) === ownOrgId,
  );
  if (isVisible) {
    setSelectedOrganizationIdsList([ownOrgId]);
  }
}
    appliedUrlBaseFiltersRef.current = true;
    setUrlBaseFiltersApplied(true);
  }, [
    availableCoordinatorOrganizations,
    organizationsData,
    setCoordinatorFilter,
    setProjectFilter,
    setSearchQuery,
    setSelectedOrganizationIdsList,
    urlCoordinatorParam,
    urlOrganizationIds,
    urlProjectParam,
    urlSearchParam,
    visibleOrganizations,
    isTrainingMode,
    trainingProjectId,
    defaultProjectId,
  ]);

  // Entry form: pre-select the project when a single/default/training project
  // applies, so opening "Add aggregates" doesn't force a redundant pick. The
  // submit guard (handleSave) still blocks if no project is set.
  useEffect(() => {
    if (!isDialogOpen) return;
    if (formProject) return;
    if (!defaultProjectId) return;
    handleFormProjectChange(defaultProjectId);
  }, [isDialogOpen, formProject, defaultProjectId, handleFormProjectChange]);

  useEffect(() => {
    if (appliedUrlPeriodFilterRef.current) return;
    if (!urlBaseFiltersApplied) return;

    if (!urlDateFromParam || !urlDateToParam) {
      appliedUrlPeriodFilterRef.current = true;
      return;
    }

    if (isLoading) return;

    const matchingPeriod = periodOptions.find(
      (option) => option.periodStart === urlDateFromParam && option.periodEnd === urlDateToParam,
    );
    if (matchingPeriod) {
      setPeriodFilter(matchingPeriod.id);
    }
    appliedUrlPeriodFilterRef.current = true;
  }, [
    isLoading,
    periodOptions,
    setPeriodFilter,
    urlBaseFiltersApplied,
    urlDateFromParam,
    urlDateToParam,
  ]);

  const availableFormOrganizations = useMemo(() => {
    if (!formProject) return [];

    const projectOrganizationIds = new Set(
      (selectedProjectDetail?.organizations || selectedProjectSummary?.organizations || []).map(
        (organizationId) => String(organizationId),
      ),
    );

    const scoped = visibleOrganizations.filter((organization) =>
      projectOrganizationIds.has(String(organization.id)),
    );

    return scoped
      .filter(
        (organization) =>
          canReportAcrossOrganizations ||
          writableOrganizationIds.has(String(organization.id)),
      )
      .sort((left, right) => String(left.name || "").localeCompare(String(right.name || "")));
  }, [
    canReportAcrossOrganizations,
    formProject,
    visibleOrganizations,
    selectedProjectDetail?.organizations,
    selectedProjectSummary?.organizations,
    writableOrganizationIds,
  ]);
  const availableFormOrganizationOptions = useMemo(
    () =>
      availableFormOrganizations.map((organization) => ({
        id: organization.id,
        name: String(organization.name || `Organization ${organization.id}`),
      })),
    [availableFormOrganizations],
  );
  const writableOrganizationOptions = useMemo(
    () =>
      writableOrganizations.map((organization) => ({
        id: organization.id,
        name: String(organization.name || `Organization ${organization.id}`),
      })),
    [writableOrganizations],
  );
  const visibleOrganizationOptions = useMemo(
    () =>
      visibleOrganizations.map((organization) => ({
        id: organization.id,
        name: String(organization.name || `Organization ${organization.id}`),
      })),
    [visibleOrganizations],
  );
  const availableCoordinatorOptions = useMemo(
    () =>
      availableCoordinatorOrganizations.map((organization) => ({
        id: organization.id,
        name: String(organization.name || `Organization ${organization.id}`),
      })),
    [availableCoordinatorOrganizations],
  );

  const availableIndicatorIds = useMemo(() => {
    if (!formProject || !formOrganization || !selectedProjectDetail) return new Set<string>();

    const organizationId = String(formOrganization);
    const ids = new Set<string>();

    const organizationTargets =
      selectedProjectDetail.organization_targets?.filter(
        (target) => String(target.organization) === organizationId,
      ) || [];

    organizationTargets.forEach((target) => ids.add(String(target.indicator)));

    (selectedProjectDetail.project_indicators || []).forEach((projectIndicator) => {
      ids.add(String(projectIndicator.indicator));
    });

    return ids;
  }, [formOrganization, formProject, selectedProjectDetail]);

  const availableIndicators = useMemo(() => {
    if (!formProject || !formOrganization || !selectedProjectDetail) return [];

    const organizationId = String(formOrganization);

    return indicators.filter((indicator) => {
      const indicatorId = String(indicator.id);
      if (availableIndicatorIds.size > 0 && !availableIndicatorIds.has(indicatorId)) {
        return false;
      }

      const attachedOrganizations = new Set(
        (indicator.organizations || []).map((value) => String(value)),
      );

      return attachedOrganizations.size === 0 || attachedOrganizations.has(organizationId);
    });
  }, [availableIndicatorIds, formOrganization, formProject, indicators, selectedProjectDetail]);

  const indicatorConfigs = useMemo<Record<string, AggregateEntryMatrixConfig>>(
    () =>
      Object.fromEntries(
        availableIndicators.map((indicator) => [
          String(indicator.id),
          getAggregateEntryMatrixConfig(indicator),
        ]),
      ),
    [availableIndicators],
  );

  useEffect(() => {
    if (!isDialogOpen || !isOrganizationSelectionLocked) return;
    if (!defaultOwnOrganizationValue) return;
    if (!formProject) return;
    const ownOrganizationIsAvailable = availableFormOrganizations.some(
      (organization) => String(organization.id) === defaultOwnOrganizationValue,
    );
    setFormOrganization(ownOrganizationIsAvailable ? defaultOwnOrganizationValue : "");
  }, [
    availableFormOrganizations,
    defaultOwnOrganizationValue,
    formProject,
    isDialogOpen,
    isOrganizationSelectionLocked,
    setFormOrganization,
  ]);

  useEffect(() => {
    if (!formProject) {
      if (formOrganization !== "") setFormOrganization("");
      return;
    }

    if (
      formOrganization &&
      availableFormOrganizations.some(
        (organization) => String(organization.id) === formOrganization,
      )
    ) {
      return;
    }

    if (isOrganizationSelectionLocked && defaultOwnOrganizationValue) {
      const ownOrganizationIsAvailable = availableFormOrganizations.some(
        (organization) => String(organization.id) === defaultOwnOrganizationValue,
      );
      setFormOrganization(ownOrganizationIsAvailable ? defaultOwnOrganizationValue : "");
      return;
    }

    setFormOrganization("");
  }, [
    availableFormOrganizations,
    defaultOwnOrganizationValue,
    formOrganization,
    formProject,
    isOrganizationSelectionLocked,
    setFormOrganization,
  ]);

  useEffect(() => {
    const allowedIndicatorIds = new Set(
      availableIndicators.map((indicator) => String(indicator.id)),
    );

    setSelectedIndicatorIds((previous) =>
      previous.filter((indicatorId) => allowedIndicatorIds.has(indicatorId)),
    );

    setIndicatorDrafts((previous) => {
      const next = Object.fromEntries(
        Object.entries(previous).filter(([indicatorId]) => allowedIndicatorIds.has(indicatorId)),
      );
      return Object.keys(next).length === Object.keys(previous).length ? previous : next;
    });
  }, [availableIndicators, setIndicatorDrafts, setSelectedIndicatorIds]);

  useEffect(() => {
    if (!isAutoCalcOpen || !isOrganizationSelectionLocked) return;
    if (!userOrganizationId) return;
    setAutoOrganization(String(userOrganizationId));
  }, [isAutoCalcOpen, isOrganizationSelectionLocked, userOrganizationId]);

  const filteredAggregates = useMemo(() => {
    const normalizedQuery = normalizeSearchValue(searchQuery);
    const queryTokens = normalizedQuery.length > 0 ? normalizedQuery.split(" ") : [];

    return aggregates.filter((aggregate) => {
      if (aggregate.status !== "approved") return false;

      const aggregateOrganizationId = String(aggregate.organization);
      if (!visibleOrganizationIds.has(aggregateOrganizationId)) return false;
      if (!selectedOrganizationIds.has(aggregateOrganizationId)) return false;

      const matchesProject =
        projectFilter === "all" || String(aggregate.project) === projectFilter;
      if (!matchesProject) return false;

      const matchesPeriod =
        periodFilter === "all" ||
        (selectedPeriodOption !== null &&
          String(aggregate.period_start) === selectedPeriodOption.periodStart &&
          String(aggregate.period_end) === selectedPeriodOption.periodEnd);
      if (!matchesPeriod) return false;

      if (queryTokens.length === 0) return true;

      const indicatorId = String(aggregate.indicator || "");
      const indicatorName =
        aggregate.indicator_name || indicatorNameById.get(indicatorId) || "";
      const indicatorCode =
        aggregate.indicator_code || indicatorCodeById.get(indicatorId) || "";
      const organizationName =
        aggregate.organization_name || organizationNameById.get(aggregateOrganizationId) || "";
      const projectName =
        aggregate.project_name || projectNameById.get(String(aggregate.project || "")) || "";
      const periodLabel =
        selectedPeriodOption?.label ||
        `${String(aggregate.period_start || "")} ${String(aggregate.period_end || "")}`;
      const searchableText = normalizeSearchValue(
        [
          indicatorName,
          indicatorCode,
          indicatorId,
          organizationName,
          projectName,
          periodLabel,
        ].join(" "),
      );

      return queryTokens.every((token) => searchableText.includes(token));
    });
  }, [
    aggregates,
    indicatorCodeById,
    indicatorNameById,
    organizationNameById,
    periodFilter,
    projectNameById,
    projectFilter,
    searchQuery,
    selectedOrganizationIds,
    selectedPeriodOption,
    visibleOrganizationIds,
  ]);

  const dedupedFilteredAggregates = useMemo(() => {
    const shouldDedupeRollups =
      parentOrgFilter === "all" && selectedOrganizationIdsList.length === 0;

    if (!shouldDedupeRollups) {
      return filteredAggregates;
    }

    return dedupeRollupAggregates(filteredAggregates, organizations);
  }, [
    filteredAggregates,
    organizations,
    parentOrgFilter,
    selectedOrganizationIdsList.length,
  ]);

  const aggregateGroups = useMemo<AggregateIndicatorGroup[]>(
    () =>
      groupAggregatesByIndicator(
        dedupedFilteredAggregates,
        indicatorNameById,
        indicatorCodeById,
      ),
    [dedupedFilteredAggregates, indicatorCodeById, indicatorNameById],
  );
  const reportedAggregateGroups = useMemo<AggregateIndicatorGroup[]>(
    () =>
      aggregateGroups.filter((group) =>
        group.items.some((aggregate) => getAggregateTotal(aggregate) > 0),
      ),
    [aggregateGroups],
  );
  const reportedAggregateRowsCount = useMemo(
    () =>
      reportedAggregateGroups.reduce(
        (sum, group) => sum + group.items.length,
        0,
      ),
    [reportedAggregateGroups],
  );

  const {
    chartData,
    chartMeta,
    chartSeries,
    chartSubtitle,
    chartTitle,
    isChartOpen,
    openChartForGroup,
    selectedChartGroup,
    setIsChartOpen,
  } = useAggregateChartState({
    aggregateGroups: reportedAggregateGroups,
    indicatorById,
  });

  const chartTarget = useMemo<number | undefined>(() => {
    if (!selectedChartGroup || !selectedProjectDetail) return undefined;
    const allItemsMatchSelectedProject = selectedChartGroup.items.every(
      (item) => String(item.project) === String(selectedProjectDetail.id),
    );
    if (!allItemsMatchSelectedProject) return undefined;
    const indicatorId = String(selectedChartGroup.indicatorId);
    const matchingTargets = (selectedProjectDetail.project_indicators || []).filter(
      (entry) => String(entry.indicator) === indicatorId,
    );
    if (matchingTargets.length === 0) return undefined;
    const total = matchingTargets.reduce((sum, entry) => sum + Number(entry.target_value || 0), 0);
    return total > 0 ? total : undefined;
  }, [selectedChartGroup, selectedProjectDetail]);

  const reviewQueueAggregates = useMemo(
    () =>
      aggregates
        .filter(
          (aggregate) =>
            visibleOrganizationIds.has(String(aggregate.organization)) &&
            (aggregate.status === "pending" ||
              aggregate.status === "reviewed" ||
              aggregate.status === "flagged"),
        )
        .sort((left, right) => String(left.created_at).localeCompare(String(right.created_at))),
    [aggregates, visibleOrganizationIds],
  );

  const correctionQueueAggregates = useMemo(
    () =>
      aggregates
        .filter(
          (aggregate) =>
            visibleOrganizationIds.has(String(aggregate.organization)) &&
            aggregate.status === "flagged" &&
            (canReportAcrossOrganizations ||
              writableOrganizationIds.has(String(aggregate.organization))),
        )
        .sort((left, right) => String(right.updated_at).localeCompare(String(left.updated_at))),
    [aggregates, canReportAcrossOrganizations, visibleOrganizationIds, writableOrganizationIds],
  );

  useEffect(() => {
    if (!reviewAggregateIdParam || !canMarkReviewed) return;
    const hasMatch = reviewQueueAggregates.some(
      (aggregate) => String(aggregate.id) === reviewAggregateIdParam,
    );
    if (hasMatch) {
      setIsReviewQueueOpen(true);
    }
  }, [canMarkReviewed, reviewAggregateIdParam, reviewQueueAggregates]);
  const {
    actingAggregateId,
    actingReviewAction,
    handleApproveAggregate,
    handleBulkApproveAggregates,
    handleBulkDeleteAggregates,
    handleDeleteAggregate,
    handleFlagAggregate,
    handleReviewAggregate,
    handleUpdateAggregate,
  } = useAggregateReviewActions({
    mutate: async () => {
      await mutate();
    },
    toast,
  });

  const resetAutoCalcForm = () => {
    setAutoOutputIndicator("");
    setAutoSourceIndicator("");
    setAutoOperator("equals");
    setAutoMatchValue("yes");
    setAutoCountDistinct("respondent");
    setAutoProject("");
    setAutoOrganization("");
    setAutoPeriodStart("");
    setAutoPeriodEnd("");
    setAutoSaveRule(true);
    setAutoSaveAggregate(true);
    setAutoComputed(null);
  };

  const autoCalcAvailable = true;

  const hasActiveFilters =
    searchQuery.trim().length > 0 ||
    projectFilter !== "all" ||
    parentOrgFilter !== "all" ||
    selectedOrganizationIdsList.length > 0 ||
    periodFilter !== "all";

  const activeFilterBadges = useMemo(() => {
    const filters: string[] = [];

    if (searchQuery.trim()) {
      filters.push(`Search: ${searchQuery.trim()}`);
    }

    if (projectFilter !== "all") {
      filters.push(`Project: ${projectNameById.get(projectFilter) || "Selected"}`);
    }

    if (parentOrgFilter !== "all") {
      const coordinatorName =
        availableCoordinatorOptions.find(
          (organization) => String(organization.id) === parentOrgFilter,
        )?.name || "Selected coordinator";
      filters.push(`Coordinator: ${coordinatorName}`);
    }

    if (selectedOrganizationIdsList.length > 0) {
      filters.push(
        `Organizations: ${selectedOrganizationIdsList.length} selected`,
      );
    }

    if (periodFilter !== "all" && selectedPeriodOption) {
      filters.push(`Period: ${selectedPeriodOption.label}`);
    }

    return filters;
  }, [
    availableCoordinatorOptions,
    parentOrgFilter,
    periodFilter,
    projectFilter,
    projectNameById,
    searchQuery,
    selectedOrganizationIdsList.length,
    selectedPeriodOption,
  ]);

  const handleResetFilters = () => {
    setSearchQuery("");
    setProjectFilter("all");
    setCoordinatorFilter("all");
    setSelectedOrganizationIdsList([]);
    setPeriodFilter("all");
  };

  const downloadBlob = (blob: Blob, filename: string) => {
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = filename;
    link.rel = "noopener";
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  };

  const handleExport = async () => {
    try {
      const exportOrganizationIds = Array.from(
        new Set(dedupedFilteredAggregates.map((aggregate) => String(aggregate.organization))),
      );
      if (exportOrganizationIds.length === 0) {
        toast({
          title: "No aggregate rows in scope",
          description: "Update your filters before exporting.",
          variant: "destructive",
        });
        return;
      }
      const exportRequest = {
        format: "excel",
        sheet_layout: "organization_template",
        search: searchQuery.trim() || undefined,
        project: projectFilter !== "all" ? projectFilter : undefined,
        organization: exportOrganizationIds.join(","),
        date_from: selectedPeriodOption?.periodStart,
        date_to: selectedPeriodOption?.periodEnd,
      } as const;

      const job = await aggregatesService.startExportJob(exportRequest);
      toast({
        title: "Export started",
        description: `Export job #${job.id} is running in the background.`,
      });

      let currentJob = job;
      for (let attempt = 0; attempt < 30; attempt += 1) {
        if (currentJob.status === "completed") break;
        if (currentJob.status === "failed") {
          throw new Error("Export job failed.");
        }
        await new Promise((resolve) => window.setTimeout(resolve, 2000));
        currentJob = await uploadsService.getExportJob(job.id);
      }

      if (currentJob.status === "completed") {
        const blob = await uploadsService.downloadExportJob(job.id);
        downloadBlob(
          blob,
          currentJob.file_name || `aggregates_export_${new Date().toISOString().slice(0, 10)}.xlsx`,
        );
        toast({
          title: "Export ready",
          description: `Export job #${job.id} completed and downloaded.`,
        });
        return;
      }

      toast({
        title: "Export still running",
        description: `Export job #${job.id} is still processing. Check Uploads > All Imports shortly.`,
      });
    } catch (err) {
      console.error("Failed to export aggregates", err);
      toast({
        title: "Export failed",
        description: "Unable to export aggregates.",
        variant: "destructive",
      });
    }
  };


  const createIndicatorDraft = (indicatorId: string): AggregateEntryDraft => {
    const config = indicatorConfigs[indicatorId] || getAggregateEntryMatrixConfig();
    return {
      total: "",
      matrixValues: buildEmptyEntryMatrix(config),
    };
  };

  const toggleSelectedIndicator = (indicatorId: string) => {
    setSelectedIndicatorIds((previous) => {
      const exists = previous.includes(indicatorId);
      if (exists) {
        setIndicatorDrafts((current) => {
          const next = { ...current };
          delete next[indicatorId];
          return next;
        });
        return previous.filter((value) => value !== indicatorId);
      }

      setIndicatorDrafts((current) => ({
        ...current,
        [indicatorId]: current[indicatorId] || createIndicatorDraft(indicatorId),
      }));
      return [...previous, indicatorId];
    });
  };

  const handleIndicatorTotalChange = (indicatorId: string, value: string) => {
    setIndicatorDrafts((previous) => ({
      ...previous,
      [indicatorId]: {
        ...(previous[indicatorId] || createIndicatorDraft(indicatorId)),
        total: value,
      },
    }));
  };

  const handleIndicatorMatrixCellChange = (
    indicatorId: string,
    primaryValue: string,
    secondaryValue: string,
    bandValue: string,
    value: string,
  ) => {
    setIndicatorDrafts((previous) => {
      const current = previous[indicatorId] || createIndicatorDraft(indicatorId);
      return {
        ...previous,
        [indicatorId]: {
          ...current,
          matrixValues: {
            ...current.matrixValues,
            [primaryValue]: {
              ...current.matrixValues[primaryValue],
              [secondaryValue]: {
                ...current.matrixValues[primaryValue]?.[secondaryValue],
                [bandValue]: value,
              },
            },
          },
        },
      };
    });
  };

  const handleSave = async () => {
    if (
      !formProject ||
      !formOrganization ||
      !formPeriodStart ||
      !formPeriodEnd ||
      selectedIndicatorIds.length === 0
    ) {
      toast({
        title: "Missing required fields",
        description: "Project, organization, period dates, and at least one indicator are required.",
        variant: "destructive",
      });
      return;
    }

    if (!selectedProjectDetail) {
      toast({
        title: "Project still loading",
        description: "Please wait for the selected project's organizations and indicators to load.",
        variant: "destructive",
      });
      return;
    }

    if (!isValidDateRange(formPeriodStart, formPeriodEnd)) {
      toast({
        title: "Invalid reporting period",
        description: "Period end must be on or after period start.",
        variant: "destructive",
      });
      return;
    }

    if (!canReportAcrossOrganizations && !writableOrganizationIds.has(formOrganization)) {
      toast({
        title: "Organization restricted",
        description: "You can only submit aggregate data for your own organization.",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const combinedNotes = [
        formNotes.trim(),
        formDataSource.trim() ? `Data source: ${formDataSource.trim()}` : "",
      ]
        .filter(Boolean)
        .join(" | ");

      const payload = selectedIndicatorIds.map((indicatorId) => {
        const config = indicatorConfigs[indicatorId] || getAggregateEntryMatrixConfig();
        const draft = indicatorDrafts[indicatorId] || createIndicatorDraft(indicatorId);
        const valuePayload: AggregateValue = {};

        if (config.hasDisaggregates) {
          const total = computeEntryMatrixTotal(draft.matrixValues, config);
          if (total === 0) {
            throw new Error(
              `${indicatorById.get(indicatorId)?.name || "Indicator"} is missing disaggregated values.`,
            );
          }
          valuePayload.total = total;
          valuePayload.disaggregates = buildEntryMatrixPayload(draft.matrixValues, config);
        } else {
          const total = parseNumberInput(draft.total);
          if (total === undefined) {
            throw new Error(
              `${indicatorById.get(indicatorId)?.name || "Indicator"} requires a total value.`,
            );
          }
          valuePayload.total = total;
        }

        return {
          indicator: Number(indicatorId),
          value: valuePayload,
          notes: combinedNotes,
        };
      });

      await aggregatesService.bulkCreate({
        project: Number(formProject),
        organization: Number(formOrganization),
        period_start: formPeriodStart,
        period_end: formPeriodEnd,
        data: payload,
      });

      toast({
        title: "Aggregates saved",
        description: `${payload.length} indicator entr${payload.length === 1 ? "y" : "ies"} submitted for coordinator review.`,
      });

      await mutate();
      setIsDialogOpen(false);
      resetForm();
    } catch (err) {
      console.error("Failed to create aggregate", err);
      toast({
        title: "Error",
        description:
          err instanceof Error ? err.message : "Failed to create aggregate entries.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAutoCalculate = async () => {
    if (
      !autoOutputIndicator ||
      !autoSourceIndicator ||
      !autoProject ||
      !autoOrganization ||
      !autoPeriodStart ||
      !autoPeriodEnd
    ) {
      toast({
        title: "Missing required fields",
        description: "Output, source, project, organization, and period dates are required.",
        variant: "destructive",
      });
      return;
    }

    if (
      autoSaveAggregate &&
      !canReportAcrossOrganizations &&
      !writableOrganizationIds.has(autoOrganization)
    ) {
      toast({
        title: "Organization restricted",
        description: "You can only save aggregates for your own organization.",
        variant: "destructive",
      });
      return;
    }

    if (!isValidDateRange(autoPeriodStart, autoPeriodEnd)) {
      toast({
        title: "Invalid reporting period",
        description: "Period end must be on or after period start.",
        variant: "destructive",
      });
      return;
    }

    setIsAutoCalcSubmitting(true);
    try {
      const result = await aggregatesService.generateFromInteractions({
        output_indicator: Number(autoOutputIndicator),
        source_indicator: Number(autoSourceIndicator),
        operator: autoOperator,
        match_value: autoMatchValue,
        count_distinct: autoCountDistinct,
        project: Number(autoProject),
        organization: Number(autoOrganization),
        period_start: autoPeriodStart,
        period_end: autoPeriodEnd,
        save_rule: autoSaveRule,
        save_aggregate: autoSaveAggregate,
      });

      setAutoComputed(result.computed);
      if (autoSaveAggregate) {
        await mutate();
      }

      toast({
        title: "Auto-calculation complete",
        description: `Computed value: ${result.computed}`,
      });
    } catch (err) {
      console.error("Failed to auto-calculate aggregate", err);
      toast({
        title: "Error",
        description: "Failed to auto-calculate from interactions.",
        variant: "destructive",
      });
    } finally {
      setIsAutoCalcSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-[60vh] flex-col items-center justify-center gap-4">
        <p className="text-center text-muted-foreground">{aggregateLoadErrorMessage}</p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button onClick={() => mutate()}>Retry</Button>
          {aggregateLoadErrorStatus === 401 ? (
            <Button variant="outline" onClick={() => router.push("/login")}>
              Go to Login
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Aggregates"
        description="Enter and manage aggregate data without individual respondent tracking"
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Aggregates" },
        ]}
        actions={
          <div className="flex w-full justify-end sm:w-auto">
            <div className="flex w-full items-center justify-end gap-2 overflow-x-auto whitespace-nowrap pb-1 sm:w-auto sm:overflow-visible [&_button]:shrink-0">
            {canMarkReviewed && can("aggregates", "review") ? (
              <Button variant="outline" onClick={() => setIsReviewQueueOpen(true)}>
                <Clock3 className="mr-2 h-4 w-4" />
                Queued Review
                <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                  {reviewQueueAggregates.length}
                </span>
              </Button>
            ) : null}
            {can("aggregates", "create") ? (
              <ReportingWorkbookDialog
                projects={projects}
                organizations={writableOrganizations}
                coordinators={effectiveCoordinatorOrganizations}
                organizationsByCoordinator={organizationsByCoordinator}
                defaultProject={projectFilter}
                defaultCoordinator={parentOrgFilter}
                onImported={() => { void mutate(); }}
              />
            ) : null}
            {can("aggregates", "export") ? (
              <Button variant="outline" onClick={handleExport}>
                <Download className="mr-2 h-4 w-4" /> Export
              </Button>
            ) : null}

            {autoCalcAvailable ? (
              <AggregateAutoCalcDialog
                open={isAutoCalcOpen}
                onOpenChange={(open) => {
                  setIsAutoCalcOpen(open);
                  if (!open) resetAutoCalcForm();
                }}
                onCalculate={handleAutoCalculate}
                isSubmitting={isAutoCalcSubmitting}
                computedValue={autoComputed}
                projects={projectOptions}
                organizations={writableOrganizationOptions}
                indicators={indicatorOptions}
                isOrganizationSelectionLocked={isOrganizationSelectionLocked}
                autoProject={autoProject}
                setAutoProject={setAutoProject}
                autoOrganization={autoOrganization}
                setAutoOrganization={setAutoOrganization}
                autoOutputIndicator={autoOutputIndicator}
                setAutoOutputIndicator={setAutoOutputIndicator}
                autoSourceIndicator={autoSourceIndicator}
                setAutoSourceIndicator={setAutoSourceIndicator}
                autoOperator={autoOperator}
                setAutoOperator={setAutoOperator}
                autoMatchValue={autoMatchValue}
                setAutoMatchValue={setAutoMatchValue}
                autoCountDistinct={autoCountDistinct}
                setAutoCountDistinct={setAutoCountDistinct}
                autoPeriodStart={autoPeriodStart}
                setAutoPeriodStart={setAutoPeriodStart}
                autoPeriodEnd={autoPeriodEnd}
                setAutoPeriodEnd={setAutoPeriodEnd}
                autoSaveRule={autoSaveRule}
                setAutoSaveRule={setAutoSaveRule}
                autoSaveAggregate={autoSaveAggregate}
                setAutoSaveAggregate={setAutoSaveAggregate}
              />
            ) : null}

            <AggregateEntryDialog
              open={isDialogOpen}
              onOpenChange={(open) => {
                setIsDialogOpen(open);
                if (!open) resetForm();
              }}
              onSave={handleSave}
              isSubmitting={isSubmitting}
              projects={projectOptions}
              availableOrganizations={availableFormOrganizationOptions}
              availableIndicators={availableIndicators}
              isOrganizationSelectionLocked={isOrganizationSelectionLocked}
              formProject={formProject}
              setFormProject={handleFormProjectChange}
              formOrganization={formOrganization}
              setFormOrganization={handleFormOrganizationChange}
              selectedIndicatorIds={selectedIndicatorIds}
              onToggleIndicator={toggleSelectedIndicator}
              indicatorDrafts={indicatorDrafts}
              indicatorConfigs={indicatorConfigs}
              onTotalChange={handleIndicatorTotalChange}
              onMatrixCellChange={handleIndicatorMatrixCellChange}
              formPeriodStart={formPeriodStart}
              setFormPeriodStart={setFormPeriodStart}
              formPeriodEnd={formPeriodEnd}
              setFormPeriodEnd={setFormPeriodEnd}
              formDataSource={formDataSource}
              setFormDataSource={setFormDataSource}
              formNotes={formNotes}
              setFormNotes={setFormNotes}
            />
            </div>
          </div>
        }
      />

      {canMarkReviewed ? (
        <Dialog open={isReviewQueueOpen} onOpenChange={setIsReviewQueueOpen}>
          <DialogContent className="fixed inset-0 !top-0 !left-0 !translate-x-0 !translate-y-0 !h-screen !w-screen !max-w-none overflow-hidden rounded-none p-0">
            <DialogHeader className="border-b border-border/70 px-6 py-4">
              <DialogTitle className="flex items-center gap-2">
                <Clock3 className="h-5 w-5" />
                Queued Review
              </DialogTitle>
              <DialogDescription>
                {canApproveAggregates
                  ? "Review submissions, flag issues for correction, and approve only after review."
                  : "Review your organization's submissions and mark them as reviewed. A BONASO M&E Manager approves them after review."}
              </DialogDescription>
            </DialogHeader>
            <div className="h-[calc(100vh-88px)] overflow-y-auto p-6">
              <AggregateReviewQueue
                items={reviewQueueAggregates}
                indicatorNameById={indicatorNameById}
                indicatorById={indicatorById}
                projectNameById={projectNameById}
                projects={projects}
                organizations={visibleOrganizationOptions}
                indicators={indicatorOptions}
                onReview={handleReviewAggregate}
                onApprove={handleApproveAggregate}
                onApproveAll={handleBulkApproveAggregates}
                onDeleteAll={handleBulkDeleteAggregates}
                onFlag={handleFlagAggregate}
                onUpdate={handleUpdateAggregate}
                onDelete={handleDeleteAggregate}
                actingAggregateId={actingAggregateId}
                actingReviewAction={actingReviewAction}
                canBulkApproveAll
                canApprove={canApproveAggregates}
                embedded
                initialReviewAggregateId={reviewAggregateIdParam}
              />
            </div>
          </DialogContent>
        </Dialog>
      ) : null}

      {canMarkReviewed && reviewQueueAggregates.length > 0 ? (
        <Alert>
          <Clock3 className="h-4 w-4" />
          <AlertTitle>Queued aggregates are awaiting review</AlertTitle>
          <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span>
              {reviewQueueAggregates.length} aggregate row(s) are currently pending, reviewed, or flagged.
              They do not appear in the main aggregate table until approved.
            </span>
            <Button variant="outline" size="sm" onClick={() => setIsReviewQueueOpen(true)}>
              Open Queued Review
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {!canReviewAggregates && correctionQueueAggregates.length > 0 ? (
        <AggregateReviewQueue
          items={correctionQueueAggregates}
          indicatorNameById={indicatorNameById}
          indicatorById={indicatorById}
          projectNameById={projectNameById}
          projects={projects}
          organizations={writableOrganizationOptions}
          indicators={indicatorOptions}
          onReview={handleReviewAggregate}
          onApprove={handleApproveAggregate}
          onApproveAll={handleBulkApproveAggregates}
          onDeleteAll={handleBulkDeleteAggregates}
          onFlag={handleFlagAggregate}
          onUpdate={handleUpdateAggregate}
          onDelete={handleDeleteAggregate}
          actingAggregateId={actingAggregateId}
          actingReviewAction={actingReviewAction}
          mode="correction"
          initialReviewAggregateId={reviewAggregateIdParam}
        />
      ) : null}

      <Alert className="border-border/70">
        <AlertTitle>Hierarchy is managed in Project Setup</AlertTitle>
        <AlertDescription>
          Organization hierarchy for each project is configured under{" "}
          <strong>Projects → [Project Name] → Setup tab</strong>.
          Select a project in the filter below to see coordinator groupings derived from its hierarchy.
        </AlertDescription>
      </Alert>

      <Card className="border-border/70 shadow-sm">
        <CardHeader className="gap-4 pb-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-1">
              <CardTitle className="text-xl">Browse Aggregate Data</CardTitle>
              <CardDescription>
                Narrow the table by project, coordinator, organization, and reporting period.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2 overflow-x-auto">
              <Badge variant="secondary" className="h-7 shrink-0 rounded-full px-2.5 text-xs font-medium">
                {reportedAggregateRowsCount.toLocaleString()} rows
              </Badge>
              <Badge variant="outline" className="h-7 shrink-0 rounded-full px-2.5 text-xs font-medium">
                {reportedAggregateGroups.length.toLocaleString()} indicator groups
              </Badge>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 shrink-0 px-2.5 text-xs"
                onClick={handleResetFilters}
                disabled={!hasActiveFilters}
              >
                <RefreshCcw className="mr-2 h-4 w-4" />
                Reset filters
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Current-project context / guidance (risk R7) */}
          {!hasProjects ? (
            <NoProjectEmptyState
              title="No active project available"
              description="You are not assigned to any active project yet. Ask an administrator to assign you to a project to start entering and reviewing data."
            />
          ) : projectFilter !== "all" ? (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-border/60 bg-muted/40 px-3 py-2 text-sm">
              <span className="font-medium text-foreground">Current project:</span>
              <span className="text-muted-foreground">
                {projectNameById.get(projectFilter) || "Selected project"}
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
              <span>Multiple projects are available — select a project below to focus the data.</span>
            </div>
          ) : null}

          <div className="grid items-end gap-2 md:grid-cols-2 lg:grid-cols-[minmax(220px,1.15fr)_repeat(4,minmax(170px,1fr))]">
            <div className="space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Search
              </p>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search indicators..."
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  className="h-9 pl-9"
                />
              </div>
            </div>

            <div className="space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Project
              </p>
              <Select value={projectFilter} onValueChange={setProjectFilter}>
                <SelectTrigger className="h-9 w-full">
                  <Filter className="mr-2 h-4 w-4" />
                  <SelectValue placeholder="Project" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Projects</SelectItem>
                  {projects.map((project) => (
                    <SelectItem key={project.id} value={String(project.id)}>
                      {project.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Coordinator
              </p>
              <Select value={parentOrgFilter} onValueChange={setCoordinatorFilter}>
                <SelectTrigger className="h-9 w-full">
                  <SelectValue placeholder="Coordinator" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Coordinators</SelectItem>
                  {availableCoordinatorOptions.map((organization) => (
                    <SelectItem key={organization.id} value={String(organization.id)}>
                      {organization.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Organizations
              </p>
              <OrganizationMultiSelect
                className="h-9"
                allLabel={
                  parentOrgFilter === "all"
                    ? "All organizations"
                    : "All organizations in coordinator scope"
                }
                emptyMeansAll
                organizations={scopedOrganizations.map((organization) => ({
                  id: organization.id,
                  name: organization.name || "Organization",
                }))}
                selectedIds={selectedOrganizationIdsList}
                onChange={setSelectedOrganizationIdsList}
              />
            </div>

            <div className="space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Period
              </p>
              <Select value={periodFilter} onValueChange={setPeriodFilter}>
                <SelectTrigger className="h-9 w-full">
                  <Calendar className="mr-2 h-4 w-4" />
                  <SelectValue placeholder="Period" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Periods</SelectItem>
                  {periodOptions.map((period) => (
                    <SelectItem key={period.id} value={period.id}>
                      {period.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            {selectedOrganizationIdsList.length > 0
              ? `${selectedOrganizationIdsList.length} organizations selected`
              : `${scopedOrganizations.length} in scope, all included`}
          </p>

          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            {activeFilterBadges.length > 0 ? (
              activeFilterBadges.map((filterLabel) => (
                <Badge key={filterLabel} variant="outline" className="rounded-full">
                  {filterLabel}
                </Badge>
              ))
            ) : (
              <span>Showing all approved aggregate data in your current access scope.</span>
            )}
          </div>
        </CardContent>
      </Card>

      <section className="space-y-3">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-foreground">Results</h2>
            <p className="text-sm text-muted-foreground">
              Aggregates are grouped by indicator, project scope, organization scope, and reporting period.
            </p>
          </div>
          <p className="text-sm text-muted-foreground">
            Click <span className="font-medium text-foreground">Chart</span> on any group for a quick visual breakdown.
          </p>
        </div>

        <AggregateMatrixTable
          aggregateGroups={reportedAggregateGroups}
          projectNameById={projectNameById}
          indicatorById={indicatorById}
          onViewChart={openChartForGroup}
        />
      </section>

      <AggregateChartDialog
        open={isChartOpen}
        onOpenChange={setIsChartOpen}
        data={chartData}
        series={chartSeries}
        title={chartTitle}
        subtitle={chartSubtitle}
        meta={chartMeta}
        target={chartTarget}
      />
    </div>
  );
}

export default function AggregatesPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-[60vh] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      }
    >
      <AggregatesPageContent />
    </Suspense>
  );
}
