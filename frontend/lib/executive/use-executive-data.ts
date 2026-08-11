"use client";

/**
 * Executive Dashboard data hook.
 *
 * Reuses the SAME project -> coordinator -> organisation hierarchy scoping as the
 * home dashboard (never the flat org list): the selected project's
 * ProjectOrganizationHierarchy + hierarchy_overrides drive a `scopedOrganizationIds`
 * set, which is fed to `buildHomeDashboardScreeningInsights`. Training/live
 * isolation is honoured via the session mode + aggregate filters, exactly like the
 * home dashboard. KPIs are derived through the shared RAG engine.
 */
import { useMemo } from "react";
import {
  useAllAggregates,
  useAllIndicators,
  useAllOrganizations,
  useAllProjectDetails,
  useCoordinatorTargetRollup,
} from "@/lib/hooks/use-api";
import type { CoordinatorTargetQuarter } from "@/lib/api/services/coordinator-targets";
import { useAuth } from "@/lib/contexts/auth-context";
import { useSessionMode } from "@/lib/contexts/session-mode-context";
import { useAggregateVisibilityScope } from "@/app/(dashboard)/aggregates/hooks";
import { buildOrganizationDescendantMap } from "@/lib/analytics/org-scope";
import { buildHomeDashboardScreeningInsights } from "@/lib/dashboard/screening-insights";
import { getQuarterBucket, formatQuarterBucket } from "@/lib/aggregates/quarter-buckets";
import { getPerformanceStatus } from "@/components/dashboard/engine/performance-status";
import { toSafeNumber } from "@/components/dashboard/engine/normalize-indicators";
import type { Project } from "@/lib/types";

export type ExecutiveFilters = {
  projectId: string; // "all" | id
  coordinatorId: string; // "all" | id
  organizationId: string; // "all" | id
  district: string; // "all" | district name
  indicatorId: string; // "all" | id
  dateFrom: string;
  dateTo: string;
};

export const DEFAULT_EXECUTIVE_FILTERS: ExecutiveFilters = {
  projectId: "all",
  coordinatorId: "all",
  organizationId: "all",
  district: "all",
  indicatorId: "all",
  dateFrom: "",
  dateTo: "",
};

export type ExecutiveSubmission = {
  organization: string;
  indicator: string;
  period: string;
  submittedOn: string;
  status: string;
};

const coerceId = (value: unknown) => String(value ?? "").trim();

function toProjectOrganizationIds(project: Project | null | undefined): string[] {
  if (!project || !Array.isArray(project.organizations)) return [];
  return Array.from(
    new Set(project.organizations.map((id) => coerceId(id)).filter((id) => id.length > 0)),
  );
}

function normalizeHierarchyOverrides(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, string[]> = {};
  Object.entries(value as Record<string, unknown>).forEach(([rawParent, rawChildren]) => {
    const parentId = coerceId(rawParent);
    if (!parentId || !Array.isArray(rawChildren)) return;
    out[parentId] = Array.from(
      new Set(
        rawChildren.map((c) => coerceId(c)).filter((c) => c.length > 0 && c !== parentId),
      ),
    );
  });
  return out;
}

function orgDistrict(org: Record<string, unknown>): string {
  return String(org?.district ?? org?.district_name ?? org?.district_display ?? "").trim();
}

