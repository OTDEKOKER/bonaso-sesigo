import { clamp, formatPercent } from "./normalize-indicators";
import { calculateExceeded } from "./target-engine";

export type HivTestingComparisonEntry = {
  label: string;
  actual: number;
  target: number;
};

export function buildHivTestingComparison(entry: HivTestingComparisonEntry) {
  const hasTarget = entry.target > 0;
  const hasActual = entry.actual > 0;
  const exceededBy = calculateExceeded(entry.actual, entry.target);
  const progressPercent = hasTarget ? (entry.actual / entry.target) * 100 : null;
  const normalizedProgress = hasTarget ? clamp(entry.actual / entry.target, 0, 1) : hasActual ? 1 : 0;
  const centerLabel = hasTarget ? `${formatPercent(progressPercent || 0)}%` : hasActual ? "Actual" : "No data";
  const centerCaption = hasTarget ? "to target" : hasActual ? "reported" : "waiting";

  return {
    centerCaption,
    centerLabel,
    exceededBy,
    hasActual,
    hasTarget,
    normalizedProgress,
    progressPercent,
  };
}
