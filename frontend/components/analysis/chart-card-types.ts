import type { DashboardSetting, IndicatorChartSetting } from "@/lib/api";

// Shared type declarations extracted from dashboard-chart-card.tsx. Type-only;
// no runtime behaviour.

export type DashboardChartCardProps = {
  chart: IndicatorChartSetting;
  dashboard: DashboardSetting;
  onEdit: (chart: IndicatorChartSetting) => void;
  onDelete: (chart: IndicatorChartSetting) => Promise<void> | void;
  onRefresh: () => Promise<void> | void;
  deleteDisabled?: boolean;
  zoomable?: boolean;
  zoomedView?: boolean;
};

export type TrendSeries = {
  indicator_id: number;
  indicator_name: string;
  data: Array<{ month: string; value: number; target: number }>;
};

export type LegacyChartKey = {
  key: string;
  label: string;
  stackId?: string;
};

export type RenderedSeries = {
  key: string;
  label: string;
  stackId?: string;
};

export type PresentationLegendItem = {
  key: string;
  label: string;
  color: string;
  total: number;
};

export type ChartFilterOption = {
  value: string;
  label: string;
};

export type ChartFilterGroup = {
  name: string;
  label: string;
  options: ChartFilterOption[];
};

export type AggregateDisaggregationDimension = {
  key?: unknown;
  label?: unknown;
  values?: unknown[];
};

export type AggregateDisaggregationConfigLike = {
  dimensions?: AggregateDisaggregationDimension[];
};

export type DisaggregateCompareMode = "period" | "organization" | "coordinator";
export type GroupingCompareMode = Exclude<DisaggregateCompareMode, "period">;

export type ChartTableRow = {
  key: string;
  label: string;
  color: string;
  values: Array<string | number>;
};

export type SinglePeriodComparisonRow = {
  key: string;
  label: string;
  value: number;
  color: string;
  share: number;
};

export type ChartAxisTickProps = {
  x?: number;
  y?: number;
  payload?: {
    value?: string | number;
  };
};

export type SinglePeriodLayoutConfig = {
  labelWidth: number;
  maxCharsPerLine: number;
  lineHeight: number;
  rowMinHeight: number;
  compactSummary: boolean;
};

export type PieDisplayRow = {
  key: string;
  name: string;
  value: number;
};

export type TooltipEntry = {
  color?: string;
  dataKey?: string | number;
  name?: string;
  payload?: Record<string, unknown>;
  value?: string | number;
};

export type BiologicalFigureRow = {
  factor: string;
  sex: "Female" | "Male";
  screened: number;
  referred: number;
  period?: string;
};

export type DisaggregateEntry = Record<string, unknown>;
export type DisaggregateSecondLevel = Record<string, DisaggregateEntry | number | string | null | undefined>;
export type DisaggregateCategoryMap = Record<string, DisaggregateSecondLevel>;
