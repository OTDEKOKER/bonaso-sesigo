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
  const { data: organizations } = useAllOrganizations();
  const { data: projectsData } = useAllProjectDetails();

  const activeProjects = useMemo(
    () => (Array.isArray(projectsData) ? projectsData.filter((project) => !project?.is_training) : []),
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
        selectedProjectId: projectId,
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
