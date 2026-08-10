import { calculatePercentage, hasTarget } from "./target-engine";

/**
 * RAG (red/amber/green) performance classification for a target-vs-achieved
 * metric. Thresholds mirror the reporting prototype:
 *   >= 100  Met, >= 75  On track, >= 50  At risk, < 50  Off track,
 *   no target -> Untargeted.
 * Pure + framework-free so it can be reused by widgets, the summary strip,
 * the performance-detail panel and unit tests.
 */
export type PerformanceStatus = "met" | "on-track" | "at-risk" | "off-track" | "untargeted";

export const PERFORMANCE_STATUS_ORDER: PerformanceStatus[] = [
  "met",
  "on-track",
  "at-risk",
  "off-track",
  "untargeted",
];

/** Statuses that represent a real target-vs-achieved comparison (excludes untargeted). */
export const PERFORMANCE_RAG_ORDER: PerformanceStatus[] = ["met", "on-track", "at-risk", "off-track"];

export const PERFORMANCE_STATUS_LABELS: Record<PerformanceStatus, string> = {
  met: "Met",
  "on-track": "On track",
  "at-risk": "At risk",
  "off-track": "Off track",
  untargeted: "No target",
};

export const PERFORMANCE_STATUS_COLORS: Record<PerformanceStatus, string> = {
  met: "#15803D",
  "on-track": "#22C55E",
  "at-risk": "#F59E0B",
  "off-track": "#EF4444",
  untargeted: "#94A3B8",
};

export type PerformanceStatusResult = {
  status: PerformanceStatus;
  label: string;
  color: string;
};

export function classifyPerformance(percentage: number, targeted: boolean): PerformanceStatus {
  if (!targeted || !Number.isFinite(percentage)) return "untargeted";
  if (percentage >= 100) return "met";
  if (percentage >= 75) return "on-track";
  if (percentage >= 50) return "at-risk";
  return "off-track";
}

export function getPerformanceStatus(percentage: number, targeted: boolean): PerformanceStatusResult {
  const status = classifyPerformance(percentage, targeted);
  return {
    status,
    label: PERFORMANCE_STATUS_LABELS[status],
    color: PERFORMANCE_STATUS_COLORS[status],
  };
}

/**
 * Classify directly from actual/target values, reusing the shared target-engine
 * helpers so percentage/no-target semantics stay consistent across the dashboard.
 */
export function getPerformanceStatusFromValues(actual: number, target: number): PerformanceStatusResult {
  const targeted = hasTarget(target);
  const percentage = calculatePercentage(actual, target);
  return getPerformanceStatus(percentage, targeted);
}

/** Legend items for the 4-step RAG scale (used by RAG-coloured charts). */
export const PERFORMANCE_RAG_LEGEND_ITEMS = PERFORMANCE_RAG_ORDER.map((status) => ({
  color: PERFORMANCE_STATUS_COLORS[status],
  label: PERFORMANCE_STATUS_LABELS[status],
}));