export function useExecutiveData(filters: ExecutiveFilters) {
  const { user } = useAuth();
  const { isTrainingMode, trainingProjectId } = useSessionMode();

  const selectedProjectId = filters.projectId !== "all" ? filters.projectId : undefined;
  const selectedCoordinatorId = filters.coordinatorId !== "all" ? filters.coordinatorId : undefined;
  const selectedOrganizationId = filters.organizationId !== "all" ? filters.organizationId : undefined;

  const { data: organizationsData } = useAllOrganizations();
  const { data: projectsData } = useAllProjectDetails();
  const { data: indicatorsData, isLoading: indicatorsLoading } = useAllIndicators({ is_active: "true" });

  const aggregatesFilters = useMemo(
    () => ({
      project: isTrainingMode ? (trainingProjectId ?? undefined) : selectedProjectId,
      coordinator: isTrainingMode ? undefined : selectedCoordinatorId,
      organization: isTrainingMode ? undefined : selectedOrganizationId,
      include_org_descendants: !isTrainingMode && selectedOrganizationId ? "true" : undefined,
      include_training: isTrainingMode ? "true" : undefined,
      date_from: filters.dateFrom || undefined,
      date_to: filters.dateTo || undefined,
      status: "approved",
      light: "1",
    }),
    [
      isTrainingMode,
      trainingProjectId,
      selectedProjectId,
      selectedCoordinatorId,
      selectedOrganizationId,
      filters.dateFrom,
      filters.dateTo,
    ],
  );
  const { data: aggregatesData, isLoading: aggregatesLoading, error: aggregatesError } =
    useAllAggregates(aggregatesFilters);

  const organizations = useMemo(() => organizationsData?.results || [], [organizationsData]);
  const allProjects = useMemo(() => {
    const raw = projectsData?.results || [];
    return isTrainingMode ? raw.filter((p) => p.is_training) : raw.filter((p) => !p.is_training);
  }, [projectsData, isTrainingMode]);

  const selectedProject = useMemo(
    () =>
      selectedProjectId
        ? (allProjects.find((p) => String(p.id) === selectedProjectId) as Project | undefined) || null
        : null,
    [allProjects, selectedProjectId],
  );
  const selectedProjectHierarchy = useMemo(
    () => normalizeHierarchyOverrides(selectedProject?.hierarchy_overrides),
    [selectedProject],
  );
  const selectedProjectOrganizationIds = useMemo(
    () => toProjectOrganizationIds(selectedProject),
    [selectedProject],
  );

  const { availableCoordinatorOrganizations } = useAggregateVisibilityScope({ organizations, user });

  const descendantsByParent = useMemo(
    () =>
      buildOrganizationDescendantMap(
        organizations,
        selectedProject
          ? { hierarchyOverrides: selectedProjectHierarchy, scopedOrganizationIds: selectedProjectOrganizationIds }
          : undefined,
      ),
    [organizations, selectedProject, selectedProjectHierarchy, selectedProjectOrganizationIds],
  );

  // Coordinator options follow the selected project.
  const coordinatorOptions = useMemo(() => {
    if (!selectedProjectId || selectedProjectOrganizationIds.length === 0) {
      return availableCoordinatorOrganizations;
    }
    const ids = new Set(selectedProjectOrganizationIds);
    const scoped = availableCoordinatorOrganizations.filter((o) => ids.has(String(o.id)));
    return scoped.length > 0 ? scoped : availableCoordinatorOrganizations;
  }, [availableCoordinatorOrganizations, selectedProjectId, selectedProjectOrganizationIds]);

  const coordinatorScopedOrganizationIds = useMemo<Set<string> | null>(() => {
    if (!selectedCoordinatorId) return null;
    return new Set<string>([
      selectedCoordinatorId,
      ...((descendantsByParent[selectedCoordinatorId] || []) as string[]),
    ]);
  }, [descendantsByParent, selectedCoordinatorId]);

  const organizationOptions = useMemo(() => {
    if (!coordinatorScopedOrganizationIds) return organizations;
    return organizations.filter((o) => coordinatorScopedOrganizationIds.has(String(o.id)));
  }, [coordinatorScopedOrganizationIds, organizations]);

  // Hierarchy-scoped org id set (project -> coordinator -> org), then optional district narrowing.
  const scopedOrganizationIds = useMemo<Set<string> | null>(() => {
    let base: Set<string> | null = coordinatorScopedOrganizationIds;
    if (selectedOrganizationId) {
      const orgScope = new Set<string>([
        selectedOrganizationId,
        ...((descendantsByParent[selectedOrganizationId] || []) as string[]),
      ]);
      const current = base;
      base = current
        ? new Set<string>(Array.from(orgScope).filter((id) => current.has(id)))
        : orgScope;
    }
    if (filters.district !== "all") {
      const inDistrict = new Set<string>(
        organizations
          .filter((o) => orgDistrict(o as Record<string, unknown>) === filters.district)
          .map((o) => String(o.id)),
      );
      base = base
        ? new Set<string>(Array.from(base).filter((id) => inDistrict.has(id)))
        : inDistrict;
    }
    return base;
  }, [coordinatorScopedOrganizationIds, descendantsByParent, selectedOrganizationId, filters.district, organizations]);

  const activeProjects = useMemo(() => {
    return allProjects.filter((project) => {
      if (selectedProjectId && String(project.id) !== selectedProjectId) return false;
      if (!scopedOrganizationIds) return true;
      const ids = (project.organizations || []).map((id) => String(id));
      return ids.some((id) => scopedOrganizationIds.has(id));
    });
  }, [allProjects, scopedOrganizationIds, selectedProjectId]);

  const analyticsLoading = aggregatesLoading || indicatorsLoading;

  const insights = useMemo(() => {
    const fromQ = filters.dateFrom ? getQuarterBucket(filters.dateFrom) : null;
    const toQ = filters.dateTo ? getQuarterBucket(filters.dateTo) : null;
    const selectedQuarter =
      fromQ && toQ
        ? fromQ.year === toQ.year && fromQ.quarter === toQ.quarter
          ? fromQ.quarter
          : null
        : fromQ?.quarter ?? toQ?.quarter ?? null;
    return buildHomeDashboardScreeningInsights({
      aggregatesData,
      indicatorsData,
      organizations,
      activeProjects,
      scopedOrganizationIds,
      selectedQuarter,
      includeHivPreventionMessageTypeByCso: false,
      selectedProjectId: selectedProjectId || null,
      isLoading: analyticsLoading,
      hasError: Boolean(aggregatesError),
    });
  }, [
    aggregatesData,
    indicatorsData,
    organizations,
    activeProjects,
    scopedOrganizationIds,
    selectedProjectId,
    analyticsLoading,
    aggregatesError,
    filters.dateFrom,
    filters.dateTo,
  ]);

  // Optional indicator narrowing for the tables (display-only).
  // Effective (SSoT) targets — includes DERIVED / PERCENTAGE targets that have no
  // stored value (computed at read time by analysis.services.coordinator_rollups).
  // Sourced from the coordinator-targets rollup so we never recompute derivation
  // client-side. Used whenever a project is selected; else fall back to the
  // stored-target insights path.
  const quarterParam: CoordinatorTargetQuarter | "all" | undefined = useMemo(() => {
    const f = filters.dateFrom ? getQuarterBucket(filters.dateFrom) : null;
    const t = filters.dateTo ? getQuarterBucket(filters.dateTo) : null;
    if (f && t && f.year === t.year && f.quarter === t.quarter) {
      return `Q${f.quarter}` as CoordinatorTargetQuarter;
    }
    return filters.dateFrom || filters.dateTo ? "all" : undefined;
  }, [filters.dateFrom, filters.dateTo]);

  const { data: rollupData } = useCoordinatorTargetRollup(
    selectedProjectId
      ? { project_id: selectedProjectId, coordinator_id: selectedCoordinatorId, quarter: quarterParam }
      : null,
  );

  const effectiveMetrics = useMemo(() => {
    const rows = (rollupData?.results ?? []) as Array<{
      indicator_id: number;
      indicator_name?: string;
      resolved_target_value?: number | null;
      actual_value?: number;
      own_actual_value?: number;
    }>;
    if (!selectedProjectId || rows.length === 0) return null;
    const byIndicator = new Map<string, { indicatorId: string; label: string; target: number; value: number; percentage: number }>();
    for (const r of rows) {
      const id = String(r.indicator_id);
      const cur = byIndicator.get(id) ?? { indicatorId: id, label: r.indicator_name ?? id, target: 0, value: 0, percentage: 0 };
      cur.target += Number(r.resolved_target_value ?? 0);
      cur.value += Number(r.actual_value ?? r.own_actual_value ?? 0);
      byIndicator.set(id, cur);
    }
    return Array.from(byIndicator.values()).map((m) => ({
      ...m,
      percentage: m.target > 0 ? (m.value / m.target) * 100 : 0,
    }));
  }, [rollupData, selectedProjectId]);

  const indicatorMetrics = useMemo(() => {
    const all = effectiveMetrics ?? insights.indicatorMetrics ?? [];
    if (filters.indicatorId === "all") return all;
    return all.filter((m) => String(m.indicatorId) === filters.indicatorId);
  }, [effectiveMetrics, insights.indicatorMetrics, filters.indicatorId]);

  const kpis = useMemo(() => {
    let totalTarget = 0;
    let totalAchieved = 0;
    let targeted = 0;
    let onTrack = 0;
    for (const m of indicatorMetrics) {
      const t = toSafeNumber(m.target);
      const v = toSafeNumber(m.value);
      totalTarget += t;
      totalAchieved += v;
      if (t > 0) {
        targeted += 1;
        if ((v / t) * 100 >= 75) onTrack += 1;
      }
    }
    const targetedOverall = totalTarget > 0;
    const overallPct = targetedOverall ? (totalAchieved / totalTarget) * 100 : 0;
    return {
      overallPct,
      overallStatus: getPerformanceStatus(overallPct, targetedOverall),
      targetedOverall,
      onTrack,
      indicatorsTargeted: targeted,
      indicatorCount: indicatorMetrics.length,
      totalAchieved,
      totalTarget,
      reportingOrganizations: insights.reportingOrganizationsCount ?? 0,
      scopedOrgCount: scopedOrganizationIds ? scopedOrganizationIds.size : organizations.length,
    };
  }, [indicatorMetrics, insights.reportingOrganizationsCount, scopedOrganizationIds, organizations.length]);

  // Recent submissions (needs the raw aggregate rows + name maps, only here).
  const recentSubmissions = useMemo(() => {
    const rows = Array.isArray(aggregatesData) ? (aggregatesData as Array<Record<string, unknown>>) : [];
    const orgName = new Map<string, string>(
      organizations.map((o) => [String(o.id), String(o.name ?? o.id)] as [string, string]),
    );
    const indName = new Map<string, string>(
      (indicatorsData ?? []).map(
        (i: { id: unknown; name?: unknown }) => [String(i.id), String(i.name ?? i.id)] as [string, string],
      ),
    );
    const periodLabel = (start?: unknown, end?: unknown) => {
      const b = getQuarterBucket(String(start ?? "")) || getQuarterBucket(String(end ?? ""));
      return b ? formatQuarterBucket(b) : "—";
    };
    return [...rows]
      .sort((a, b) =>
        String(b.created_at ?? b.period_end ?? "").localeCompare(String(a.created_at ?? a.period_end ?? "")),
      )
      .slice(0, 8)
      .map(
        (r): ExecutiveSubmission => ({
          organization: orgName.get(String(r.organization)) ?? String(r.organization ?? "—"),
          indicator: indName.get(String(r.indicator)) ?? "—",
          period: periodLabel(r.period_start, r.period_end),
          submittedOn: String(r.created_at ?? "").slice(0, 10) || "—",
          status: String(r.status ?? "—"),
        }),
      );
  }, [aggregatesData, organizations, indicatorsData]);

  const districtOptions = useMemo(() => {
    const src = organizationOptions.length ? organizationOptions : organizations;
    return Array.from(
      new Set(src.map((o) => orgDistrict(o as Record<string, unknown>)).filter(Boolean)),
    ).sort();
  }, [organizationOptions, organizations]);

  return {
    insights,
    indicatorMetrics,
    kpis,
    recentSubmissions,
    isLoading: analyticsLoading,
    hasError: Boolean(aggregatesError),
    options: {
      projects: allProjects,
      coordinators: coordinatorOptions,
      organizations: organizationOptions,
      districts: districtOptions,
      indicators: (indicatorsData ?? []) as Array<{ id: number | string; name: string }>,
    },
  };
}
