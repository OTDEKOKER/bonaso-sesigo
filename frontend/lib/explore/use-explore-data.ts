"use client";

/**
 * Data source for the Explore workbench. Reuses the SAME pipeline the home
 * dashboard uses (buildHomeDashboardScreeningInsights over the shared
 * useAllAggregates/useAllIndicators/... hooks), so Explore numbers agree with
 * the dashboard, executive view and reports. Aggregates are already
 * org-scoped server-side, so no extra client-side scoping is applied here.
 */
import { useMemo } from "react";

import {
  useAllAggregates,
  useAllIndicators,
  useAllOrganizations,
  useAllProjectDetails,
} from "@/lib/hooks/use-api";
import { buildHomeDashboardScreeningInsights } from "@/lib/dashboard/screening-insights";

export function useExploreData(projectId: number | null = null) {
  const { data: aggregatesData, isLoading: aggregatesLoading, error: aggregatesError } = useAllAggregates({
    status: "approved",
  });
  const { data: indicatorsData, isLoading: indicatorsLoading } = useAllIndicators({ is_active: "true" });
  const { data: organizationsData } = useAllOrganizations();
  const { data: projectsData } = useAllProjectDetails();

  // useAllOrganizations / useAllProjectDetails return a paginated envelope
  // ({ count, next, previous, results }), NOT a bare array — the same shape the
  // home and executive dashboards unwrap via `?.results`. Passing the envelope
  // straight into buildHomeDashboardScreeningInsights made the pipeline call
  // `.map` on an object (organizationNameById), which threw and crashed the whole
  // /explore page. The old `Array.isArray(projectsData)` guard was always false
  // for the same reason, so activeProjects silently collapsed to [] (dropping all
  // project targets) instead of erroring — fixed here too.
  const organizations = useMemo(() => organizationsData?.results ?? [], [organizationsData]);
  const activeProjects = useMemo(
    () => (projectsData?.results ?? []).filter((project) => !project?.is_training),
    [projectsData],
  );

  const insights = useMemo(
    () =>
      buildHomeDashboardScreeningInsights({
        aggregatesData,
        indicatorsData,
        organizations,
        activeProjects,
        scopedOrganizationIds: undefined,
        selectedProjectId: projectId != null ? String(projectId) : null,
        includeHivPreventionMessageTypeByCso: false,
        isLoading: aggregatesLoading || indicatorsLoading,
        hasError: Boolean(aggregatesError),
      }),
    [
      aggregatesData,
      indicatorsData,
      organizations,
      activeProjects,
      projectId,
      aggregatesLoading,
      indicatorsLoading,
      aggregatesError,
    ],
  );

  return {
    indicatorMetrics: insights.indicatorMetrics,
    organizations: insights.organizations,
    projects: insights.projects,
    isLoading: aggregatesLoading || indicatorsLoading,
    error: Boolean(aggregatesError),
  };
}
