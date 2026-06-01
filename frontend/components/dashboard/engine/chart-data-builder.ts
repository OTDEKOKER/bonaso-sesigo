import { resolveDashboardIndicator } from "./canonical-indicators";
import { buildDisaggregationChartRows } from "./disaggregation-engine";
import { cleanIndicatorLabel, shortIndicatorLabel } from "./normalize-indicators";
import { buildWidgetMetricRows } from "./target-engine";
import type { BuildChartDataParams, WidgetChartRow } from "./types";

const chartLikeCustomWidgetTypes = new Set([
  "indicator-column-chart",
  "indicator-bar-chart",
  "indicator-line-chart",
  "indicator-stacked-bar-chart",
  "indicator-doughnut-chart",
  "indicator-pie-chart",
]);

export function buildChartData({
  widget,
  metrics,
  chartType,
  disaggregateDimensionKey,
}: BuildChartDataParams): WidgetChartRow[] {
  void widget;
  const normalizedRows = buildWidgetMetricRows(
    metrics,
    chartLikeCustomWidgetTypes.has(chartType) ? 6 : 10,
  );

  if (disaggregateDimensionKey) {
    const records = metrics.map((metric) => ({
      [disaggregateDimensionKey]: (metric as Record<string, unknown>)[disaggregateDimensionKey],
      label: metric.label,
      value: metric.value,
    }));
    const disaggregated = buildDisaggregationChartRows(records, disaggregateDimensionKey);
    if (disaggregated.length > 0) return disaggregated;
  }

  switch (chartType) {
    case "indicator-progress-bar":
    case "indicator-column-chart":
    case "indicator-line-chart":
    case "indicator-stacked-bar-chart":
    case "indicator-heatmap-table":
    case "indicator-performance-table":
      return normalizedRows;
    case "indicator-bar-chart":
      return metrics
        .map((metric) => {
          const { cleanLabel, stage } = resolveDashboardIndicator(metric.label);
          return {
            ...metric,
            cleanLabel,
            progressLabel: metric.target > 0 ? `${metric.percentage.toFixed(1)}%` : "No target",
            shortLabel: shortIndicatorLabel(metric.label),
            stage,
          };
        })
        .slice(0, 5);
    case "indicator-pie-chart":
    case "indicator-doughnut-chart":
      return metrics
        .filter((metric) => metric.value > 0)
        .map((metric, index) => ({
          color: ["#0EA5E9", "#22C55E", "#F59E0B", "#A855F7", "#14B8A6", "#F97316"][index % 6],
          indicatorId: String(metric.indicatorId || metric.label),
          label: cleanIndicatorLabel(metric.label),
          shortLabel: shortIndicatorLabel(metric.label),
          target: metric.target,
          value: metric.value,
        }));
    default:
      return normalizedRows;
  }
}
