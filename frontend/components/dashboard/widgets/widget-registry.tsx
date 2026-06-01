import type { ComponentType } from "react";
import type { DashboardCustomWidgetType, WidgetMetricCollection } from "@/components/dashboard/engine/types";
import { IndicatorBarChartWidget } from "./indicator-bar-chart-widget";
import { IndicatorColumnChartWidget } from "./indicator-column-chart-widget";
import { IndicatorDoughnutWidget } from "./indicator-doughnut-widget";
import { IndicatorHeatmapTableWidget } from "./indicator-heatmap-table-widget";
import { IndicatorLineChartWidget } from "./indicator-line-chart-widget";
import { IndicatorPerformanceTableWidget } from "./indicator-performance-table-widget";
import { IndicatorPieWidget } from "./indicator-pie-widget";
import { IndicatorProgressWidget } from "./indicator-progress-widget";
import { IndicatorStackedBarChartWidget } from "./indicator-stacked-bar-chart-widget";

type WidgetComponentProps = {
  metrics: WidgetMetricCollection;
  subtitle?: string;
  title: string;
};

export const DASHBOARD_WIDGET_REGISTRY: Record<DashboardCustomWidgetType, ComponentType<WidgetComponentProps>> = {
  "indicator-progress-bar": IndicatorProgressWidget,
  "indicator-column-chart": IndicatorColumnChartWidget,
  "indicator-bar-chart": IndicatorBarChartWidget,
  "indicator-line-chart": IndicatorLineChartWidget,
  "indicator-stacked-bar-chart": IndicatorStackedBarChartWidget,
  "indicator-doughnut-chart": IndicatorDoughnutWidget,
  "indicator-pie-chart": IndicatorPieWidget,
  "indicator-heatmap-table": IndicatorHeatmapTableWidget,
  "indicator-performance-table": IndicatorPerformanceTableWidget,
};

export function DashboardWidgetRenderer({
  metrics,
  subtitle,
  title,
  type,
}: WidgetComponentProps & { type: DashboardCustomWidgetType }) {
  const Component = DASHBOARD_WIDGET_REGISTRY[type] || IndicatorBarChartWidget;
  return <Component metrics={metrics} subtitle={subtitle} title={title} />;
}
