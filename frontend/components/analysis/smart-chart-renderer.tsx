"use client";

import { AnalyticsEmptyState, ChartInsightFooter, type ChartDensity, type ChartSizeTier } from "@/components/analysis/chart-theme";
import { ChartHeader } from "@/components/analysis/chart-header";
import { BarLikeChartDataTable } from "@/components/analysis/bar-like-chart-data-table";
import { RenderBarChart } from "@/components/analysis/render-bar-chart";
import { RenderFunnelChart } from "@/components/analysis/render-funnel-chart";
import { RenderHeatmapChart } from "@/components/analysis/render-heatmap-chart";
import { RenderLineChart } from "@/components/analysis/render-line-chart";
import { RenderStackedBarChart } from "@/components/analysis/render-stacked-bar-chart";
import type { DrilldownTarget, VisualizationChart } from "@/lib/visualization/engine";
import { assertCompatibleChartShape } from "@/lib/visualization/guards";

type SmartChartRendererProps = {
  chart: unknown;
  rendererMode?: "legacy" | "v2";
  onDrilldown?: (target: DrilldownTarget) => void;
  density?: ChartDensity;
  size?: ChartSizeTier;
  activeFilters?: Record<string, string[]>;
  showTitle?: boolean;
};

function getCompatibleChart(
  chart: unknown,
  rendererMode: "legacy" | "v2",
): VisualizationChart | null {
  if (!chart) return null;

  try {
    assertCompatibleChartShape(chart);
    return chart;
  } catch {
    void rendererMode;
    return null;
  }
}

export function SmartChartRenderer(props: SmartChartRendererProps) {
  const {
    chart,
    onDrilldown,
    rendererMode = "legacy",
    density = "normal",
    size = "medium",
    activeFilters = {},
    showTitle = true,
  } = props;
  const compatibleChart = getCompatibleChart(chart, rendererMode);

  if (!compatibleChart) {
    return (
      <AnalyticsEmptyState
        title="No chart available"
        message={
          rendererMode === "v2"
            ? "No compatible v2 chart can be generated for the current filter state."
            : "No chart can be generated for the current filter state."
        }
      />
    );
  }

  const chartHeader =
    showTitle && (compatibleChart.title || compatibleChart.description) ? (
      <ChartHeader
        title={compatibleChart.title || "Chart"}
        subtitle={compatibleChart.description || undefined}
      />
    ) : null;

  if (compatibleChart.kind === "heatmap") {
    return (
      <div className="space-y-3">
        {chartHeader}
        <RenderHeatmapChart
          chart={compatibleChart}
          onDrilldown={onDrilldown}
          density={density}
          activeFilters={activeFilters}
        />
      </div>
    );
  }

  if (compatibleChart.kind === "funnel" || compatibleChart.kind === "cascade") {
    return (
      <div className="space-y-3">
        {chartHeader}
        {compatibleChart.steps.length === 0 ? (
          <AnalyticsEmptyState
            title="No funnel data"
            message={
              compatibleChart.emptyMessage ||
              "No funnel stages are available for the selected indicators."
            }
          />
        ) : (
          <RenderFunnelChart chart={compatibleChart} density={density} onDrilldown={onDrilldown} activeFilters={activeFilters} />
        )}
      </div>
    );
  }

  if (compatibleChart.kind === "trend") {
    return (
      <div className="space-y-3">
        {chartHeader}
        <RenderLineChart
          chart={compatibleChart}
          density={density}
          size={size}
          onDrilldown={onDrilldown}
          activeFilters={activeFilters}
        />
        <BarLikeChartDataTable chart={compatibleChart} />
      </div>
    );
  }

  if (compatibleChart.kind === "stacked-bar") {
    return (
      <div className="space-y-3">
        {chartHeader}
        <RenderStackedBarChart
          chart={compatibleChart}
          onDrilldown={onDrilldown}
          density={density}
          size={size}
          activeFilters={activeFilters}
        />
        <BarLikeChartDataTable chart={compatibleChart} />
      </div>
    );
  }

  if (compatibleChart.kind === "bar" || compatibleChart.kind === "grouped-bar") {
    return (
      <div className="space-y-3">
        {chartHeader}
        <RenderBarChart
          chart={compatibleChart}
          onDrilldown={onDrilldown}
          density={density}
          size={size}
          activeFilters={activeFilters}
        />
        <BarLikeChartDataTable chart={compatibleChart} />
        {compatibleChart.emptyMessage ? (
          <ChartInsightFooter>{compatibleChart.emptyMessage}</ChartInsightFooter>
        ) : null}
      </div>
    );
  }

  return (
    <AnalyticsEmptyState
      title="Unsupported chart"
      message="This chart type is not yet supported in the smart renderer."
    />
  );
}
