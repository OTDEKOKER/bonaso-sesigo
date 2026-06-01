import type { LucideIcon } from "lucide-react";
import type { CanonicalIndicatorStage } from "@/lib/indicators/canonical";
import type { ScreeningDashboardInsights } from "@/lib/dashboard/screening-insights";

export type UpdatesTab = "activity" | "deadlines" | "projects";

export type SummaryCard = {
  id: string;
  label: string;
  value: number;
  note: string;
  icon: LucideIcon;
};

export type QuickLink = {
  id: string;
  href: string;
  label: string;
  description: string;
  icon: LucideIcon;
};

export type ActivityItem = {
  type: string;
  description: string;
  timestamp: string;
};

export type IndicatorStage = CanonicalIndicatorStage;

export type DashboardChartPreferences = {
  pathwayStyle: "donut" | "pie";
  showTrendLegend: boolean;
  trendLayout: "grouped" | "stacked";
  trendSeriesLimit: 1 | 2 | 3 | 4 | 5;
};

export type DashboardCustomWidgetType =
  | "indicator-progress-bar"
  | "indicator-column-chart"
  | "indicator-bar-chart"
  | "indicator-line-chart"
  | "indicator-stacked-bar-chart"
  | "indicator-doughnut-chart"
  | "indicator-pie-chart"
  | "indicator-heatmap-table"
  | "indicator-performance-table";

export type DashboardCustomWidget = {
  id: string;
  indicatorIds: string[];
  title: string;
  type: DashboardCustomWidgetType;
  includeTarget?: boolean;
  filter?: {
    projectId?: string;
    coordinatorId?: string;
    organizationId?: string;
    dateFrom?: string;
    dateTo?: string;
  };
  disaggregateDimensionKey?: string;
  disaggregateDimensionLabel?: string;
};

export const DEFAULT_DASHBOARD_CUSTOM_WIDGET_TYPE: DashboardCustomWidgetType = "indicator-bar-chart";

export const DASHBOARD_CUSTOM_WIDGET_STYLE_OPTIONS: ReadonlyArray<{
  value: DashboardCustomWidgetType;
  label: string;
}> = [
  { value: "indicator-progress-bar", label: "Progress Bar" },
  { value: "indicator-column-chart", label: "Column Chart" },
  { value: "indicator-bar-chart", label: "Bar Chart" },
  { value: "indicator-line-chart", label: "Line Chart" },
  { value: "indicator-stacked-bar-chart", label: "Stacked Bar Chart" },
  { value: "indicator-doughnut-chart", label: "Doughnut Chart" },
  { value: "indicator-pie-chart", label: "Pie Chart" },
  { value: "indicator-heatmap-table", label: "Heatmap Table" },
  { value: "indicator-performance-table", label: "Performance Table" },
];

export function parseDashboardCustomWidgetType(value: unknown): DashboardCustomWidgetType {
  switch (value) {
    case "indicator-progress-bar":
      return "indicator-progress-bar";
    case "indicator-column-chart":
      return "indicator-column-chart";
    case "indicator-bar-chart":
      return "indicator-bar-chart";
    case "indicator-line-chart":
      return "indicator-line-chart";
    case "indicator-stacked-bar-chart":
      return "indicator-stacked-bar-chart";
    case "indicator-doughnut-chart":
      return "indicator-doughnut-chart";
    case "indicator-pie-chart":
      return "indicator-pie-chart";
    case "indicator-heatmap-table":
      return "indicator-heatmap-table";
    case "indicator-performance-table":
      return "indicator-performance-table";
    case "indicator-progress-list":
      return "indicator-progress-bar";
    case "indicator-donut":
      return "indicator-pie-chart";
    default:
      return DEFAULT_DASHBOARD_CUSTOM_WIDGET_TYPE;
  }
}

export type DashboardAggregateFilterContext = {
  projectId?: string;
  coordinatorId?: string;
  organizationId?: string;
  dateFrom?: string;
  dateTo?: string;
};

export type CustomWidgetMetricRow = {
  indicatorId: string;
  label: string;
  shortLabel: string;
  value: number;
  target: number;
  percentage: number;
  remaining: number;
};

export type WidgetMetric = ScreeningDashboardInsights["indicatorMetrics"][number];
export type WidgetMetricCollection = ScreeningDashboardInsights["indicatorMetrics"];

export type WidgetChartRow = Record<string, string | number>;

export type BuildChartDataParams = {
  widget?: DashboardCustomWidget;
  metrics: WidgetMetricCollection;
  chartType: DashboardCustomWidgetType;
  disaggregateDimensionKey?: string;
};
