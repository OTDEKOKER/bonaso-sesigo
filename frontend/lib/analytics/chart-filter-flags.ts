import type { IndicatorChartSetting } from "@/lib/api";

export const METRIC_FILTER_FLAG_COMPARE_BY_COORDINATOR = "__compare_by_coordinator__";
export const METRIC_FILTER_FLAG_COMPARE_BY_ORGANIZATION = "__compare_by_organization__";
export const METRIC_FILTER_FLAG_APPLY_TREND_LINE = "__apply_trend_line__";

const RESERVED_METRIC_FILTER_FLAGS = new Set<string>([
  METRIC_FILTER_FLAG_COMPARE_BY_COORDINATOR,
  METRIC_FILTER_FLAG_COMPARE_BY_ORGANIZATION,
  METRIC_FILTER_FLAG_APPLY_TREND_LINE,
]);

export function isReservedMetricFilterValue(value: string) {
  const normalized = value.trim().toLowerCase();
  return RESERVED_METRIC_FILTER_FLAGS.has(normalized);
}

export function hasMetricFilterFlag(
  filters: IndicatorChartSetting["filters"] | undefined,
  flag: string,
) {
  const normalizedFlag = flag.trim().toLowerCase();
  return (filters ?? []).some(
    (filter) =>
      filter.field_detail?.name === "metric" &&
      String(filter.value ?? "")
        .trim()
        .toLowerCase() === normalizedFlag,
  );
}
