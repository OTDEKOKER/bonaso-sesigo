import type { CustomWidgetMetricRow, WidgetMetricCollection } from "./types";
import { cleanIndicatorLabel, shortIndicatorLabel, toSafeNumber } from "./normalize-indicators";

export function hasTarget(target: number) {
  return target > 0;
}

export function calculatePercentage(actual: number, target: number, fallbackPercentage?: number) {
  return target > 0 ? (actual / target) * 100 : toSafeNumber(fallbackPercentage);
}

export function calculateRemaining(actual: number, target: number) {
  return target > actual ? target - actual : 0;
}

export function calculateExceeded(actual: number, target: number) {
  return target > 0 && actual > target ? actual - target : 0;
}

export function buildWidgetMetricRows(metrics: WidgetMetricCollection, limit = 8): CustomWidgetMetricRow[] {
  return metrics
    .map((metric) => {
      const value = toSafeNumber(metric.value);
      const target = toSafeNumber(metric.target);
      const percentage = calculatePercentage(value, target, metric.percentage);
      return {
        indicatorId: String(metric.indicatorId || metric.label),
        label: cleanIndicatorLabel(metric.label),
        shortLabel: shortIndicatorLabel(metric.label),
        value,
        target,
        percentage,
        remaining: calculateRemaining(value, target),
      };
    })
    .sort((left, right) => {
      if (right.value !== left.value) return right.value - left.value;
      return left.label.localeCompare(right.label);
    })
    .slice(0, limit);
}
