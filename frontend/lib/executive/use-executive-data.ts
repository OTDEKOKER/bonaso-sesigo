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
  useAllProjects,
  useCoordinatorTargetRollup,
  useProjectCoordinators,
  useWorkbookLayouts,
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
  // Executive scoping needs only base project fields (organizations,
  // hierarchy_overrides, status, is_training) — all present on the plain list.
  // useAllProjects is one paginated list call; useAllProjectDetails would fetch
  // full per-project detail (~10MB each on NSC2026/27), which gated the whole
  // dashboard's landing/auto-select on a multi-MB download. Base list lets the
  // page land on the current project and load its data immediately.
  const { data: projectsData } = useAllProjects();
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

  // Coordinator options follow the selected project via the AUTHORITATIVE backend
  // endpoint (ProjectOrganization.is_coordinator) — the same source the
  // /targets/coordinators page uses. This returns every coordinator in the project
  // (all 6 for an admin; only the user's own for a coordinator M&E officer) and
  // honours training/live isolation. The old global-scope ∩ project-M2M
  // intersection silently dropped coordinators that weren't in the flat M2M.
  const { data: projectCoordinatorsData } = useProjectCoordinators(selectedProjectId ?? null);
  const coordinatorOptions = useMemo<Array<{ id: string; name: string }>>(() => {
    if (selectedProjectId) {
      return (projectCoordinatorsData ?? []).map((o) => ({
        id: String(o.id),
        name: String(o.name ?? `Org ${o.id}`),
      }));
    }
    return availableCoordinatorOrganizations.map((o) => ({
      id: String(o.id),
      name: String((o as { name?: unknown }).name ?? `Org ${o.id}`),
    }));
  }, [projectCoordinatorsData, selectedProjectId, availableCoordinatorOrganizations]);

  // Canonical indicator resolution (SSoT): an alias indicator (e.g. the deprecated
  // GBV-eligible 462) resolves to its canonical id (539) via the backend
  // `canonical_indicator` FK carried on every indicator. Matching indicators by
  // canonical id keeps the workbook filter below robust to alias/canonical drift
  // between the workbook layout, the coordinator rollup and the aggregate insights.
  const canonicalIndicatorId = useMemo(() => {
    const map = new Map<string, string>();
    for (const ind of (indicatorsData ?? []) as Array<{
      id: number | string;
      canonical_indicator?: number | string | null;
    }>) {
      const id = String(ind.id);
      map.set(id, ind.canonical_indicator != null ? String(ind.canonical_indicator) : id);
    }
    return (id: number | string) => map.get(String(id)) ?? String(id);
  }, [indicatorsData]);

  // "Workbook indicators" for the current scope: the indicators placed in the
  // active WorkbookLayout(s) of the coordinator(s) in scope — the selected
  // coordinator's own layout, else the union across the project's coordinators
  // (shared indicators collapse; no double-count). Canonicalised so it matches the
  // metrics regardless of alias. Null (= no restriction) when there is no project
  // scope or the layouts haven't loaded yet, so the panels never collapse to empty
  // while data is pending.
  const indicatorNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const ind of (indicatorsData ?? []) as Array<{ id: number | string; name?: unknown }>) {
      map.set(String(ind.id), String(ind.name ?? ind.id));
    }
    return map;
  }, [indicatorsData]);

  const { data: workbookLayoutsData } = useWorkbookLayouts(Boolean(selectedProjectId));
  const workbookScope = useMemo<
    | { canonicalIds: Set<string>; indicators: Array<{ canonicalId: string; name: string }> }
    | null
  >(() => {
    if (!selectedProjectId) return null;
    const layouts = (workbookLayoutsData ?? []) as Array<{
      is_active?: boolean;
      coordinator_organization: number | string;
      items?: Array<{ indicator: number | null; indicator_name?: string }>;
    }>;
    if (layouts.length === 0) return null;
    const coordinatorIds = selectedCoordinatorId
      ? new Set<string>([String(selectedCoordinatorId)])
      : new Set<string>((projectCoordinatorsData ?? []).map((c) => String(c.id)));
    if (coordinatorIds.size === 0) return null;
    // canonicalId -> display name (first placement wins; shared indicators dedupe).
    const byCanonical = new Map<string, string>();
    for (const layout of layouts) {
      if (layout.is_active === false) continue;
      if (!coordinatorIds.has(String(layout.coordinator_organization))) continue;
      for (const item of layout.items ?? []) {
        if (item.indicator == null) continue;
        const canonicalId = canonicalIndicatorId(item.indicator);
        if (!byCanonical.has(canonicalId)) {
          byCanonical.set(
            canonicalId,
            indicatorNameById.get(canonicalId) || String(item.indicator_name || canonicalId),
          );
        }
      }
    }
    if (byCanonical.size === 0) return null;
    return {
      canonicalIds: new Set(byCanonical.keys()),
      indicators: Array.from(byCanonical, ([canonicalId, name]) => ({ canonicalId, name })),
    };
  }, [
    workbookLayoutsData,
    selectedProjectId,
    selectedCoordinatorId,
    projectCoordinatorsData,
    canonicalIndicatorId,
    indicatorNameById,
  ]);

  const coordinatorScopedOrganizationIds = useMemo<Set<string> | null>(() => {
    if (!selectedCoordinatorId) return null;
    return new Set<string>([
      selectedCoordinatorId,
      ...((descendantsByParent[selectedCoordinatorId] || []) as string[]),
    ]);
  }, [descendantsByParent, selectedCoordinatorId]);

  // The selected project's whole org set = its assigned organizations
  // (project.organizations M2M, which equals ProjectOrganization is_active — the
  // authoritative, COMPLETE project membership, including every sub-grantee). Used
  // as the default scope for the Organisation/District options and the KPI "in
  // scope" counts so they reflect the project, not the global org list. We must NOT
  // derive this from coordinators + client-side hierarchy descendants: the project
  // hierarchy overrides can be empty/flat, so that would collapse to just the
  // coordinators and drop the sub-grantees that actually report (→ 0% completeness).
  // Null when no project is selected.
  const projectScopedOrganizationIds = useMemo<Set<string> | null>(() => {
    if (!selectedProjectId || selectedProjectOrganizationIds.length === 0) return null;
    return new Set<string>(selectedProjectOrganizationIds);
  }, [selectedProjectId, selectedProjectOrganizationIds]);

  const organizationOptions = useMemo(() => {
    // A chosen coordinator narrows to its subtree; otherwise fall back to the whole
    // project tree; only when no project is selected show the global org list.
    const scope = coordinatorScopedOrganizationIds ?? projectScopedOrganizationIds;
    if (!scope) return organizations;
    return organizations.filter((o) => scope.has(String(o.id)));
  }, [coordinatorScopedOrganizationIds, projectScopedOrganizationIds, organizations]);

  // Hierarchy-scoped org id set (project -> coordinator -> org), then optional district narrowing.
  const scopedOrganizationIds = useMemo<Set<string> | null>(() => {
    // Default to the whole project tree (so KPI "in scope" counts + reported/not-
    // reported reflect the project, not the global org list) until a coordinator is chosen.
    let base: Set<string> | null = coordinatorScopedOrganizationIds ?? projectScopedOrganizationIds;
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
  }, [coordinatorScopedOrganizationIds, projectScopedOrganizationIds, descendantsByParent, selectedOrganizationId, filters.district, organizations]);

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
    // The coordinator-targets ROLLUP action (analysis.views.CoordinatorTargetViewSet
    // ._coordinator_rollup_rows) emits the EFFECTIVE target — derived/percentage
    // resolved at read time by the coordinator-rollups SSoT — in `target_value`
    // (NOT `resolved_target_value`, which is only on the list serializer), and the
    // certified server-side actual in `actual_value`. Read those exact fields.
    const rows = (rollupData?.results ?? []) as Array<{
      indicator_id: number;
      indicator_name?: string;
      target_value?: number | null;
      actual_value?: number | null;
      own_actual_value?: number | null;
    }>;
    // The rollup is scoped to project + coordinator ONLY — it cannot narrow to a
    // single organisation OR a district. When the user picks a specific org (e.g.
    // BOCHAIP under MBGE) or a district, skip the rollup so the metrics/KPIs fall
    // back to the org-scoped aggregate insights below (scopedOrganizationIds = that
    // org/district subtree), showing ONLY the filtered data instead of the roll-up.
    if (
      !selectedProjectId ||
      selectedOrganizationId ||
      filters.district !== "all" ||
      rows.length === 0
    )
      return null;
    const byIndicator = new Map<string, { indicatorId: string; label: string; target: number; value: number; percentage: number }>();
    for (const r of rows) {
      const id = String(r.indicator_id);
      const cur = byIndicator.get(id) ?? { indicatorId: id, label: r.indicator_name ?? id, target: 0, value: 0, percentage: 0 };
      cur.target += Number(r.target_value ?? 0);
      cur.value += Number(r.actual_value ?? r.own_actual_value ?? 0);
      byIndicator.set(id, cur);
    }
    return Array.from(byIndicator.values()).map((m) => ({
      ...m,
      percentage: m.target > 0 ? (m.value / m.target) * 100 : 0,
    }));
  }, [rollupData, selectedProjectId, selectedOrganizationId, filters.district]);

  const indicatorMetrics = useMemo(() => {
    const base = effectiveMetrics ?? insights.indicatorMetrics ?? [];
    let result: Array<{
      indicatorId: string;
      label: string;
      target: number;
      value: number;
      percentage: number;
    }> = base.map((m) => ({
      indicatorId: String(m.indicatorId),
      label: String(m.label ?? m.indicatorId),
      target: Number(m.target) || 0,
      value: Number(m.value) || 0,
      percentage: Number(m.percentage) || 0,
    }));
    if (workbookScope) {
      // Programme Performance / KPIs show EVERY reporting-workbook indicator (and
      // nothing else). Target + achieved come from the scoped metrics; a workbook
      // indicator with no target still appears with its achieved (from the
      // aggregate insights), so the whole workbook is visible, not just targeted
      // rows. Canonical-matched so an alias metric maps onto its canonical id.
      const achievedByCanonical = new Map<string, number>();
      for (const m of insights.indicatorMetrics ?? []) {
        const cid = canonicalIndicatorId(m.indicatorId);
        achievedByCanonical.set(cid, (achievedByCanonical.get(cid) ?? 0) + (Number(m.value) || 0));
      }
      const byCanonical = new Map<string, (typeof result)[number]>();
      for (const m of result) {
        const cid = canonicalIndicatorId(m.indicatorId);
        if (!workbookScope.canonicalIds.has(cid) || byCanonical.has(cid)) continue;
        byCanonical.set(cid, {
          ...m,
          indicatorId: cid,
          percentage: m.target > 0 ? (m.value / m.target) * 100 : 0,
        });
      }
      for (const wb of workbookScope.indicators) {
        if (byCanonical.has(wb.canonicalId)) continue;
        byCanonical.set(wb.canonicalId, {
          indicatorId: wb.canonicalId,
          label: wb.name,
          target: 0,
          value: achievedByCanonical.get(wb.canonicalId) ?? 0,
          percentage: 0,
        });
      }
      result = Array.from(byCanonical.values());
    }
    if (filters.indicatorId === "all") return result;
    return result.filter((m) => String(m.indicatorId) === filters.indicatorId);
  }, [effectiveMetrics, insights.indicatorMetrics, workbookScope, canonicalIndicatorId, filters.indicatorId]);

  // Indicator options: every workbook indicator for the scope (so the filter lists
  // the full workbook, matching the chart). Falls back to the scoped metrics, then
  // the global catalogue when no project is selected.
  const indicatorOptions = useMemo<Array<{ id: number | string; name: string }>>(() => {
    if (workbookScope) {
      return workbookScope.indicators.map((wb) => ({ id: wb.canonicalId, name: wb.name }));
    }
    if (selectedProjectId) {
      const seen = new Map<string, string>();
      for (const m of (effectiveMetrics ?? insights.indicatorMetrics ?? [])) {
        const id = String(m.indicatorId);
        if (!seen.has(id)) seen.set(id, String(m.label ?? id));
      }
      if (seen.size > 0) return Array.from(seen, ([id, name]) => ({ id, name }));
    }
    return (indicatorsData ?? []) as Array<{ id: number | string; name: string }>;
  }, [
    workbookScope,
    selectedProjectId,
    effectiveMetrics,
    insights.indicatorMetrics,
    indicatorsData,
  ]);

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

  // Which scoped orgs reported vs not (for the clickable Reporting cards).
  const { reportedOrganizations, notReportedOrganizations } = useMemo(() => {
    const rows = Array.isArray(aggregatesData) ? (aggregatesData as Array<Record<string, unknown>>) : [];
    const withData = new Set(rows.map((r) => String(r.organization)));
    const scoped = organizations.filter((o) => (scopedOrganizationIds ? scopedOrganizationIds.has(String(o.id)) : true));
    const reported: string[] = [];
    const notReported: string[] = [];
    for (const o of scoped) {
      (withData.has(String(o.id)) ? reported : notReported).push(String(o.name ?? o.id));
    }
    return { reportedOrganizations: reported.sort(), notReportedOrganizations: notReported.sort() };
  }, [aggregatesData, organizations, scopedOrganizationIds]);

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
    reportedOrganizations,
    notReportedOrganizations,
    isLoading: analyticsLoading,
    hasError: Boolean(aggregatesError),
    options: {
      projects: allProjects,
      coordinators: coordinatorOptions,
      organizations: organizationOptions,
      districts: districtOptions,
      indicators: indicatorOptions,
    },
  };
}
