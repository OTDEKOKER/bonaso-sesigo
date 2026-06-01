import type {
  CoordinatorTarget,
  CoordinatorTargetChildContribution,
  CoordinatorTargetQuarter,
} from "@/lib/api";

export type CoordinatorPerformanceStatus = "met" | "on_track" | "behind" | "no_target";

export type CoordinatorPerformanceRow = {
  target: CoordinatorTarget;
  projectName: string;
  coordinatorName: string;
  indicatorName: string;
  ownActualValue: number;
  actualValue: number;
  achievementPercent: number | null;
  variance: number;
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
