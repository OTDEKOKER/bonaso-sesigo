"use client";

import { ExploreWorkbench } from "@/components/explore/explore-workbench";
import { useExploreData } from "@/lib/explore/use-explore-data";

export default function ExplorePage() {
  const { indicatorMetrics, organizations, projects, isLoading, error } = useExploreData();

  return (
    <ExploreWorkbench
      indicatorMetrics={indicatorMetrics}
      organizations={organizations}
      projects={projects}
      isLoading={isLoading}
      error={error}
    />
  );
}
