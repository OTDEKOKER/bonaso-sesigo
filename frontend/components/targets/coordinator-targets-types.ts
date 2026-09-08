import type {
  CoordinatorTarget,
  CoordinatorTargetChildContribution,
  CoordinatorTargetQuarter,
} from "@/lib/api";
import type { PerformanceStatus } from "@/components/dashboard/engine/performance-status";

// Coordinator performance uses the canonical RAG vocabulary (the single source
// of truth in components/dashboard/engine/performance-status.ts), so the Targets
// page classifies identically to the dashboards and funder reports. ``pending``
// is a coordinator-only extra state: a derived target whose source indicator has
// not been reported yet (no RAG classification is possible).
export type CoordinatorPerformanceStatus = PerformanceStatus | "pending";

export type CoordinatorPerformanceRow = {
  target: CoordinatorTarget;
  projectName: string;
  coordinatorName: string;
  indicatorName: string;
  ownActualValue: number;
  actualValue: number;
  achievementPercent: number | null;
  variance: number | null;
  status: CoordinatorPerformanceStatus;
  childContributions: CoordinatorTargetChildContribution[];
};

export type CoordinatorTargetsFilterState = {
  search: string;
  projectId: string;
  coordinatorId: string;
  indicatorId: string;
  year: string;
  quarter: CoordinatorTargetQuarter | "all";
  isActive: "all" | "true" | "false";
};

export type NamedOption = {
  value: string;
  label: string;
  hint?: string;
  searchText?: string;
};
