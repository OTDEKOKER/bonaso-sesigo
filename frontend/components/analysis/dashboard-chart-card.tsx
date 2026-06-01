"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend as RechartsLegend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChevronDown, ChevronUp, FileImage, FileSpreadsheet, Loader2, Maximize2, Menu, RotateCw, Settings, Trash2 } from "lucide-react";
import * as XLSX from "xlsx-js-style";

import { cleanLabel, normalizeBreakdownLabel, triggerBlobDownload, type BreakdownMap } from "@/components/analysis/analytics-utils";
import { ChartHeader } from "@/components/analysis/chart-header";
import { ConsolidatedMatrixTable } from "@/components/analysis/consolidated-matrix-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { buildDemoIndicatorTrendsBulk, isDemoAnalysisId } from "@/lib/analysis-demo-data";
import {
  getAggregateValueDisaggregateRows,
  normalizeAggregateValueToDisaggregateMap,
} from "@/lib/aggregates/disaggregate-normalization";
import { dashboardSettingsService, type DashboardSetting, type IndicatorChartSetting } from "@/lib/api";
import { useAllAggregates, useAllOrganizations, useIndicatorTrendsBulk } from "@/lib/hooks/use-api";
import { getIndicatorChartLabel } from "@/lib/indicators/display-name";
import { resolveIndicatorId } from "@/lib/indicators/id-aliases";
import { getEffectiveOrganizationType } from "@/lib/organization-hierarchy";
import { buildConsolidatedMatrix, type AnalyticsFact } from "@/lib/analytics/query-builder";
import { formatDate } from "@/lib/date-utils";
import {
  hasMetricFilterFlag,
  isReservedMetricFilterValue,
  METRIC_FILTER_FLAG_APPLY_TREND_LINE,
  METRIC_FILTER_FLAG_COMPARE_BY_COORDINATOR,
  METRIC_FILTER_FLAG_COMPARE_BY_ORGANIZATION,
} from "@/lib/analytics/chart-filter-flags";
import type { Aggregate } from "@/lib/types";
import { cn } from "@/lib/utils";

const BONASO_COLORS = {
  darkAccent: "rgb(4, 40, 18)",
  uberDarkAccent: "rgb(2, 23, 10)",
  lightAccent: "rgb(66, 171, 108)",
  uberLightAccent: "rgb(161, 246, 195)",
  warningBg: "rgb(209, 196, 117)",
  lightGrey: "rgb(121, 121, 121)",
  alternateLight: "rgb(138, 191, 235)",
  alternateUberLight: "rgb(161, 246, 238)",
  target: "#82ca9d",
  white: "#ffffff",
} as const;

const PROFESSIONAL_CHART_COLORS = [
  "#4F81BD",
  "#ED7D31",
  "#A5A5A5",
  "#FFC000",
  "#4472C4",
  "#70AD47",
  "#255E91",
  "#9E480E",
] as const;

type DashboardChartCardProps = {
  chart: IndicatorChartSetting;
  dashboard: DashboardSetting;
  onEdit: (chart: IndicatorChartSetting) => void;
  onDelete: (chart: IndicatorChartSetting) => Promise<void> | void;
  onRefresh: () => Promise<void> | void;
  deleteDisabled?: boolean;
  zoomable?: boolean;
  zoomedView?: boolean;
};

type TrendSeries = {
  indicator_id: number;
  indicator_name: string;
  data: Array<{ month: string; value: number; target: number }>;
};

type LegacyChartKey = {
  key: string;
  label: string;
  stackId?: string;
};

type RenderedSeries = {
  key: string;
  label: string;
  stackId?: string;
};

type PresentationLegendItem = {
  key: string;
  label: string;
  color: string;
  total: number;
};

type ChartFilterOption = {
  value: string;
  label: string;
};

type ChartFilterGroup = {
  name: string;
  label: string;
  options: ChartFilterOption[];
};

type AggregateDisaggregationDimension = {
  key?: unknown;
  label?: unknown;
  values?: unknown[];
};

type AggregateDisaggregationConfigLike = {
  dimensions?: AggregateDisaggregationDimension[];
};

type DisaggregateCompareMode = "period" | "organization" | "coordinator";
type GroupingCompareMode = Exclude<DisaggregateCompareMode, "period">;

type ChartTableRow = {
  key: string;
  label: string;
  color: string;
  values: Array<string | number>;
};

type SinglePeriodComparisonRow = {
  key: string;
  label: string;
  value: number;
  color: string;
  share: number;
};

type ChartAxisTickProps = {
  x?: number;
  y?: number;
  payload?: {
    value?: string | number;
  };
};

type SinglePeriodLayoutConfig = {
  labelWidth: number;
  maxCharsPerLine: number;
  lineHeight: number;
  rowMinHeight: number;
  compactSummary: boolean;
};

type PieDisplayRow = {
  key: string;
  name: string;
  value: number;
};

type TooltipEntry = {
  color?: string;
  dataKey?: string | number;
  name?: string;
  payload?: Record<string, unknown>;
  value?: string | number;
};

type BiologicalFigureRow = {
  factor: string;
  sex: "Female" | "Male";
  screened: number;
  referred: number;
  period?: string;
};

type DisaggregateEntry = Record<string, unknown>;
type DisaggregateSecondLevel = Record<string, DisaggregateEntry | number | string | null | undefined>;
type DisaggregateCategoryMap = Record<string, DisaggregateSecondLevel>;

const AGE_ORDER: Record<string, number> = {
  "10 14": 1,
  "15 19": 2,
  "20 24": 3,
  "25 29": 4,
  "30 34": 5,
  "35 39": 6,
  "40 44": 7,
  "45 49": 8,
  "50 54": 9,
  "55 59": 10,
  "60 64": 11,
  "65+": 12,
};

function getAgeBandSortOrder(value: string): number | undefined {
  const normalized = normalizeOptionKey(value);
  const direct = AGE_ORDER[normalized];
  if (direct !== undefined) return direct;

  const rangeMatch = normalized.match(/^(\d{1,2})\s+(\d{1,2})$/);
  if (rangeMatch) {
    const start = Number(rangeMatch[1]);
    const end = Number(rangeMatch[2]);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return undefined;
    if (start >= 65 || end >= 65) return AGE_ORDER["65+"];
    if (end <= 14) return AGE_ORDER["10 14"];
    if (end <= 19) return AGE_ORDER["15 19"];
    if (end <= 24) return AGE_ORDER["20 24"];
    if (end <= 29) return AGE_ORDER["25 29"];
    if (end <= 34) return AGE_ORDER["30 34"];
    if (end <= 39) return AGE_ORDER["35 39"];
    if (end <= 44) return AGE_ORDER["40 44"];
    if (end <= 49) return AGE_ORDER["45 49"];
    if (end <= 54) return AGE_ORDER["50 54"];
    if (end <= 59) return AGE_ORDER["55 59"];
    if (end <= 64) return AGE_ORDER["60 64"];
    return AGE_ORDER["65+"];
  }

  const plusMatch = normalized.match(/^(\d{1,2})\+$/);
  if (plusMatch) {
    const start = Number(plusMatch[1]);
    if (!Number.isFinite(start)) return undefined;
    if (start >= 65) return AGE_ORDER["65+"];
    if (start >= 60) return AGE_ORDER["60 64"];
  }

  return undefined;
}

const BIOLOGICAL_FACTOR_SEQUENCE = ["Blood Glucose", "BMI", "BP", "Waist Circumference"] as const;
const BIOLOGICAL_FACTOR_HEADERS: Record<(typeof BIOLOGICAL_FACTOR_SEQUENCE)[number], string> = {
  "Blood Glucose": "BLOOD GLUCOSE",
  BMI: "BMI",
  BP: "BP",
  "Waist Circumference": "WAIST CIRCUMFERENCE",
};

const FILTER_FIELD_LABELS: Record<string, string> = {
  age_range: "Age Range",
  sex: "Sex",
  kp_type: "Key Population Type",
  disability_type: "Disability Type",
  special_attribute: "Special Attribute",
  district: "District",
  citizenship: "Citizenship",
  hiv_status: "HIV Status",
  pregnancy: "Pregnancy",
  organization: "Organization",
  option: "Option",
  platform: "Platform",
  metric: "Metric",
};

const FILTER_FIELD_ORDER = Object.keys(FILTER_FIELD_LABELS).reduce<Record<string, number>>((accumulator, key, index) => {
  accumulator[key] = index;
  return accumulator;
}, {});

const SOCIAL_MESSAGE_COLOR_MAP: Record<string, string> = {
  "ALCOHOL REDUCTION MESSAGES": "#1f6a8a",
  "BLOOD GLUCOSE MESSAGES": "#e67e22",
  "BLOOD PRESSURE MESSAGES": "#2e8b57",
  "HEALTHY DIET MESSAGES": "#1f9ac7",
  "PHYSICAL ACTIVITY MESSAGES": "#9c2f92",
  PSYCHOEDUCATION: "#48a535",
  "TOBACCO CONTROL MESSAGES": "#0f4258",
  "TOBACCO CONTROL MSSAGES": "#0f4258",
  "WAIST CIRCUMFERENCE MESSAGES": "#b55a18",
  "WEIGHT MANAGEMENT MESSAGES": "#0b4d18",
};

const SOCIAL_PLATFORM_OPTIONS: ChartFilterOption[] = [
  { value: "facebook", label: "Facebook" },
  { value: "instagram", label: "Instagram" },
  { value: "twitter", label: "Twitter" },
  { value: "tiktok", label: "TikTok" },
  { value: "youtube", label: "YouTube" },
  { value: "other", label: "Other" },
];

function parseAggregateDisaggregationConfig(rawConfig: unknown): AggregateDisaggregationConfigLike | null {
  if (!rawConfig) return null;
  if (typeof rawConfig === "string") {
    const trimmed = rawConfig.trim();
    if (!trimmed) return null;
    try {
      const parsed = JSON.parse(trimmed);
      if (!parsed || typeof parsed !== "object") return null;
      return parsed as AggregateDisaggregationConfigLike;
    } catch {
      return null;
    }
  }
  if (typeof rawConfig !== "object") return null;
  return rawConfig as AggregateDisaggregationConfigLike;
}

function getLegacyChartColor(index: number) {
  switch (index) {
    case 0:
      return BONASO_COLORS.white;
    case 1:
      return BONASO_COLORS.lightAccent;
    case 2:
      return BONASO_COLORS.alternateLight;
    case 3:
      return BONASO_COLORS.alternateUberLight;
    case 4:
      return BONASO_COLORS.warningBg;
    case 5:
      return BONASO_COLORS.uberLightAccent;
    case 6:
      return BONASO_COLORS.lightGrey;
    default: {
      const fallback = ["#f59e0b", "#fb7185", "#a78bfa", "#60a5fa", "#34d399"];
      return fallback[index % fallback.length];
    }
  }
}

function getPresentationChartColor(index: number) {
  return PROFESSIONAL_CHART_COLORS[index % PROFESSIONAL_CHART_COLORS.length];
}

function resolveChartIndicatorLabel(
  input: {
    short_name?: string | null;
    display_name?: string | null;
    name?: string | null;
    code?: string | null;
  },
  fallback = "Indicator",
) {
  const preferredName =
    (typeof input.display_name === "string" && input.display_name.trim()) ||
    (typeof input.name === "string" && input.name.trim()) ||
    undefined;
  const code = typeof input.code === "string" ? input.code.trim() : undefined;

  return getIndicatorChartLabel(
    {
      short_name: typeof input.short_name === "string" ? input.short_name : undefined,
      name: preferredName,
      code,
    },
    fallback,
  );
}

function resolveChartIndicatorNameLabel(name: string | null | undefined, fallback = "Indicator") {
  return resolveChartIndicatorLabel({ name }, fallback);
}

function normalizeSeriesKeyLabel(value: string) {
  return value.replace(/\s+/g, " ").trim().toUpperCase();
}

function getSocialMessageChartColor(label: string, index: number) {
  const normalized = normalizeSeriesKeyLabel(label);
  return SOCIAL_MESSAGE_COLOR_MAP[normalized] ?? getPresentationChartColor(index);
}

function formatQuarterLabelNoSpace(value: string) {
  const quarterMatch = value.match(/^Q([1-4])\s+(\d{4})$/i);
  if (!quarterMatch) return value;
  return `Q${quarterMatch[1]}${quarterMatch[2]}`;
}

function formatChartNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(parsed);
    }
  }

  return String(value ?? "");
}

function formatChartPercent(value: unknown) {
  const numericValue = typeof value === "number" ? value : Number(value ?? 0);
  if (!Number.isFinite(numericValue)) return "0.0%";
  return `${numericValue.toFixed(1)}%`;
}

function wrapChartLabel(value: string, maxCharsPerLine: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return [""];

  const words = normalized.split(" ");
  const lines: string[] = [];
  let currentLine = "";

  words.forEach((word) => {
    if (!currentLine) {
      currentLine = word;
      return;
    }

    const nextLine = `${currentLine} ${word}`;
    if (nextLine.length <= maxCharsPerLine) {
      currentLine = nextLine;
      return;
    }

    lines.push(currentLine);
    currentLine = word;
  });

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines;
}

function getSinglePeriodLayoutConfig(cardWidth: number): SinglePeriodLayoutConfig {
  if (cardWidth > 0 && cardWidth < 760) {
    return {
      labelWidth: 188,
      maxCharsPerLine: 18,
      lineHeight: 15,
      rowMinHeight: 50,
      compactSummary: true,
    };
  }

  if (cardWidth > 0 && cardWidth < 980) {
    return {
      labelWidth: 220,
      maxCharsPerLine: 22,
      lineHeight: 15,
      rowMinHeight: 46,
      compactSummary: true,
    };
  }

  return {
    labelWidth: 280,
    maxCharsPerLine: 28,
    lineHeight: 15,
    rowMinHeight: 40,
    compactSummary: false,
  };
}

function getSinglePeriodComparisonHeight(rows: SinglePeriodComparisonRow[], layout: SinglePeriodLayoutConfig) {
  return Math.max(
    240,
    rows.reduce((total, row) => {
      const lines = wrapChartLabel(row.label, layout.maxCharsPerLine);
      return total + Math.max(layout.rowMinHeight, lines.length * layout.lineHeight + 10);
    }, 0),
  );
}

function truncateChartLabel(label: string, maxChars: number) {
  const normalized = label.trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

function SinglePeriodComparisonYAxisTick({
  x = 0,
  y = 0,
  payload,
  color,
  maxCharsPerLine,
  lineHeight,
}: ChartAxisTickProps & {
  color: string;
  maxCharsPerLine: number;
  lineHeight: number;
}) {
  const lines = wrapChartLabel(String(payload?.value ?? ""), maxCharsPerLine);
  const firstLineOffset = ((lines.length - 1) * lineHeight) / 2;

  return (
    <g transform={`translate(${x},${y})`}>
      <text x={-10} y={0} textAnchor="end" fill={color} fontSize={12}>
        {lines.map((line, index) => (
          <tspan
            key={`${line}-${index}`}
            x={-10}
            dy={index === 0 ? -firstLineOffset : lineHeight}
          >
            {line}
          </tspan>
        ))}
      </text>
    </g>
  );
}

function SinglePeriodComparisonXAxisTick({
  x = 0,
  y = 0,
  payload,
  color,
  maxCharsPerLine,
  lineHeight,
  angle,
}: ChartAxisTickProps & {
  color: string;
  maxCharsPerLine: number;
  lineHeight: number;
  angle: number;
}) {
  const lines = wrapChartLabel(String(payload?.value ?? ""), maxCharsPerLine);

  return (
    <g transform={`translate(${x},${y})`}>
      <text fill={color} fontSize={12} textAnchor="end" transform={`rotate(${angle})`}>
        {lines.map((line, index) => (
          <tspan
            key={`${line}-${index}`}
            x={0}
            dy={index === 0 ? 10 : lineHeight}
          >
            {line}
          </tspan>
        ))}
      </text>
    </g>
  );
}

type ExcelCellValue = string | number | null;
type ExcelRow = ExcelCellValue[];

function toExcelCellValue(value: unknown): ExcelCellValue {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return "";
    const compact = trimmed.replaceAll(",", "");
    if (/^-?\d+(\.\d+)?$/.test(compact)) {
      const parsed = Number(compact);
      if (Number.isFinite(parsed)) return parsed;
    }
    return trimmed;
  }

  if (value === null || value === undefined) return null;
  return String(value);
}

function normalizeWorksheetName(name: string, fallback: string) {
  const sanitized = name.replace(/[\\/*?:[\]]/g, " ").replace(/\s+/g, " ").trim();
  if (!sanitized) return fallback;
  return sanitized.slice(0, 31);
}

function applyWorksheetColumnWidths(sheet: XLSX.WorkSheet, rows: ExcelRow[]) {
  if (rows.length === 0) return;
  const maxColumns = Math.max(...rows.map((row) => row.length));
  const widths = Array.from({ length: maxColumns }, (_, columnIndex) => {
    const maxLength = rows.reduce((currentMax, row) => {
      const value = row[columnIndex];
      const text = value === null || value === undefined ? "" : String(value);
      return Math.max(currentMax, text.length);
    }, 0);
    return { wch: Math.min(Math.max(maxLength + 2, 12), 70) };
  });
  sheet["!cols"] = widths;
}

function appendWorksheetFromRows(workbook: XLSX.WorkBook, sheetName: string, rows: ExcelRow[], fallbackName: string) {
  if (rows.length === 0) return;
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  applyWorksheetColumnWidths(worksheet, rows);
  XLSX.utils.book_append_sheet(workbook, worksheet, normalizeWorksheetName(sheetName, fallbackName));
}

function parseMonthLabel(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const quarterMatch = trimmed.match(/^Q([1-4])\s+(\d{4})$/i);
  if (quarterMatch) {
    const quarter = Number(quarterMatch[1]);
    const year = Number(quarterMatch[2]);
    return { monthIndex: (quarter - 1) * 3, year };
  }

  const isoMonthMatch = trimmed.match(/^(\d{4})-(\d{2})(?:-\d{2})?$/);
  if (isoMonthMatch) {
    const year = Number(isoMonthMatch[1]);
    const monthIndex = Number(isoMonthMatch[2]) - 1;
    if (monthIndex >= 0 && monthIndex <= 11) {
      return { monthIndex, year };
    }
  }

  const parsedDate = new Date(trimmed);
  if (Number.isNaN(parsedDate.getTime())) return null;
  return { monthIndex: parsedDate.getMonth(), year: parsedDate.getFullYear() };
}

function toSafeAggregateNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replaceAll(",", ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function readChartTargetValue(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed.replaceAll(",", ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function getChartRowTargetValue(row: Record<string, string | number> | null | undefined) {
  if (!row) return null;

  const directTarget = readChartTargetValue(row.Target);
  if (directTarget !== null) return directTarget;

  const lowercaseTarget = readChartTargetValue(row.target);
  if (lowercaseTarget !== null) return lowercaseTarget;

  const derivedTargets = Object.entries(row)
    .filter(([key]) => key.toLowerCase().endsWith("_target"))
    .map(([, value]) => readChartTargetValue(value))
    .filter((value): value is number => value !== null);

  if (derivedTargets.length === 1) return derivedTargets[0];
  return null;
}

function getAggregateValueTotal(value: unknown) {
  if (typeof value === "number" || typeof value === "string") return toSafeAggregateNumber(value);
  if (!value || typeof value !== "object") return 0;
  const source = value as Record<string, unknown>;
  if (source.total !== undefined) return toSafeAggregateNumber(source.total);
  if (source.value !== undefined) return toSafeAggregateNumber(source.value);
  if (source.male !== undefined || source.female !== undefined) {
    return toSafeAggregateNumber(source.male) + toSafeAggregateNumber(source.female);
  }
  return 0;
}

function readFiniteChartNumber(value: string | number | null | undefined) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replaceAll(",", ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function buildLinearTrendPoints(values: Array<number | null>) {
  const points = values
    .map((value, index) => ({ x: index, y: value }))
    .filter((point): point is { x: number; y: number } => point.y !== null && Number.isFinite(point.y));
  if (points.length < 2) return null;

  const n = points.length;
  const sumX = points.reduce((total, point) => total + point.x, 0);
  const sumY = points.reduce((total, point) => total + point.y, 0);
  const sumXY = points.reduce((total, point) => total + point.x * point.y, 0);
  const sumXX = points.reduce((total, point) => total + point.x * point.x, 0);
  const denominator = n * sumXX - sumX * sumX;
  if (!Number.isFinite(denominator) || denominator === 0) return null;

  const slope = (n * sumXY - sumX * sumY) / denominator;
  const intercept = (sumY - slope * sumX) / n;
  if (!Number.isFinite(slope) || !Number.isFinite(intercept)) return null;

  return { slope, intercept };
}

function getAggregateDisaggregatesMap(value: unknown): DisaggregateCategoryMap | null {
  return normalizeAggregateValueToDisaggregateMap(value) as DisaggregateCategoryMap | null;
}

function readDisaggregateEntryTotal(entry: DisaggregateEntry | undefined) {
  if (!entry) return 0;
  const preferredKeys = ["TOTAL", "Total", "total", "Value", "value", "count", "amount"];
  for (const key of preferredKeys) {
    if (entry[key] !== undefined) return toSafeAggregateNumber(entry[key]);
  }

  return Object.entries(entry).reduce((sum, [rawKey, rawValue]) => {
    const key = rawKey.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
    if (key.includes("ayp")) return sum;
    return sum + toSafeAggregateNumber(rawValue);
  }, 0);
}

function formatAggregatePeriodLabel(
  aggregate: Pick<Aggregate, "period_start" | "period_end">,
  axis: "month" | "quarter" | null,
) {
  const base = aggregate.period_start || aggregate.period_end;
  if (!base) return "-";
  if (axis === "quarter") return getQuarterLabel(base);
  if (axis === "month") {
    const date = new Date(base);
    if (Number.isNaN(date.getTime())) return String(base);
    return new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" }).format(date);
  }
  return String(base);
}

function normalizeOptionKey(value: string) {
  return value.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

type LightweightOrganization = {
  id: string | number;
  name?: string;
  parentId?: string | number | null;
  type?: string | null;
};

function resolveCoordinatorLabelByOrganizationId(
  organizationId: string,
  organizationsById: Map<string, LightweightOrganization>,
) {
  if (!organizationId) return "Unassigned coordinator";

  let cursor = organizationsById.get(organizationId);
  while (cursor) {
    const effectiveType = getEffectiveOrganizationType({
      name: cursor.name,
      type: cursor.type,
    });
    if (effectiveType === "coordinator") {
      return cursor.name || "Unassigned coordinator";
    }
    const parentId = cursor.parentId === null || cursor.parentId === undefined ? "" : String(cursor.parentId);
    if (!parentId) break;
    cursor = organizationsById.get(parentId);
  }

  return "Unassigned coordinator";
}

function buildDisaggregateChartFromAggregates(input: {
  aggregates: Aggregate[];
  axis: "month" | "quarter" | null;
  optionLabels?: Array<string | { label: string; value: string }>;
  legend?: string | null;
  stack?: string | null;
  periodFilter?: string | null;
  filters?: Record<string, string[]>;
  disaggregationConfig?: unknown;
  organizations?: LightweightOrganization[];
  compareByMode?: DisaggregateCompareMode;
}) {
  const {
    aggregates,
    axis,
    optionLabels,
    legend,
    stack,
    periodFilter = null,
    filters = {},
    disaggregationConfig,
    organizations = [],
    compareByMode = "period",
  } = input;
  const compareByCoordinator = compareByMode === "coordinator";
  const compareByOrganization = compareByMode === "organization";
  const compareByEntity = compareByCoordinator || compareByOrganization;
  if (aggregates.length === 0) return { dataArray: [] as Array<Record<string, string | number>>, keys: [] as LegacyChartKey[] };

  const chartMap = new Map<string, Record<string, string | number>>();
  const keyLabels = new Map<string, string>();
  const stackLabels = new Map<string, string>();
  const keyOrder = new Map<string, number>();
  const configuredDisaggregates = parseAggregateDisaggregationConfig(disaggregationConfig);
  const configuredDimensions = Array.isArray(configuredDisaggregates?.dimensions)
    ? configuredDisaggregates.dimensions
    : [];
  const normalizedDimensionKeys = configuredDimensions
    .map((dimension) => normalizeOptionKey(String(dimension?.key ?? dimension?.label ?? "")))
    .filter((value) => value.length > 0);
  const firstDimension = normalizedDimensionKeys[0] || "option";
  const secondDimension = normalizedDimensionKeys[1] || "sex";
  const thirdDimension = normalizedDimensionKeys[2] || "age_range";
  const normalizedLegend = normalizeOptionKey(String(legend || ""));
  const normalizedStack = normalizeOptionKey(String(stack || ""));
  let legendField = normalizedLegend && normalizedLegend !== "none" ? normalizedLegend : firstDimension;
  if (
    (compareByCoordinator && (legendField === "coordinator" || legendField === "indicator")) ||
    (compareByOrganization && (legendField === "organization" || legendField === "organization_id" || legendField === "indicator"))
  ) {
    legendField = firstDimension;
  }
  const stackField = normalizedStack && normalizedStack !== "none" ? normalizedStack : null;
  const organizationLookup = new Map<string, LightweightOrganization>(
    organizations.map((organization) => [String(organization.id), organization]),
  );
  const normalizedFilters = Object.entries(filters).reduce<Record<string, Set<string>>>((accumulator, [fieldName, values]) => {
    const normalizedField = normalizeOptionKey(fieldName);
    if (!normalizedField) return accumulator;
    const valueSet = new Set(values.map((value) => normalizeOptionKey(value)).filter(Boolean));
    if (valueSet.size > 0) accumulator[normalizedField] = valueSet;
    return accumulator;
  }, {});

  const configuredOptions = (optionLabels ?? [])
    .map((option) => {
      if (typeof option === "string") return { label: option, value: option };
      return {
        label: String(option.label || option.value || "").trim(),
        value: String(option.value || option.label || "").trim(),
      };
    })
    .filter((option) => option.value.length > 0);
  const configuredOptionLabelByKey = new Map<string, string>();

  configuredOptions.forEach((option, index) => {
    const key = normalizeOptionKey(option.value);
    if (!key) return;
    keyLabels.set(key, option.label || cleanLabel(option.value));
    configuredOptionLabelByKey.set(key, option.label || cleanLabel(option.value));
    keyOrder.set(key, index);
  });

  const totalLikeKeys = new Set(["total", "value", "amount", "count", "ayp", "ayp 10 24"]);

  const resolveDimensionValue = (
    entry: { first: string; second: string; third: string; organization: string; coordinator: string },
    fieldName: string | null,
  ) => {
    if (!fieldName) return null;
    if (
      fieldName === firstDimension ||
      fieldName === "option" ||
      fieldName === "category" ||
      fieldName === "service_category" ||
      fieldName === "service_type" ||
      fieldName === "message_type"
    ) {
      return entry.first;
    }
    if (
      fieldName === secondDimension ||
      fieldName === "sex" ||
      fieldName === "gender" ||
      fieldName === "platform"
    ) {
      return entry.second;
    }
    if (
      fieldName === thirdDimension ||
      fieldName === "age_range" ||
      fieldName === "age_group" ||
      fieldName === "age_band"
    ) {
      return entry.third;
    }
    if (fieldName === "organization" || fieldName === "organization_id") {
      return entry.organization;
    }
    if (fieldName === "coordinator") {
      return entry.coordinator;
    }
    return null;
  };

  const passesFilterSelection = (entry: { first: string; second: string; third: string; organization: string; coordinator: string }) =>
    Object.entries(normalizedFilters).every(([fieldName, selectedValues]) => {
      const value = resolveDimensionValue(entry, fieldName);
      if (!value) return true;
      return selectedValues.has(normalizeOptionKey(value));
    });

  const flattenDisaggregates = (disaggregates: DisaggregateCategoryMap) => {
    const entries: Array<{ first: string; second: string; third: string; value: number }> = [];
    Object.entries(disaggregates).forEach(([levelOne, secondLevel]) => {
      if (!secondLevel || typeof secondLevel !== "object") return;
      const levelOneLabel = levelOne.trim() || "Total";

      Object.entries(secondLevel).forEach(([levelTwo, thirdLevel]) => {
        const levelTwoLabel = levelTwo.trim() || "Total";

        if (thirdLevel && typeof thirdLevel === "object") {
          const levelThreeEntry = thirdLevel as Record<string, unknown>;
          const valueEntries = Object.entries(levelThreeEntry).filter(([rawKey, rawValue]) => {
            const key = normalizeOptionKey(rawKey);
            if (totalLikeKeys.has(key)) return false;
            if (typeof rawValue === "number") return Number.isFinite(rawValue);
            if (typeof rawValue === "string" && rawValue.trim()) {
              const parsed = Number(rawValue.replaceAll(",", ""));
              return Number.isFinite(parsed);
            }
            return false;
          });

          if (valueEntries.length === 0) {
            entries.push({
              first: levelOneLabel,
              second: levelTwoLabel,
              third: "Total",
              value: readDisaggregateEntryTotal(levelThreeEntry),
            });
            return;
          }

          valueEntries.forEach(([levelThree, rawValue]) => {
            entries.push({
              first: levelOneLabel,
              second: levelTwoLabel,
              third: levelThree.trim() || "Total",
              value: toSafeAggregateNumber(rawValue),
            });
          });
          return;
        }

        entries.push({
          first: levelOneLabel,
          second: levelTwoLabel,
          third: "Total",
          value: toSafeAggregateNumber(thirdLevel),
        });
      });
    });
    return entries;
  };
  const ensureRow = (label: string) => {
    if (!chartMap.has(label)) {
      chartMap.set(label, { period: label });
    }
    return chartMap.get(label)!;
  };

  aggregates.forEach((aggregate) => {
    const periodLabel = formatAggregatePeriodLabel(aggregate, axis);
    if (periodFilter && periodLabel !== periodFilter) {
      return;
    }
    const disaggregates = getAggregateDisaggregatesMap(aggregate.value);

    const organizationId = String(aggregate.organization ?? "");
    const organizationLabel =
      aggregate.organization_name ||
      organizationLookup.get(organizationId)?.name ||
      (organizationId ? `Org ${organizationId}` : "Unknown organization");
    const coordinatorLabel = resolveCoordinatorLabelByOrganizationId(organizationId, organizationLookup);
    const categoryLabel = compareByCoordinator
      ? coordinatorLabel
      : compareByOrganization
        ? organizationLabel
        : periodLabel;

    if (disaggregates) {
      const entries = flattenDisaggregates(disaggregates)
        .map((entry) => ({
          ...entry,
          organization: organizationLabel,
          coordinator: coordinatorLabel,
        }))
        .filter(passesFilterSelection);
      entries.forEach((entry) => {
        const legendValue = resolveDimensionValue(entry, legendField) || "Total";
        const stackValue = resolveDimensionValue(entry, stackField);
        const legendKey = normalizeOptionKey(legendValue) || "total";
        const stackKey = stackValue ? normalizeOptionKey(stackValue) : "";
        const compoundKey = stackKey ? `${legendKey}__${stackKey}` : legendKey;
        const legendLabel =
          legendField === firstDimension
            ? configuredOptionLabelByKey.get(legendKey) || cleanLabel(legendValue)
            : cleanLabel(legendValue);
        const stackLabel = stackKey ? cleanLabel(stackValue || "") : "";
        if (!keyLabels.has(compoundKey)) {
          keyLabels.set(compoundKey, stackLabel ? `${legendLabel} - ${stackLabel}` : legendLabel);
        }
        if (stackKey && !stackLabels.has(compoundKey)) {
          stackLabels.set(compoundKey, legendLabel);
        }
        if (!keyOrder.has(compoundKey) && keyOrder.has(legendKey)) {
          keyOrder.set(compoundKey, keyOrder.get(legendKey)!);
        }
        const row = ensureRow(categoryLabel);
        row[compoundKey] = toSafeAggregateNumber(row[compoundKey]) + entry.value;
      });
      return;
    }

    const fallbackLabel =
      legendField === "organization"
        ? organizationLabel
        : legendField === "coordinator"
          ? coordinatorLabel
          : "Total";
    const fallbackKey = normalizeOptionKey(fallbackLabel) || "total";
    if (!keyLabels.has(fallbackKey)) keyLabels.set(fallbackKey, fallbackLabel);
    const row = ensureRow(categoryLabel);
    row[fallbackKey] = toSafeAggregateNumber(row[fallbackKey]) + getAggregateValueTotal(aggregate.value);
  });

  const keys = Array.from(keyLabels.entries())
    .sort(([leftKey, leftLabel], [rightKey, rightLabel]) => {
      const leftConfiguredOrder = keyOrder.get(leftKey);
      const rightConfiguredOrder = keyOrder.get(rightKey);
      if (leftConfiguredOrder !== undefined || rightConfiguredOrder !== undefined) {
        return (leftConfiguredOrder ?? Number.MAX_SAFE_INTEGER) - (rightConfiguredOrder ?? Number.MAX_SAFE_INTEGER);
      }
      return leftLabel.localeCompare(rightLabel);
    })
    .map(([key, label]) => ({
      key,
      label,
      stackId: stackField ? stackLabels.get(key) : undefined,
    }));

  const dataArray = Array.from(chartMap.values()).sort((left, right) =>
    compareByEntity
      ? String(left.period ?? "").localeCompare(String(right.period ?? ""))
      : sortPeriods(String(left.period ?? ""), String(right.period ?? ""), axis ?? "month"),
  );
  dataArray.forEach((row) => {
    keys.forEach((key) => {
      if (typeof row[key.key] !== "number") {
        row[key.key] = 0;
      }
    });
  });

  return { dataArray, keys };
}

function buildIndicatorComparisonChartFromAggregates(input: {
  aggregates: Aggregate[];
  axis: "month" | "quarter" | null;
  periodFilter?: string | null;
  filters?: Record<string, string[]>;
  organizations?: LightweightOrganization[];
  indicatorOrder: number[];
  indicatorDisplayNameById: Map<number, string>;
  compareByMode: "organization" | "coordinator";
}) {
  const {
    aggregates,
    axis,
    periodFilter = null,
    filters = {},
    organizations = [],
    indicatorOrder,
    indicatorDisplayNameById,
    compareByMode,
  } = input;
  if (aggregates.length === 0 || indicatorOrder.length === 0) {
    return { dataArray: [] as Array<Record<string, string | number>>, keys: [] as LegacyChartKey[] };
  }

  const chartMap = new Map<string, Record<string, string | number>>();
  const keyLabels = new Map<string, string>();
  const organizationLookup = new Map<string, LightweightOrganization>(
    organizations.map((organization) => [String(organization.id), organization]),
  );
  const normalizedIndicatorOrder = indicatorOrder
    .map((indicatorId) => resolveIndicatorId(indicatorId))
    .filter((indicatorId) => Number.isFinite(indicatorId));
  const indicatorOrderByKey = new Map<string, number>(
    normalizedIndicatorOrder.map((indicatorId, index) => [`indicator_${indicatorId}`, index]),
  );
  const indicatorIdSet = new Set(normalizedIndicatorOrder);
  const indicatorLabelByNormalizedId = new Map<number, string>();
  indicatorOrder.forEach((indicatorId) => {
    const normalizedIndicatorId = resolveIndicatorId(indicatorId);
    if (!Number.isFinite(normalizedIndicatorId)) return;
    const label =
      indicatorDisplayNameById.get(indicatorId) ||
      indicatorDisplayNameById.get(normalizedIndicatorId);
    if (!label || indicatorLabelByNormalizedId.has(normalizedIndicatorId)) return;
    indicatorLabelByNormalizedId.set(normalizedIndicatorId, label);
  });
  const normalizedFilters = Object.entries(filters).reduce<Record<string, Set<string>>>((accumulator, [fieldName, values]) => {
    const normalizedField = normalizeOptionKey(fieldName);
    if (!normalizedField) return accumulator;
    const valueSet = new Set(values.map((value) => normalizeOptionKey(value)).filter(Boolean));
    if (valueSet.size > 0) accumulator[normalizedField] = valueSet;
    return accumulator;
  }, {});

  const resolveFilterValue = (
    values: { organization: string; coordinator: string; indicator: string },
    fieldName: string,
  ) => {
    if (fieldName === "organization" || fieldName === "organization_id") return values.organization;
    if (fieldName === "coordinator") return values.coordinator;
    if (fieldName === "indicator") return values.indicator;
    return null;
  };

  const passesFilterSelection = (values: { organization: string; coordinator: string; indicator: string }) =>
    Object.entries(normalizedFilters).every(([fieldName, selectedValues]) => {
      const value = resolveFilterValue(values, fieldName);
      if (!value) return true;
      return selectedValues.has(normalizeOptionKey(value));
    });

  const ensureRow = (label: string) => {
    if (!chartMap.has(label)) {
      chartMap.set(label, { period: label });
    }
    return chartMap.get(label)!;
  };

  aggregates.forEach((aggregate) => {
    const indicatorId = resolveIndicatorId(aggregate.indicator ?? Number.NaN);
    if (!indicatorIdSet.has(indicatorId)) return;

    const periodLabel = formatAggregatePeriodLabel(aggregate, axis);
    if (periodFilter && periodLabel !== periodFilter) return;

    const organizationId = String(aggregate.organization ?? "");
    const organizationLabel =
      aggregate.organization_name ||
      organizationLookup.get(organizationId)?.name ||
      (organizationId ? `Org ${organizationId}` : "Unknown organization");
    const coordinatorLabel = resolveCoordinatorLabelByOrganizationId(organizationId, organizationLookup);
    if (compareByMode === "coordinator" && coordinatorLabel === "Unassigned coordinator") return;

    const indicatorLabel =
      indicatorLabelByNormalizedId.get(indicatorId) ||
      indicatorDisplayNameById.get(indicatorId) ||
      resolveChartIndicatorNameLabel(aggregate.indicator_name, `Indicator ${indicatorId}`);
    const filterValues = {
      organization: organizationLabel,
      coordinator: coordinatorLabel,
      indicator: indicatorLabel,
    };
    if (!passesFilterSelection(filterValues)) return;

    const categoryLabel = compareByMode === "coordinator" ? coordinatorLabel : organizationLabel;
    const indicatorKey = `indicator_${indicatorId}`;
    if (!keyLabels.has(indicatorKey)) {
      keyLabels.set(indicatorKey, indicatorLabel);
    }

    const row = ensureRow(categoryLabel);
    row[indicatorKey] = toSafeAggregateNumber(row[indicatorKey]) + getAggregateValueTotal(aggregate.value);
  });

  const keys = Array.from(keyLabels.entries())
    .sort(([leftKey, leftLabel], [rightKey, rightLabel]) => {
      const leftOrder = indicatorOrderByKey.get(leftKey);
      const rightOrder = indicatorOrderByKey.get(rightKey);
      if (leftOrder !== undefined || rightOrder !== undefined) {
        return (leftOrder ?? Number.MAX_SAFE_INTEGER) - (rightOrder ?? Number.MAX_SAFE_INTEGER);
      }
      return leftLabel.localeCompare(rightLabel);
    })
    .map(([key, label]) => ({
      key,
      label,
    }));

  const dataArray = Array.from(chartMap.values()).sort((left, right) =>
    String(left.period ?? "").localeCompare(String(right.period ?? "")),
  );
  dataArray.forEach((row) => {
    keys.forEach((key) => {
      if (typeof row[key.key] !== "number") {
        row[key.key] = 0;
      }
    });
  });

  return { dataArray, keys };
}

function getQuarterLabel(periodLabel: string) {
  const parsed = parseMonthLabel(periodLabel);
  if (!parsed) return periodLabel;

  const { monthIndex, year } = parsed;
  if (monthIndex <= 2) return `Q4 ${year}`;
  if (monthIndex <= 5) return `Q1 ${year}`;
  if (monthIndex <= 8) return `Q2 ${year}`;
  return `Q3 ${year}`;
}

function sortPeriods(leftPeriod: string, rightPeriod: string, axis?: "month" | "quarter" | null) {
  if (axis === "quarter") {
    const [leftQuarter, leftYear] = leftPeriod.split(" ");
    const [rightQuarter, rightYear] = rightPeriod.split(" ");
    const leftQuarterNumber = Number(leftQuarter.replace("Q", ""));
    const rightQuarterNumber = Number(rightQuarter.replace("Q", ""));
    return Number(leftYear) - Number(rightYear) || leftQuarterNumber - rightQuarterNumber;
  }

  const leftParsed = parseMonthLabel(leftPeriod);
  const rightParsed = parseMonthLabel(rightPeriod);
  if (leftParsed && rightParsed) {
    return leftParsed.year - rightParsed.year || leftParsed.monthIndex - rightParsed.monthIndex;
  }

  return leftPeriod.localeCompare(rightPeriod);
}

function toMonthBucketKey(value: { monthIndex: number; year: number }) {
  const month = String(value.monthIndex + 1).padStart(2, "0");
  return `${value.year}-${month}`;
}

function normalizePeriodKey(value: string, axis?: "month" | "quarter" | null) {
  const trimmed = value.trim();
  if (!trimmed) return "";

  if (axis === "quarter") {
    const directQuarter = trimmed.match(/^Q([1-4])\s+(\d{4})$/i);
    if (directQuarter) {
      return `Q${directQuarter[1]} ${directQuarter[2]}`;
    }
    const resolvedQuarter = getQuarterLabel(trimmed).match(/^Q([1-4])\s+(\d{4})$/i);
    if (resolvedQuarter) {
      return `Q${resolvedQuarter[1]} ${resolvedQuarter[2]}`;
    }
    return trimmed.toLowerCase();
  }

  if (axis === "month") {
    const parsedMonth = parseMonthLabel(trimmed);
    if (!parsedMonth) return trimmed.toLowerCase();
    return toMonthBucketKey(parsedMonth);
  }

  return trimmed.toLowerCase();
}

function resolveDateToPeriodLabel(
  dateValue: string,
  axis: "month" | "quarter" | null,
  periodLabels: string[],
) {
  if (!dateValue || !axis || periodLabels.length === 0) return "";
  const targetKey = normalizePeriodKey(dateValue, axis);
  if (!targetKey) return "";
  const matchedLabel = periodLabels.find((periodLabel) => normalizePeriodKey(periodLabel, axis) === targetKey);
  return matchedLabel || "";
}

function getFilterFieldLabel(name: string, fallbackLabel?: string | null) {
  return fallbackLabel || FILTER_FIELD_LABELS[name] || cleanLabel(name);
}

function normalizeSelectableOption(option: unknown): ChartFilterOption | null {
  if (typeof option === "string" || typeof option === "number") {
    const value = String(option);
    return { value, label: cleanLabel(value) };
  }

  if (typeof option !== "object" || option === null) return null;

  const source = option as Record<string, unknown>;
  const rawValue = source.value ?? source.id ?? source.code ?? source.name ?? source.label;
  if (rawValue === null || rawValue === undefined || rawValue === "") return null;

  const value = String(rawValue);
  const rawLabel = source.label ?? source.display_name ?? source.name ?? source.value;
  return {
    value,
    label: typeof rawLabel === "string" && rawLabel.trim() ? rawLabel : cleanLabel(value),
  };
}

function groupChartFilters(filters: IndicatorChartSetting["filters"]) {
  return (filters ?? []).reduce<Record<string, string[]>>((accumulator, filter) => {
    const fieldName = filter.field_detail?.name;
    if (!fieldName) return accumulator;

    if (!accumulator[fieldName]) accumulator[fieldName] = [];
    if (!accumulator[fieldName].includes(filter.value)) {
      accumulator[fieldName].push(filter.value);
    }

    return accumulator;
  }, {});
}

function sanitizeFilterGroups(filters: Record<string, string[]>) {
  return Object.entries(filters).reduce<Record<string, string[]>>((accumulator, [fieldName, values]) => {
    const nextValues = Array.from(new Set(values.filter((value) => value.trim())));
    if (nextValues.length > 0) accumulator[fieldName] = nextValues;
    return accumulator;
  }, {});
}

function removeReservedMetricFilterValues(filters: Record<string, string[]>) {
  return Object.entries(filters).reduce<Record<string, string[]>>((accumulator, [fieldName, values]) => {
    if (fieldName !== "metric") {
      accumulator[fieldName] = values;
      return accumulator;
    }

    const nextValues = values.filter((value) => !isReservedMetricFilterValue(value));
    if (nextValues.length > 0) {
      accumulator[fieldName] = nextValues;
    }
    return accumulator;
  }, {});
}

function getReservedMetricFilterValues(filters: Record<string, string[]>) {
  return Array.from(
    new Set((filters.metric ?? []).filter((value) => isReservedMetricFilterValue(value))),
  );
}

function WrappedXAxisTick({
  x = 0,
  y = 0,
  payload,
  color,
  maxCharsPerLine,
  lineHeight,
}: ChartAxisTickProps & {
  color: string;
  maxCharsPerLine: number;
  lineHeight: number;
}) {
  const lines = wrapChartLabel(String(payload?.value ?? ""), maxCharsPerLine);

  return (
    <g transform={`translate(${x},${y})`}>
      <text fill={color} fontSize={12} textAnchor="middle">
        {lines.map((line, index) => (
          <tspan
            key={`${line}-${index}`}
            x={0}
            dy={index === 0 ? 10 : lineHeight}
          >
            {line}
          </tspan>
        ))}
      </text>
    </g>
  );
}

function buildFilterGroups(
  chart: IndicatorChartSetting,
  dashboardBreakdowns: Record<string, unknown> | undefined,
): ChartFilterGroup[] {
  const groups = new Map<string, ChartFilterGroup>();
  const isSocialChart = (chart.indicator_details ?? []).some((indicator) => indicator.category === "social");

  const upsertGroup = (name: string, label?: string | null, options?: ChartFilterOption[]) => {
    const existing = groups.get(name);
    const optionMap = new Map<string, ChartFilterOption>();

    (existing?.options ?? []).forEach((option) => optionMap.set(option.value, option));
    (options ?? []).forEach((option) => optionMap.set(option.value, option));

    groups.set(name, {
      name,
      label: getFilterFieldLabel(name, label ?? existing?.label),
      options: Array.from(optionMap.values()).sort((left, right) => left.label.localeCompare(right.label)),
    });
  };

  Object.entries(dashboardBreakdowns ?? {}).forEach(([fieldName, rawOptions]) => {
    if (!Array.isArray(rawOptions)) return;
    const options = rawOptions
      .map((option) => normalizeSelectableOption(option))
      .filter((option): option is ChartFilterOption => option !== null)
      .filter((option) => fieldName !== "metric" || !isReservedMetricFilterValue(option.value));
    if (options.length === 0) return;
    upsertGroup(fieldName, null, options);
  });

  const indicatorOptions = (chart.indicator_details ?? [])
    .flatMap((indicator) => indicator.options ?? [])
    .map((option) => normalizeSelectableOption(option))
    .filter((option): option is ChartFilterOption => option !== null);
  if (indicatorOptions.length > 0) {
    upsertGroup("option", FILTER_FIELD_LABELS.option, indicatorOptions);
  }

  (chart.indicator_details ?? []).forEach((indicator) => {
    const parsedConfig = parseAggregateDisaggregationConfig(
      (indicator as { aggregate_disaggregation_config?: unknown }).aggregate_disaggregation_config,
    );
    const dimensions = parsedConfig?.dimensions;
    if (!Array.isArray(dimensions)) return;

    dimensions.forEach((dimension) => {
      if (!dimension || typeof dimension !== "object") return;
      const source = dimension as { key?: unknown; label?: unknown; values?: unknown[] };
      const key = typeof source.key === "string" ? source.key.trim() : "";
      if (!key) return;
      const label =
        typeof source.label === "string" && source.label.trim()
          ? source.label
          : cleanLabel(key);
      const options = Array.isArray(source.values)
        ? source.values
            .map((value) => normalizeSelectableOption(value))
            .filter((option): option is ChartFilterOption => option !== null)
        : [];
      if (options.length > 0) {
        upsertGroup(key, label, options);
      }
    });
  });

  if (isSocialChart) {
    upsertGroup("platform", FILTER_FIELD_LABELS.platform, SOCIAL_PLATFORM_OPTIONS);
  }

  (chart.filters ?? []).forEach((filter) => {
    const fieldName = filter.field_detail?.name;
    if (!fieldName) return;
    if (fieldName === "metric" && isReservedMetricFilterValue(filter.value)) return;
    upsertGroup(fieldName, filter.field_detail?.label, [{ value: filter.value, label: cleanLabel(filter.value) }]);
  });

  return Array.from(groups.values())
    .filter((group) => group.options.length > 0)
    .sort((left, right) => {
      const leftOrder = FILTER_FIELD_ORDER[left.name] ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = FILTER_FIELD_ORDER[right.name] ?? Number.MAX_SAFE_INTEGER;
      return leftOrder - rightOrder || left.label.localeCompare(right.label);
    });
}

function normalizeLegacyRows(chartData: IndicatorChartSetting["chart_data"]) {
  if (Array.isArray(chartData)) {
    return chartData.filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null);
  }

  if (typeof chartData === "object" && chartData !== null) {
    return Object.values(chartData).filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null);
  }

  return [];
}

function parseBiologicalFigureRows(chartData: IndicatorChartSetting["chart_data"]): BiologicalFigureRow[] {
  const rows = normalizeLegacyRows(chartData);
  if (rows.length === 0) return [];

  const canonicalFactor = (value: unknown) => {
    const text = String(value ?? "").trim().toLowerCase();
    if (!text) return null;
    if (text.includes("blood glucose")) return "Blood Glucose";
    if (text === "bp" || text.includes("blood pressure")) return "BP";
    if (text.includes("bmi") || text.includes("body mass")) return "BMI";
    if (text.includes("waist")) return "Waist Circumference";
    return null;
  };

  const canonicalSex = (value: unknown) => {
    const text = String(value ?? "").trim().toLowerCase();
    if (text.startsWith("f")) return "Female";
    if (text.startsWith("m")) return "Male";
    return null;
  };

  const parsed = rows
    .map((row) => {
      const factor = canonicalFactor(row.factor ?? row.category ?? row.ncd_factor ?? row.option);
      const sex = canonicalSex(row.sex ?? row.gender);
      if (!factor || !sex) return null;

      const screened = Number(row.screened ?? row.screened_total ?? row.value ?? 0);
      const referred = Number(row.referred ?? row.referred_total ?? row.target ?? 0);
      const period = typeof row.period === "string" ? row.period : undefined;

      const parsedRow: BiologicalFigureRow = {
        factor,
        sex,
        screened: Number.isFinite(screened) ? screened : 0,
        referred: Number.isFinite(referred) ? referred : 0,
      };
      if (period) parsedRow.period = period;
      return parsedRow;
    })
    .filter((row): row is BiologicalFigureRow => row !== null);

  return parsed.sort((left, right) => {
    const leftFactor = BIOLOGICAL_FACTOR_SEQUENCE.indexOf(left.factor as (typeof BIOLOGICAL_FACTOR_SEQUENCE)[number]);
    const rightFactor = BIOLOGICAL_FACTOR_SEQUENCE.indexOf(right.factor as (typeof BIOLOGICAL_FACTOR_SEQUENCE)[number]);
    const factorOrder = (leftFactor === -1 ? 999 : leftFactor) - (rightFactor === -1 ? 999 : rightFactor);
    if (factorOrder !== 0) return factorOrder;
    if (left.sex === right.sex) return 0;
    return left.sex === "Female" ? -1 : 1;
  });
}

function normalizeBiologicalPeriod(
  value: string | undefined,
  axis: "month" | "quarter",
) {
  const raw = String(value || "").trim();
  if (!raw) return axis === "month" ? "Current Month" : "Current Quarter";

  if (axis === "month") {
    const parsed = parseMonthLabel(raw);
    if (parsed) {
      const date = new Date(parsed.year, parsed.monthIndex, 1);
      return new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" }).format(date);
    }
    const quarterMatch = raw.match(/^Q([1-4])\s+(\d{4})$/i);
    if (quarterMatch) {
      const quarter = Number(quarterMatch[1]);
      const year = Number(quarterMatch[2]);
      const monthIndex = quarter * 3 - 1;
      const date = new Date(year, monthIndex, 1);
      return new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" }).format(date);
    }
    return "Current Month";
  }

  if (/^Q[1-4]\s+\d{4}$/i.test(raw)) return raw;
  return getQuarterLabel(raw);
}

const AUTO_BREAKDOWN_FIELDS = [
  "option",
  "category",
  "label",
  "name",
  "disaggregate",
  "disaggregation",
  "disaggregate_label",
  "message_type",
  "service_type",
  "sub_indicator",
  "indicator_label",
  "sex",
  "age_range",
  "kp_type",
  "disability_type",
  "special_attribute",
  "district",
  "citizenship",
  "hiv_status",
  "pregnancy",
  "platform",
  "metric",
] as const;

const NON_BREAKDOWN_FIELDS = new Set([
  "period",
  "month",
  "quarter",
  "year",
  "date",
  "start",
  "end",
  "count",
  "value",
  "total",
  "target",
  "achieved",
  "amount",
  "order",
  "id",
  "pk",
  "indicator_id",
  "project_id",
  "organization_id",
]);

function isNumericLike(value: string) {
  if (!value.trim()) return false;
  return /^-?\d+(\.\d+)?$/.test(value.replaceAll(",", ""));
}

function getDistinctValuesForField(rows: Array<Record<string, unknown>>, field: string) {
  return new Set(
    rows
      .map((row) => String(row[field] ?? "").trim())
      .filter((value) => value.length > 0),
  );
}

function detectAutoBreakdownField(
  rows: Array<Record<string, unknown>>,
  exclude?: string | null,
) {
  for (const field of AUTO_BREAKDOWN_FIELDS) {
    if (exclude && field === exclude) continue;
    const values = getDistinctValuesForField(rows, field);
    if (values.size > 1) return field;
  }

  const candidateFieldOrder = Array.from(
    rows.reduce((fields, row) => {
      Object.keys(row).forEach((field) => fields.add(field));
      return fields;
    }, new Set<string>()),
  );

  for (const field of candidateFieldOrder) {
    if (!field || (exclude && field === exclude) || NON_BREAKDOWN_FIELDS.has(field)) continue;
    const values = getDistinctValuesForField(rows, field);
    if (values.size <= 1 || values.size > 48) continue;
    if (Array.from(values).every((value) => isNumericLike(value))) continue;
    return field;
  }

  return null;
}

function getRowDimensionValue(row: Record<string, unknown>, fieldName: string | null | undefined) {
  if (!fieldName) return null;
  const direct = row[fieldName];
  if (direct !== undefined && direct !== null && String(direct).trim()) {
    return String(direct);
  }

  if (fieldName === "indicator") {
    const candidate = row.indicator_name ?? row.indicator_label ?? row.indicator ?? row.name;
    return candidate === undefined || candidate === null ? null : String(candidate);
  }

  if (fieldName === "option") {
    const candidate =
      row.option ??
      row.category ??
      row.disaggregate ??
      row.disaggregation ??
      row.disaggregate_label ??
      row.message_type ??
      row.service_type ??
      row.sub_indicator ??
      row.label ??
      row.name;
    return candidate === undefined || candidate === null ? null : String(candidate);
  }

  return null;
}

function splitLegacyChartData(
  chart: IndicatorChartSetting,
  breakdowns: BreakdownMap | undefined,
  axisOverride?: "month" | "quarter" | null,
): { dataArray: Array<Record<string, string | number>>; keys: LegacyChartKey[] } {
  const rows = normalizeLegacyRows(chart.chart_data);
  if (rows.length === 0) return { dataArray: [], keys: [] };
  const axis = axisOverride ?? (chart.axis === "month" ? "month" : chart.axis === "quarter" ? "quarter" : null);

  const explicitLegend = chart.indicators.length > 1 ? "indicator" : chart.legend;
  const effectiveLegend = explicitLegend || detectAutoBreakdownField(rows);
  const effectiveStack =
    chart.chart_type === "bar"
      ? chart.stack || detectAutoBreakdownField(rows, effectiveLegend)
      : chart.stack;
  const chartMap: Record<string, Record<string, string | number>> = {};
  const keyMap = new Map<string, LegacyChartKey>();
  const sortMap = new Map<string, number>();

  rows.forEach((row) => {
    const rawPeriod = String(row.period ?? row.quarter ?? row.month ?? row.reporting_period ?? row.date ?? "-");
    const period = axis === "quarter" ? getQuarterLabel(rawPeriod) : rawPeriod;
    const legendValue = effectiveLegend ? getRowDimensionValue(row, effectiveLegend) ?? "Total" : "Total";
    const stackValue = effectiveStack ? getRowDimensionValue(row, effectiveStack) ?? "" : "";
    const rawCount = row.count ?? row.value ?? row.total ?? row.achieved ?? row.amount ?? 0;
    const count = typeof rawCount === "number" ? rawCount : Number(rawCount ?? 0);
    const legendLabel =
      normalizeBreakdownLabel(breakdowns, effectiveLegend, legendValue) ??
      (effectiveLegend === "indicator"
        ? resolveChartIndicatorNameLabel(legendValue, cleanLabel(legendValue))
        : cleanLabel(legendValue));
    const stackLabel = effectiveStack
      ? normalizeBreakdownLabel(breakdowns, effectiveStack, stackValue) ??
        (effectiveStack === "indicator"
          ? resolveChartIndicatorNameLabel(stackValue, cleanLabel(stackValue))
          : cleanLabel(stackValue))
      : "";
    const compoundKey = effectiveStack ? `${legendValue}__${stackValue}` : legendValue;

    if (!chartMap[period]) chartMap[period] = { period };
    const previousCount = Number(chartMap[period][compoundKey] ?? 0);
    chartMap[period][compoundKey] = previousCount + (Number.isFinite(count) ? count : 0);

    if (!keyMap.has(compoundKey)) {
      keyMap.set(compoundKey, {
        key: compoundKey,
        label: effectiveStack && stackLabel ? `${legendLabel} - ${stackLabel}` : legendLabel,
        stackId: effectiveStack ? legendLabel : undefined,
      });
    }

    if (effectiveLegend === "indicator" && typeof row.order === "number") {
      sortMap.set(legendValue, row.order);
    }
    if (effectiveLegend === "age_range") {
      const ageOrder = getAgeBandSortOrder(legendValue);
      if (ageOrder !== undefined) {
        sortMap.set(legendValue, ageOrder);
      }
    }
  });

  (chart.targets ?? []).forEach((targetGroup) => {
    Object.entries(targetGroup).forEach(([period, rawValue]) => {
      const numericValue = typeof rawValue === "number" ? rawValue : Number(rawValue ?? 0);
      const periodRaw = axis ? period : "All-Time";
      const periodKey = axis === "quarter" ? getQuarterLabel(periodRaw) : periodRaw;
      if (!chartMap[periodKey]) chartMap[periodKey] = { period: periodKey };
      chartMap[periodKey].Target = Number.isFinite(numericValue) ? numericValue : 0;
    });
  });

  const dataArray = Object.values(chartMap);
  if (axis === "month") {
    dataArray.sort((left, right) => sortPeriods(String(left.period), String(right.period), "month"));
  } else if (axis === "quarter") {
    dataArray.sort((left, right) => sortPeriods(String(left.period), String(right.period), "quarter"));
  }

  const keys = Array.from(keyMap.values()).sort((left, right) => {
    const leftBase = effectiveStack ? left.key.split("__")[0] : left.key;
    const rightBase = effectiveStack ? right.key.split("__")[0] : right.key;
    const leftOrder = sortMap.get(leftBase);
    const rightOrder = sortMap.get(rightBase);
    if (leftOrder !== undefined || rightOrder !== undefined) {
      return (leftOrder ?? Number.MAX_SAFE_INTEGER) - (rightOrder ?? Number.MAX_SAFE_INTEGER);
    }
    return left.label.localeCompare(right.label);
  });

  return { dataArray, keys };
}

function LegacyTooltip({
  active,
  payload,
  label,
  presentation = false,
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string;
  presentation?: boolean;
}) {
  if (!active || !payload?.length) return null;
  const payloadTitle =
    typeof payload[0]?.payload?.period === "string" && payload[0].payload.period.trim()
      ? payload[0].payload.period
      : typeof payload[0]?.payload?.label === "string" && payload[0].payload.label.trim()
        ? payload[0].payload.label
        : null;
  const tooltipTitle =
    payloadTitle ||
    (typeof label === "string" && label.trim()) ||
    String(payload[0]?.name ?? payload[0]?.dataKey ?? "Value");

  return (
    <div
      className="rounded-md border px-3 py-2 text-sm shadow-xl"
      style={{
        backgroundColor: presentation ? "#ffffff" : BONASO_COLORS.darkAccent,
        borderColor: presentation ? "#d1d5db" : "rgba(255,255,255,0.18)",
        color: presentation ? "#334155" : BONASO_COLORS.white,
        boxShadow: presentation ? "0 10px 30px rgba(15, 23, 42, 0.12)" : undefined,
      }}
    >
      <div className="font-semibold">{tooltipTitle}</div>
      <div className="mt-1 space-y-1">
        {payload.map((entry, index) => {
          const entryLabel =
            (typeof entry.name === "string" && entry.name.trim()) ||
            cleanLabel(String(entry.dataKey ?? `series_${index + 1}`));
          return (
            <div key={String(entry.dataKey ?? entry.name ?? index)} style={{ color: entry.color ?? BONASO_COLORS.white }}>
              {entryLabel}: {entry.value === null || entry.value === undefined ? "No data reported" : formatChartNumber(entry.value)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function cloneNodeWithInlineStyles(node: HTMLElement) {
  const clone = node.cloneNode(true) as HTMLElement;
  const sourceNodes = [node, ...Array.from(node.querySelectorAll("*"))];
  const clonedNodes = [clone, ...Array.from(clone.querySelectorAll("*"))];

  sourceNodes.forEach((sourceNode, index) => {
    const clonedNode = clonedNodes[index];
    if (!(clonedNode instanceof HTMLElement || clonedNode instanceof SVGElement)) return;

    const computedStyle = window.getComputedStyle(sourceNode);
    for (let styleIndex = 0; styleIndex < computedStyle.length; styleIndex += 1) {
      const propertyName = computedStyle.item(styleIndex);
      clonedNode.style.setProperty(
        propertyName,
        computedStyle.getPropertyValue(propertyName),
        computedStyle.getPropertyPriority(propertyName),
      );
    }

    if (clonedNode instanceof SVGElement && !clonedNode.getAttribute("xmlns")) {
      clonedNode.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    }
  });

  return clone;
}

async function renderElementToBlob(
  element: HTMLElement,
): Promise<{ blob: Blob; extension: "png" | "svg" }> {
  if ("fonts" in document) {
    await document.fonts.ready;
  }

  const rect = element.getBoundingClientRect();
  const width = Math.max(1, Math.ceil(rect.width));
  const height = Math.max(1, Math.ceil(rect.height));
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  const clonedNode = cloneNodeWithInlineStyles(element);

  clonedNode.style.margin = "0";
  clonedNode.style.width = `${width}px`;
  clonedNode.style.height = `${height}px`;
  clonedNode.style.boxSizing = "border-box";

  const wrapper = document.createElement("div");
  wrapper.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
  wrapper.style.width = `${width}px`;
  wrapper.style.height = `${height}px`;
  wrapper.style.background = "#fcfdff";
  wrapper.appendChild(clonedNode);

  const serializedMarkup = new XMLSerializer().serializeToString(wrapper);
  const svgMarkup = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <foreignObject width="100%" height="100%">${serializedMarkup}</foreignObject>
    </svg>
  `;

  const svgBlob = new Blob([svgMarkup], { type: "image/svg+xml;charset=utf-8" });
  const imageUrl = URL.createObjectURL(svgBlob);

  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Unable to prepare the card image."));
      img.src = imageUrl;
    });

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * pixelRatio));
    canvas.height = Math.max(1, Math.round(height * pixelRatio));

    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Unable to create a download canvas.");
    }

    context.scale(pixelRatio, pixelRatio);
    context.fillStyle = "#fcfdff";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);

    const pngBlob = await new Promise<Blob>((resolve, reject) => {
      try {
        canvas.toBlob((blob) => {
          if (blob) {
            resolve(blob);
            return;
          }
          reject(new Error("Unable to generate the card download."));
        }, "image/png");
      } catch (errorCaught) {
        reject(errorCaught);
      }
    });

    return { blob: pngBlob, extension: "png" };
  } catch (errorCaught) {
    if (
      errorCaught instanceof DOMException &&
      errorCaught.name === "SecurityError"
    ) {
      return { blob: svgBlob, extension: "svg" };
    }
    throw errorCaught;
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

export function DashboardChartCard(props: DashboardChartCardProps) {
  const { chart, dashboard, onEdit, onDelete, onRefresh, zoomable = true, zoomedView = false } = props;
  const { toast } = useToast();
  const cardRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<HTMLDivElement | null>(null);
  const downloadInFlightRef = useRef(false);
  const [cardWidth, setCardWidth] = useState(0);
  const [zoomOpen, setZoomOpen] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [showSupportingData, setShowSupportingData] = useState(false);
  const [showComparisonSummary, setShowComparisonSummary] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [savingFilters, setSavingFilters] = useState(false);
  const [selectedAxis, setSelectedAxis] = useState<"quarter" | "month">(() => (chart.axis === "month" ? "month" : "quarter"));
  const [selectedPeriod, setSelectedPeriod] = useState("all");
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedCoordinator, setSelectedCoordinator] = useState("all");
  const [barOrientation, setBarOrientation] = useState<"vertical" | "horizontal">("vertical");
  const [activeFilters, setActiveFilters] = useState<Record<string, string[]>>(() => groupChartFilters(chart.filters));
  const [expandedFilterGroups, setExpandedFilterGroups] = useState<Record<string, boolean>>({});
  const usingDemoDashboard = isDemoAnalysisId(dashboard.id);
  const dashboardBreakdowns = undefined;
  const hasLegacyChartData = !usingDemoDashboard && normalizeLegacyRows(chart.chart_data).length > 0;
  const primaryIndicator = chart.indicator_details?.[0];
  const indicatorShortNameById = useMemo(() => {
    const entries = chart.indicator_details ?? [];
    const map = new Map<number, string>();

    entries.forEach((entry) => {
      const shortName = typeof entry.short_name === "string" ? entry.short_name.trim() : "";
      if (!shortName) return;
      map.set(entry.id, shortName);
    });

    return map;
  }, [chart.indicator_details]);
  const indicatorDisplayNameById = useMemo(() => {
    const entries = chart.indicator_details ?? [];
    const map = new Map<number, string>();

    entries.forEach((entry) => {
      const label = resolveChartIndicatorLabel(
        {
          short_name: entry.short_name,
          display_name: entry.display_name,
          name: entry.name,
          code: entry.code,
        },
        `Indicator ${entry.id}`,
      );
      if (!label) return;
      map.set(entry.id, label);
    });

    return map;
  }, [chart.indicator_details]);
  const indicatorLegendLabelLookup = useMemo(() => {
    const entries = chart.indicator_details ?? [];
    const map = new Map<string, string>();

    const addCandidate = (candidate: string | null | undefined, preferredLabel: string) => {
      const trimmed = typeof candidate === "string" ? candidate.trim() : "";
      if (!trimmed) return;

      [trimmed, resolveChartIndicatorNameLabel(trimmed, trimmed)].forEach((value) => {
        const normalized = normalizeOptionKey(value);
        if (!normalized) return;
        map.set(normalized, preferredLabel);
      });
    };

    entries.forEach((entry) => {
      const shortName = typeof entry.short_name === "string" ? entry.short_name.trim() : "";
      const preferredLabel =
        shortName ||
        resolveChartIndicatorLabel(
          {
            short_name: entry.short_name,
            display_name: entry.display_name,
            name: entry.name,
            code: entry.code,
          },
          `Indicator ${entry.id}`,
        );

      addCandidate(entry.short_name, preferredLabel);
      addCandidate(entry.display_name, preferredLabel);
      addCandidate(entry.name, preferredLabel);
      addCandidate(entry.code, preferredLabel);
    });

    return map;
  }, [chart.indicator_details]);
  const primaryIndicatorCategory = primaryIndicator?.category ?? null;
  const primaryIndicatorType = primaryIndicator?.type ?? null;
  const { data: organizationsData } = useAllOrganizations();
  const organizations = useMemo(
    () => organizationsData?.results ?? [],
    [organizationsData?.results],
  );
  const organizationsById = useMemo(
    () =>
      new Map<string, LightweightOrganization>(
        organizations.map((organization) => [String(organization.id), organization]),
      ),
    [organizations],
  );
  const compareByCoordinator = useMemo(
    () =>
      hasMetricFilterFlag(chart.filters, METRIC_FILTER_FLAG_COMPARE_BY_COORDINATOR),
    [chart.filters],
  );
  const compareByOrganization = useMemo(
    () =>
      hasMetricFilterFlag(chart.filters, METRIC_FILTER_FLAG_COMPARE_BY_ORGANIZATION),
    [chart.filters],
  );
  const compareByGroupingMode = useMemo<GroupingCompareMode | null>(() => {
    const legendField = String(chart.legend ?? "");
    if (compareByCoordinator) return "coordinator";
    if (compareByOrganization) return "organization";
    if (chart.indicators.length > 1) {
      if (legendField === "coordinator") return "coordinator";
      if (legendField === "organization" || legendField === "organization_id") return "organization";
    }
    return null;
  }, [chart.indicators.length, chart.legend, compareByCoordinator, compareByOrganization]);
  const compareByGrouping = compareByGroupingMode !== null;
  const trendIndicatorIds = usingDemoDashboard || hasLegacyChartData || compareByGrouping ? null : chart.indicators;
  const showTrendLine = useMemo(
    () => hasMetricFilterFlag(chart.filters, METRIC_FILTER_FLAG_APPLY_TREND_LINE),
    [chart.filters],
  );
  const filterGroups = useMemo(() => buildFilterGroups(chart, dashboardBreakdowns), [chart, dashboardBreakdowns]);

  useEffect(() => {
    setActiveFilters(groupChartFilters(chart.filters));
  }, [chart.filters]);
  useEffect(() => {
    const node = cardRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setCardWidth(entry.contentRect.width);
    });

    observer.observe(node);
    setCardWidth(node.getBoundingClientRect().width);

    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (chart.chart_type === "pie") return;
    setSelectedAxis(chart.axis === "month" ? "month" : "quarter");
  }, [chart.axis, chart.chart_type, chart.id]);
  useEffect(() => {
    setShowSupportingData(false);
  }, [chart.id]);
  useEffect(() => {
    setSelectedPeriod("all");
    setSelectedDate("");
    setSelectedCoordinator("all");
  }, [chart.id]);
  const effectiveAxis = chart.chart_type === "pie" ? null : selectedAxis;

  const primaryIndicatorId = chart.indicators.length === 1 ? chart.indicators[0] : null;
  const primaryIndicatorDisaggregationConfig = useMemo(
    () =>
      parseAggregateDisaggregationConfig(
        (primaryIndicator as { aggregate_disaggregation_config?: unknown } | undefined)
          ?.aggregate_disaggregation_config,
      ),
    [primaryIndicator],
  );
  const shouldLoadIndicatorAggregates = Boolean((primaryIndicatorId || compareByGrouping) && !usingDemoDashboard);
  const aggregateFilters = useMemo(
    () =>
      shouldLoadIndicatorAggregates
        ? {
            indicator: primaryIndicatorId ? String(primaryIndicatorId) : undefined,
            project: dashboard.project ? String(dashboard.project) : undefined,
            organization:
              !compareByGrouping && dashboard.organization
                ? String(dashboard.organization)
                : undefined,
            date_from: chart.start || undefined,
            date_to: chart.end || undefined,
            status: "approved",
          }
        : null,
    [
      chart.end,
      chart.start,
      compareByGrouping,
      dashboard.organization,
      dashboard.project,
      primaryIndicatorId,
      shouldLoadIndicatorAggregates,
    ],
  );
  const { data: loadedIndicatorAggregates = [] } = useAllAggregates(
    aggregateFilters,
    {
      shouldRetryOnError: false,
      revalidateOnFocus: false,
    },
  );
  const indicatorAggregates = useMemo(
    () => {
      const normalizedIndicatorSet = new Set(
        chart.indicators
          .map((indicatorId) => resolveIndicatorId(indicatorId))
          .filter((indicatorId) => Number.isFinite(indicatorId)),
      );
      return loadedIndicatorAggregates.filter((aggregate) =>
        normalizedIndicatorSet.has(resolveIndicatorId(aggregate.indicator)),
      );
    },
    [chart.indicators, loadedIndicatorAggregates],
  );
  const coordinatorOptions = useMemo<ChartFilterOption[]>(() => {
    const coordinatorLabels = new Set<string>();
    indicatorAggregates.forEach((aggregate) => {
      const label = resolveCoordinatorLabelByOrganizationId(
        String(aggregate.organization ?? ""),
        organizationsById,
      ).trim();
      if (label) coordinatorLabels.add(label);
    });
    return Array.from(coordinatorLabels)
      .sort((left, right) => left.localeCompare(right))
      .map((label) => ({
        value: label,
        label,
      }));
  }, [indicatorAggregates, organizationsById]);
  useEffect(() => {
    setSelectedCoordinator((current) => {
      if (current === "all") return current;
      return coordinatorOptions.some((option) => option.value === current) ? current : "all";
    });
  }, [coordinatorOptions]);
  const visibleActiveFilters = useMemo(
    () => removeReservedMetricFilterValues(activeFilters),
    [activeFilters],
  );
  const chartFiltersForRender = useMemo(() => {
    if (selectedCoordinator === "all") return visibleActiveFilters;
    return {
      ...visibleActiveFilters,
      coordinator: [selectedCoordinator],
    };
  }, [selectedCoordinator, visibleActiveFilters]);

  const { data: trendsBulk, isLoading, error } = useIndicatorTrendsBulk(
    trendIndicatorIds,
    {
      months: effectiveAxis === "quarter" ? 12 : 12,
      organizationId: dashboard.organization ?? null,
      projectId: dashboard.project ?? null,
      dateFrom: chart.start || undefined,
      dateTo: chart.end || undefined,
    },
    {
      shouldRetryOnError: false,
    },
  );

  const demoTrends = useMemo(
    () => (usingDemoDashboard ? buildDemoIndicatorTrendsBulk(chart.indicators, chart.indicator_details) : null),
    [chart.indicator_details, chart.indicators, usingDemoDashboard],
  );

  const chartSeries = useMemo<TrendSeries[]>(
    () => ((usingDemoDashboard ? demoTrends?.series : trendsBulk?.series) ?? []) as TrendSeries[],
    [demoTrends?.series, trendsBulk?.series, usingDemoDashboard],
  );
  const disaggregateAvailablePeriods = useMemo<string[]>(
    () => {
      if (!compareByGrouping || !effectiveAxis) return [];
      const periodLabels = indicatorAggregates
        .map((aggregate) => formatAggregatePeriodLabel(aggregate, effectiveAxis))
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0);
      return Array.from(new Set<string>(periodLabels)).sort((left, right) => sortPeriods(left, right, effectiveAxis));
    },
    [compareByGrouping, effectiveAxis, indicatorAggregates],
  );

  const legacyChart = useMemo(
    () => (hasLegacyChartData ? splitLegacyChartData(chart, dashboardBreakdowns, effectiveAxis) : null),
    [chart, dashboardBreakdowns, effectiveAxis, hasLegacyChartData],
  );
  const derivedDisaggregateChart = useMemo(
    () =>
      shouldLoadIndicatorAggregates && chart.indicators.length === 1
        ? buildDisaggregateChartFromAggregates({
            aggregates: indicatorAggregates,
            axis: effectiveAxis,
            optionLabels: primaryIndicator?.options,
            legend: chart.indicators.length > 1 ? "indicator" : chart.legend,
            stack: chart.stack,
            periodFilter: compareByGrouping && selectedPeriod !== "all" ? selectedPeriod : null,
            filters: chartFiltersForRender,
            disaggregationConfig: primaryIndicatorDisaggregationConfig,
            organizations,
            compareByMode: compareByGroupingMode ?? "period",
          })
        : null,
    [
      compareByGrouping,
      compareByGroupingMode,
      chartFiltersForRender,
      chart.indicators.length,
      chart.legend,
      selectedPeriod,
      chart.stack,
      effectiveAxis,
      indicatorAggregates,
      organizations,
      primaryIndicator?.options,
      primaryIndicatorDisaggregationConfig,
      shouldLoadIndicatorAggregates,
    ],
  );
  const derivedIndicatorComparisonChart = useMemo(
    () =>
      compareByGroupingMode &&
      chart.indicators.length > 1 &&
      indicatorAggregates.length > 0
        ? buildIndicatorComparisonChartFromAggregates({
            aggregates: indicatorAggregates,
            axis: effectiveAxis,
            periodFilter: selectedPeriod !== "all" ? selectedPeriod : null,
            filters: chartFiltersForRender,
            organizations,
            indicatorOrder: chart.indicators,
            indicatorDisplayNameById,
            compareByMode: compareByGroupingMode,
          })
        : null,
    [
      chart.indicators,
      chartFiltersForRender,
      compareByGroupingMode,
      effectiveAxis,
      indicatorAggregates,
      indicatorDisplayNameById,
      organizations,
      selectedPeriod,
    ],
  );
  const hasDerivedDisaggregateData = Boolean(
    (derivedIndicatorComparisonChart &&
      derivedIndicatorComparisonChart.keys.length > 0 &&
      derivedIndicatorComparisonChart.dataArray.length > 0) ||
      (derivedDisaggregateChart &&
        derivedDisaggregateChart.keys.length > 0 &&
        derivedDisaggregateChart.dataArray.length > 0),
  );
  const shouldPreferDerivedDisaggregate = Boolean(
    !derivedIndicatorComparisonChart &&
    hasDerivedDisaggregateData &&
      chart.indicators.length === 1 &&
      (derivedDisaggregateChart!.keys.length > 1 ||
        (primaryIndicatorDisaggregationConfig?.dimensions?.length ?? 0) > 0 ||
        Boolean(chart.legend)),
  );
  const effectiveLegacyLikeChart = shouldPreferDerivedDisaggregate
    ? derivedDisaggregateChart
    : derivedIndicatorComparisonChart
      ? derivedIndicatorComparisonChart
    : hasLegacyChartData
      ? legacyChart
      : hasDerivedDisaggregateData
        ? derivedDisaggregateChart
        : null;
  const derivedDisaggregateMatrix = useMemo(() => {
    if (!shouldLoadIndicatorAggregates || indicatorAggregates.length === 0) return null;

    const configuredDimensions = Array.isArray(primaryIndicatorDisaggregationConfig?.dimensions)
      ? primaryIndicatorDisaggregationConfig.dimensions
      : [];
    const firstDimension = normalizeOptionKey(
      String(configuredDimensions[0]?.key ?? configuredDimensions[0]?.label ?? chart.legend ?? "option"),
    );
    const secondDimension = normalizeOptionKey(
      String(configuredDimensions[1]?.key ?? configuredDimensions[1]?.label ?? "total"),
    );
    const thirdDimension = normalizeOptionKey(
      String(configuredDimensions[2]?.key ?? configuredDimensions[2]?.label ?? "age_range"),
    );
    const normalizedFilters = Object.entries(chartFiltersForRender).reduce<Record<string, Set<string>>>(
      (accumulator, [fieldName, values]) => {
        const normalizedField = normalizeOptionKey(fieldName);
        if (!normalizedField) return accumulator;
        const valueSet = new Set(values.map((value) => normalizeOptionKey(value)).filter(Boolean));
        if (valueSet.size > 0) accumulator[normalizedField] = valueSet;
        return accumulator;
      },
      {},
    );

    const facts: AnalyticsFact[] = [];
    indicatorAggregates.forEach((aggregate) => {
      const rows = getAggregateValueDisaggregateRows(aggregate.value);
      rows.forEach((row) => {
        const disaggregates: Record<string, string> = {
          [firstDimension || "option"]: row.first || "Unspecified",
          [secondDimension || "total"]: row.second || "Total",
          [thirdDimension || "age_range"]: row.third || "Total",
        };

        const passesFilters = Object.entries(normalizedFilters).every(([fieldName, selectedValues]) => {
          const value = disaggregates[fieldName];
          if (!value) return true;
          return selectedValues.has(normalizeOptionKey(value));
        });
        if (!passesFilters) return;

        facts.push({
          aggregateId: String(aggregate.id),
          organizationId: String(aggregate.organization),
          organizationName: aggregate.organization_name || dashboard.organization_name || `Org ${aggregate.organization}`,
          indicatorId: String(aggregate.indicator),
          indicatorName: getIndicatorChartLabel(
            {
              code: aggregate.indicator_code || primaryIndicator?.code,
              name: aggregate.indicator_name || primaryIndicator?.name,
              short_name: primaryIndicator?.short_name,
            },
            "Indicator",
          ),
          projectId: String(aggregate.project),
          periodLabel: formatAggregatePeriodLabel(aggregate, effectiveAxis),
          periodStart: aggregate.period_start,
          periodEnd: aggregate.period_end,
          value: row.value,
          disaggregates,
          notes: aggregate.notes || "",
        });
      });
    });

    if (facts.length === 0) return null;

    return buildConsolidatedMatrix({
      facts,
      rowDimensionKey: firstDimension || "option",
      columnDimensionKey: secondDimension || "total",
      rowValues: Array.isArray(configuredDimensions[0]?.values)
        ? configuredDimensions[0].values.map((value) => String(value))
        : undefined,
      columnValues:
        secondDimension && Array.isArray(configuredDimensions[1]?.values)
          ? configuredDimensions[1].values.map((value) => String(value))
          : ["Total"],
    });
  }, [
    chartFiltersForRender,
    chart.legend,
    dashboard.organization_name,
    effectiveAxis,
    indicatorAggregates,
    primaryIndicator?.code,
    primaryIndicator?.name,
    primaryIndicator?.short_name,
    primaryIndicatorDisaggregationConfig,
    shouldLoadIndicatorAggregates,
  ]);

  const rawChartData = useMemo<Array<Record<string, string | number>>>(() => {
    if (effectiveLegacyLikeChart) return effectiveLegacyLikeChart.dataArray ?? [];
    if (chartSeries.length === 0) return [];

    if (effectiveAxis === "quarter") {
      const quarterMap: Record<string, Record<string, string | number>> = {};

      chartSeries.forEach((series) => {
        series.data.forEach((item) => {
          const quarterLabel = getQuarterLabel(item.month);
          if (!quarterMap[quarterLabel]) {
            quarterMap[quarterLabel] = { period: quarterLabel };
          }

          const valueKey = `indicator_${series.indicator_id}`;
          const targetKey = `indicator_${series.indicator_id}_target`;
          const previousValue = Number(quarterMap[quarterLabel][valueKey] ?? 0);
          const previousTarget = Number(quarterMap[quarterLabel][targetKey] ?? 0);

          quarterMap[quarterLabel][valueKey] = previousValue + (item.value ?? 0);
          quarterMap[quarterLabel][targetKey] = previousTarget + (item.target ?? 0);
        });
      });

      return Object.values(quarterMap).sort((left, right) =>
        sortPeriods(String(left.period ?? ""), String(right.period ?? ""), "quarter"),
      );
    }

    const allPeriods = Array.from(new Set(chartSeries.flatMap((series) => series.data.map((item) => item.month)))).sort((left, right) =>
      sortPeriods(left, right, "month"),
    );

    return allPeriods.map((month) => {
      const row: Record<string, string | number> = { period: month };
      chartSeries.forEach((series) => {
        const point = series.data.find((item) => item.month === month);
        row[`indicator_${series.indicator_id}`] = point?.value ?? 0;
        row[`indicator_${series.indicator_id}_target`] = point?.target ?? 0;
      });
      return row;
    });
  }, [chartSeries, effectiveAxis, effectiveLegacyLikeChart]);
  const availablePeriods = useMemo<string[]>(
    () => {
      if (compareByGrouping) return disaggregateAvailablePeriods;
      return Array.from(
        new Set(
          rawChartData
            .map((row) => String(row.period ?? "").trim())
            .filter((period) => period.length > 0),
        ),
      ).sort((left, right) => sortPeriods(left, right, effectiveAxis ?? "month"));
    },
    [compareByGrouping, disaggregateAvailablePeriods, effectiveAxis, rawChartData],
  );

  useEffect(() => {
    setSelectedPeriod((current) => {
      if (current === "all") return current;
      return availablePeriods.includes(current) ? current : "all";
    });
  }, [availablePeriods]);

  useEffect(() => {
    if (!selectedDate || !effectiveAxis) return;
    const matchedPeriod = resolveDateToPeriodLabel(selectedDate, effectiveAxis, availablePeriods);
    setSelectedPeriod(matchedPeriod || "all");
  }, [availablePeriods, effectiveAxis, selectedDate]);

  const chartData = useMemo(
    () => {
      const filteredData = compareByGrouping
        ? rawChartData
        : selectedPeriod === "all"
          ? rawChartData
          : rawChartData.filter((row) => String(row.period ?? "").trim() === selectedPeriod);

      if (!chart.use_target) return filteredData;

      return filteredData.map((row) => {
        const targetValue = getChartRowTargetValue(row);
        if (targetValue === null) return row;
        if (typeof row.Target === "number" && Number.isFinite(row.Target)) return row;
        return { ...row, Target: targetValue };
      });
    },
    [chart.use_target, compareByGrouping, rawChartData, selectedPeriod],
  );


  const effectiveLegend = chart.indicators.length > 1 ? "indicator" : chart.legend;
  const savedFilterCount = useMemo(
    () => Object.values(visibleActiveFilters).reduce((total, values) => total + values.length, 0),
    [visibleActiveFilters],
  );
  const visibleFilterGroups = useMemo(() => filterGroups, [filterGroups]);

  useEffect(() => {
    setExpandedFilterGroups((previous) =>
      visibleFilterGroups.reduce<Record<string, boolean>>((next, group) => {
        next[group.name] = previous[group.name] ?? Boolean((activeFilters[group.name] ?? []).length);
        return next;
      }, {}),
    );
  }, [activeFilters, visibleFilterGroups]);

  const pieData = useMemo(
    () =>
      effectiveLegacyLikeChart
        ? (() => {
            const sourceRow = chartData[chartData.length - 1] ?? chartData[0] ?? {};
            return (effectiveLegacyLikeChart.keys ?? []).map((entry) => ({
              name: entry.label,
              value: Number(sourceRow[entry.key] ?? 0),
              key: entry.key,
            }));
          })()
        : chartSeries.map((series) => ({
            name:
              indicatorDisplayNameById.get(series.indicator_id) ||
              resolveChartIndicatorNameLabel(series.indicator_name, `Indicator ${series.indicator_id}`),
            value: series.data.reduce((sum, item) => sum + (item.value || 0), 0),
            key: `indicator_${series.indicator_id}`,
          })),
    [chartData, chartSeries, effectiveLegacyLikeChart, indicatorDisplayNameById],
  );
  const positivePieData = useMemo(
    () =>
      pieData
        .map((entry) => ({
          key: String(entry.key),
          name: String(entry.name),
          value: toSafeAggregateNumber(entry.value),
        }))
        .filter((entry) => entry.value > 0),
    [pieData],
  );
  const pieFallbackRows = useMemo<PieDisplayRow[]>(() => {
    if (!derivedDisaggregateMatrix || derivedDisaggregateMatrix.rowLabels.length === 0) return [];

    return derivedDisaggregateMatrix.rowLabels
      .map((rowLabel, index) => ({
        key: `matrix-row-${index}`,
        name: String(rowLabel),
        value: toSafeAggregateNumber(derivedDisaggregateMatrix.rowTotals[index] ?? 0),
      }))
      .filter((entry) => entry.value > 0)
      .sort((left, right) => right.value - left.value);
  }, [derivedDisaggregateMatrix]);
  const shouldUsePieFallbackBreakdown =
    chart.chart_type === "pie" &&
    positivePieData.length <= 1 &&
    pieFallbackRows.length > 1;
  const pieDisplayData = useMemo<PieDisplayRow[]>(() => {
    const source = shouldUsePieFallbackBreakdown ? pieFallbackRows : positivePieData;
    if (source.length <= 8) return source;

    const visibleRows = source.slice(0, 7);
    const otherTotal = source.slice(7).reduce((sum, row) => sum + row.value, 0);
    return otherTotal > 0
      ? [...visibleRows, { key: "other", name: "Other", value: otherTotal }]
      : visibleRows;
  }, [pieFallbackRows, positivePieData, shouldUsePieFallbackBreakdown]);
  const pieDisplayTotal = useMemo(
    () => pieDisplayData.reduce((sum, entry) => sum + entry.value, 0),
    [pieDisplayData],
  );
  const pieChartHeight = zoomedView ? 204 : 148;
  const pieLegendMaxHeight = zoomedView ? 204 : 148;
  const pieLegendColumnWidth = zoomedView ? 208 : 172;
  const pieInnerRadius = 0;
  const pieOuterRadius = zoomedView ? 84 : 66;

  const renderedSeries = useMemo<RenderedSeries[]>(
    () =>
      effectiveLegacyLikeChart
        ? (effectiveLegacyLikeChart.keys ?? [])
        : chartSeries.map((series) => ({
            key: `indicator_${series.indicator_id}`,
            label:
              indicatorDisplayNameById.get(series.indicator_id) ||
              resolveChartIndicatorNameLabel(series.indicator_name, `Indicator ${series.indicator_id}`),
          })),
    [chartSeries, effectiveLegacyLikeChart, indicatorDisplayNameById],
  );
  const hasTargetSeries = chart.use_target && chartData.some((row) => typeof row.Target === "number");
  const dataLoading = !hasLegacyChartData && !hasDerivedDisaggregateData && !usingDemoDashboard && isLoading;
  const dataError = !hasLegacyChartData && !hasDerivedDisaggregateData && !usingDemoDashboard ? error : null;
  const hasAutoDisaggregateSeries = hasDerivedDisaggregateData && renderedSeries.length > 1;
  const showPieLegendPrompt =
    chart.chart_type === "pie" &&
    !effectiveLegend &&
    chart.indicators.length <= 1 &&
    !hasAutoDisaggregateSeries;
  const isSocialMessageFigure =
    chart.chart_type === "bar" &&
    chart.indicators.length === 1 &&
    `${primaryIndicator?.name ?? ""} ${chart.display_name ?? ""} ${chart.name ?? ""}`
      .toLowerCase()
      .includes("engaged with ncd prevention and control messages through social media");
  const useSocialMessageStyle = isSocialMessageFigure && renderedSeries.length > 0;
  const usePresentationBarStyle = chart.chart_type === "bar" && renderedSeries.length > 0;
  const usePresentationLineStyle = chart.chart_type === "line" && renderedSeries.length > 0;
  const usePresentationTableStyle = usePresentationBarStyle || usePresentationLineStyle;
  const presentationYAxisWidth = usePresentationTableStyle ? (zoomedView ? 112 : 104) : 64;
  const presentationChartTopInset = zoomedView ? 18 : 14;
  const axisTickColor = useSocialMessageStyle || usePresentationTableStyle ? "#525252" : BONASO_COLORS.white;
  const chartPanelStyle = useSocialMessageStyle
    ? { backgroundColor: "#ececec", borderColor: "#c9c9c9" }
      : usePresentationTableStyle
        ? { backgroundColor: "#ffffff", borderColor: "#d1d5db" }
        : { backgroundColor: BONASO_COLORS.darkAccent, borderColor: "rgba(255,255,255,0.12)" };
  const presentationLegendItems = useMemo<PresentationLegendItem[]>(
    () =>
      renderedSeries.map((series, index) => {
        const match = series.key.match(/^indicator_(\d+)$/);
        const indicatorId = match ? Number(match[1]) : null;
        const normalizedSeriesLabel = normalizeOptionKey(series.label);
        const normalizedSeriesKey = normalizeOptionKey(series.key);
        const legendLabel =
          (indicatorId !== null ? indicatorShortNameById.get(indicatorId) : null) ||
          (normalizedSeriesLabel ? indicatorLegendLabelLookup.get(normalizedSeriesLabel) : null) ||
          (normalizedSeriesKey ? indicatorLegendLabelLookup.get(normalizedSeriesKey) : null) ||
          series.label;
        const total = chartData.reduce(
          (sum, row) => sum + (readFiniteChartNumber(row[series.key]) ?? 0),
          0,
        );

        return {
          key: series.key,
          label: legendLabel,
          color: useSocialMessageStyle
            ? getSocialMessageChartColor(series.label, index)
            : usePresentationTableStyle
              ? getPresentationChartColor(index)
              : getLegacyChartColor(index),
          total,
        };
      }),
    [chartData, indicatorLegendLabelLookup, indicatorShortNameById, renderedSeries, usePresentationTableStyle, useSocialMessageStyle],
  );
  const trendLineSeries = useMemo(
    () => {
      if (!showTrendLine || chart.chart_type !== "line" || chartData.length < 2) return [];

      return renderedSeries
        .map((series, index) => {
          const seriesValues = chartData.map((row) => readFiniteChartNumber(row[series.key]));
          const trendModel = buildLinearTrendPoints(seriesValues);
          if (!trendModel) return null;

          const trendKey = `${series.key}__trend`;
          const trendValues = chartData.map((_, pointIndex) => trendModel.slope * pointIndex + trendModel.intercept);
          return {
            dataKey: trendKey,
            name: `${series.label} trend`,
            stroke: usePresentationLineStyle ? getPresentationChartColor(index) : getLegacyChartColor(index),
            values: trendValues,
          };
        })
        .filter((series): series is { dataKey: string; name: string; stroke: string; values: number[] } => series !== null);
    },
    [chart.chart_type, chartData, renderedSeries, showTrendLine, usePresentationLineStyle],
  );
  const chartDataForRender = useMemo(() => {
    if (trendLineSeries.length === 0) return chartData;

    return chartData.map((row, rowIndex) => {
      const nextRow: Record<string, string | number> = { ...row };
      trendLineSeries.forEach((series) => {
        nextRow[series.dataKey] = series.values[rowIndex] ?? 0;
      });
      return nextRow;
    });
  }, [chartData, trendLineSeries]);

  const chartTableColumns = useMemo(
    () =>
      chartData.map((row) => {
        const period = String(row.period ?? "-");
        return isSocialMessageFigure ? formatQuarterLabelNoSpace(period) : period;
      }),
    [chartData, isSocialMessageFigure],
  );
  const chartTableRows = useMemo<ChartTableRow[]>(() => {
    const rows = renderedSeries.map((series, index) => ({
      key: series.key,
      label: useSocialMessageStyle ? normalizeSeriesKeyLabel(series.label) : series.label,
      color: useSocialMessageStyle
        ? getSocialMessageChartColor(series.label, index)
        : usePresentationTableStyle
          ? getPresentationChartColor(index)
          : getLegacyChartColor(index),
      values: chartData.map((row) => {
        const value = row[series.key];
        return typeof value === "number" || typeof value === "string" ? value : 0;
      }),
    }));

    if (hasTargetSeries) {
      rows.push({
        key: "Target",
        label: "Target",
        color: BONASO_COLORS.target,
        values: chartData.map((row) => {
          const value = row.Target;
          return typeof value === "number" || typeof value === "string" ? value : 0;
        }),
      });
    }

    return rows;
  }, [chartData, hasTargetSeries, renderedSeries, usePresentationTableStyle, useSocialMessageStyle]);
  const chartTableLeadingColumnLabel = useMemo(() => {
    if (chart.indicators.length > 1) return "Indicator";
    if (compareByGroupingMode === "coordinator") return "Coordinator";
    if (compareByGroupingMode === "organization") return "Organization";
    return isSocialMessageFigure ? " " : "Series";
  }, [chart.indicators.length, compareByGroupingMode, isSocialMessageFigure]);
  const useSinglePeriodComparisonLayout =
    usePresentationBarStyle &&
    !useSocialMessageStyle &&
    chartData.length === 1 &&
    renderedSeries.length > 1;
  const singlePeriodLabel = useSinglePeriodComparisonLayout ? String(chartData[0]?.period ?? "-") : null;
  const singlePeriodTarget = useSinglePeriodComparisonLayout
    ? (() => {
        const targetValue = chartData[0]?.Target;
        return typeof targetValue === "number" && Number.isFinite(targetValue) ? targetValue : null;
      })()
    : null;
  const singlePeriodComparisonRows = useMemo<SinglePeriodComparisonRow[]>(() => {
    if (!useSinglePeriodComparisonLayout) return [];

    const rows = renderedSeries
      .map((series, index) => {
        const value = chartData[0]?.[series.key];
        const numericValue =
          typeof value === "number"
            ? value
            : typeof value === "string"
              ? Number(value.replaceAll(",", ""))
              : 0;

        return {
          key: series.key,
          label: series.label,
          value: Number.isFinite(numericValue) ? numericValue : 0,
          color: getPresentationChartColor(index),
          share: 0,
        };
      })
      .sort((left, right) => right.value - left.value);

    const total = rows.reduce((sum, row) => sum + row.value, 0);
    return rows.map((row) => ({
      ...row,
      share: total > 0 ? (row.value / total) * 100 : 0,
    }));
  }, [chartData, renderedSeries, useSinglePeriodComparisonLayout]);
  const singlePeriodTotal = useMemo(
    () => singlePeriodComparisonRows.reduce((sum, row) => sum + row.value, 0),
    [singlePeriodComparisonRows],
  );
  const singlePeriodTopRow = singlePeriodComparisonRows[0] ?? null;
  const singlePeriodLayout = useMemo(() => getSinglePeriodLayoutConfig(cardWidth), [cardWidth]);
  const singlePeriodPerformancePercent =
    singlePeriodTarget && singlePeriodTarget > 0 ? (singlePeriodTotal / singlePeriodTarget) * 100 : null;
  const largestContributorSummary = singlePeriodTopRow
    ? `${singlePeriodTopRow.label} (${formatChartNumber(singlePeriodTopRow.value)})`
    : "-";

  const biologicalFigureSourceRows = useMemo(
    () => (chart.chart_type === "bar" ? parseBiologicalFigureRows(chart.chart_data) : []),
    [chart.chart_data, chart.chart_type],
  );
  const isBiologicalFigure = biologicalFigureSourceRows.length > 0;
  const biologicalAxis = effectiveAxis === "month" ? "month" : "quarter";
  const biologicalFigurePeriodLabel = useMemo(() => {
    const periods = Array.from(
      new Set(
        biologicalFigureSourceRows.map((row) =>
          normalizeBiologicalPeriod(row.period, biologicalAxis),
        ),
      ),
    );
    if (periods.length === 0) {
      return biologicalAxis === "month" ? "Current Month" : "Current Quarter";
    }
    periods.sort((left, right) => sortPeriods(left, right, biologicalAxis));
    return periods[periods.length - 1];
  }, [biologicalAxis, biologicalFigureSourceRows]);
  const biologicalFigureRows = useMemo(() => {
    const grouped = new Map<string, BiologicalFigureRow>();

    biologicalFigureSourceRows.forEach((row) => {
      const normalizedPeriod = normalizeBiologicalPeriod(row.period, biologicalAxis);
      if (normalizedPeriod !== biologicalFigurePeriodLabel) return;

      const key = `${row.factor}__${row.sex}`;
      const existing = grouped.get(key);
      if (existing) {
        existing.screened += row.screened;
        existing.referred += row.referred;
        return;
      }
      grouped.set(key, {
        factor: row.factor,
        sex: row.sex,
        screened: row.screened,
        referred: row.referred,
        period: normalizedPeriod,
      });
    });

    return BIOLOGICAL_FACTOR_SEQUENCE.flatMap((factor) =>
      (["Female", "Male"] as const).map((sex) => {
        const item = grouped.get(`${factor}__${sex}`);
        return {
          factor,
          sex,
          screened: item?.screened ?? 0,
          referred: item?.referred ?? 0,
          period: biologicalFigurePeriodLabel,
        } satisfies BiologicalFigureRow;
      }),
    );
  }, [biologicalAxis, biologicalFigurePeriodLabel, biologicalFigureSourceRows]);
  const biologicalFigureSeriesValues = useMemo(
    () => ({
      screened: biologicalFigureRows.map((row) => row.screened),
      referred: biologicalFigureRows.map((row) => row.referred),
    }),
    [biologicalFigureRows],
  );

  const chartTitle =
    (isBiologicalFigure
      ? "Figure 16.1: Number of People Screened for Biological NCDs Risk Factors (Blood Glucose, Blood Pressure (BP), Body Mass Index (BMI), and Waist Circumference)"
      : chart.display_name) ||
    chart.name ||
    (chart.indicator_details?.length === 1
      ? `Tracking ${
          indicatorDisplayNameById.get(chart.indicator_details[0]?.id ?? -1) ||
          chart.indicator_details[0]?.name ||
          "indicator"
        }`
      : `Tracking ${chart.indicators.length} indicators`);
  const chartSubtitle = useMemo(() => {
    const projectLabel =
      dashboard.project_name ||
      (dashboard.project ? `Project ${dashboard.project}` : "All Projects");
    const periodLabel = (() => {
      if (selectedDate) {
        const formattedSelectedDate = formatDate(selectedDate);
        return formattedSelectedDate !== "—" ? formattedSelectedDate : selectedDate;
      }
      if (selectedPeriod !== "all") return selectedPeriod;
      if (chart.start && chart.end) {
        const formattedStart = formatDate(chart.start);
        const formattedEnd = formatDate(chart.end);
        if (formattedStart !== "—" && formattedEnd !== "—") {
          return `${formattedStart} - ${formattedEnd}`;
        }
      }
      if (chart.chart_type === "pie") return "All Periods";
      if (effectiveAxis === "month") return "All Months";
      if (effectiveAxis === "quarter") return "All Quarters";
      return "All Periods";
    })();
    const scopeLabel = (() => {
      if (compareByGroupingMode === "coordinator") {
        return selectedCoordinator === "all" ? "All Coordinators" : selectedCoordinator;
      }
      if (dashboard.organization_name) {
        return dashboard.cascade_organization
          ? `${dashboard.organization_name} + Subgrantees`
          : dashboard.organization_name;
      }
      if (compareByGroupingMode === "organization") return "All Organizations";
      return "All Parent Organizations";
    })();

    return [projectLabel, periodLabel, scopeLabel].filter(Boolean).join(" • ");
  }, [
    chart.chart_type,
    chart.end,
    chart.start,
    compareByGroupingMode,
    dashboard.cascade_organization,
    dashboard.organization_name,
    dashboard.project,
    dashboard.project_name,
    effectiveAxis,
    selectedCoordinator,
    selectedDate,
    selectedPeriod,
  ]);
  const hasRenderableData = isBiologicalFigure || chartData.length > 0 || pieDisplayData.length > 0;
  const hasExportableTabularData =
    isBiologicalFigure ||
    (chartTableRows.length > 0 && chartTableColumns.length > 0) ||
    chartData.length > 0 ||
    pieDisplayData.length > 0;
  const hasBiologicalSupportingTable = isBiologicalFigure && biologicalFigureRows.length > 0;
  const shouldUseChartDataSupportingTable =
    Boolean(compareByGroupingMode) && chart.indicators.length > 1;
  const hasDisaggregateMatrix =
    !dataLoading &&
    !dataError &&
    !shouldUseChartDataSupportingTable &&
    Boolean(
      derivedDisaggregateMatrix &&
        derivedDisaggregateMatrix.rowLabels.length > 0 &&
        derivedDisaggregateMatrix.columnLabels.length > 0,
    );
  const hasPresentationSupportingTable =
    !dataLoading &&
    !dataError &&
    (isSocialMessageFigure || chart.tabular) &&
    (!derivedDisaggregateMatrix || shouldUseChartDataSupportingTable) &&
    !isBiologicalFigure &&
    chartData.length > 0 &&
    usePresentationTableStyle &&
    chartTableRows.length > 0;
  const hasLegacySupportingTable =
    !dataLoading &&
    !dataError &&
    chart.tabular &&
    !derivedDisaggregateMatrix &&
    !isSocialMessageFigure &&
    !isBiologicalFigure &&
    chartData.length > 0 &&
    !usePresentationBarStyle;
  const hasSupportingDataSection =
    hasBiologicalSupportingTable ||
    hasDisaggregateMatrix ||
    hasPresentationSupportingTable ||
    hasLegacySupportingTable;
  const supportsBarRotation = chart.chart_type === "bar" && !isBiologicalFigure;
  const regularHorizontalBarHeight = useMemo(() => {
    if (useSinglePeriodComparisonLayout) return 0;
    const seriesCount = renderedSeries.length + (hasTargetSeries ? 1 : 0);
    const rowHeight = Math.max(40, seriesCount * 18 + 16);
    return Math.min(520, Math.max(200, chartData.length * rowHeight + 24));
  }, [chartData.length, hasTargetSeries, renderedSeries.length, useSinglePeriodComparisonLayout]);
  const regularHorizontalBarLabelWidth = cardWidth > 0 && cardWidth < 760 ? 88 : 116;
  const groupedBarTickMaxCharsPerLine =
    cardWidth > 0 && cardWidth < 760 ? (zoomedView ? 12 : 10) : zoomedView ? 18 : 14;
  const groupedBarTickLineHeight = 12;
  const groupedBarMaxLabelLines = useMemo(
    () =>
      Math.max(
        1,
        ...chartData.map((row) =>
          wrapChartLabel(String(row.period ?? ""), groupedBarTickMaxCharsPerLine).length,
        ),
      ),
    [chartData, groupedBarTickMaxCharsPerLine],
  );
  const groupedBarXAxisHeight =
    compareByGroupingMode
      ? Math.max(52, groupedBarMaxLabelLines * groupedBarTickLineHeight + 20)
      : 30;
  const singlePeriodVerticalTickAngle = zoomedView ? -32 : -26;
  const singlePeriodVerticalTickLineHeight = 12;
  const singlePeriodVerticalMaxCharsPerLine =
    cardWidth > 0 && cardWidth < 760 ? (zoomedView ? 16 : 12) : zoomedView ? 24 : 18;
  const singlePeriodVerticalMaxLabelLines = useMemo(
    () =>
      Math.max(
        1,
        ...singlePeriodComparisonRows.map(
          (row) => wrapChartLabel(String(row.label ?? ""), singlePeriodVerticalMaxCharsPerLine).length,
        ),
      ),
    [singlePeriodComparisonRows, singlePeriodVerticalMaxCharsPerLine],
  );
  const singlePeriodVerticalXAxisHeight = Math.max(
    zoomedView ? 130 : 96,
    singlePeriodVerticalMaxLabelLines * singlePeriodVerticalTickLineHeight + (zoomedView ? 34 : 28),
  );
  const singlePeriodVerticalBottomMargin = Math.min(
    48,
    Math.max(24, Math.round(singlePeriodVerticalMaxLabelLines * 2.5 + (zoomedView ? 20 : 14))),
  );
  const chartFrameMaxWidth = zoomedView ? 980 : 720;
  const singlePeriodVerticalHeight = Math.min(
    zoomedView ? 420 : 320,
    Math.max(
      zoomedView ? 300 : 240,
      singlePeriodVerticalXAxisHeight + singlePeriodVerticalBottomMargin + (zoomedView ? 190 : 150),
    ),
  );
  const singlePeriodHorizontalHeight = getSinglePeriodComparisonHeight(singlePeriodComparisonRows, singlePeriodLayout) + (zoomedView ? 120 : 0);
  const standardChartHeight =
    chart.chart_type === "bar" && barOrientation === "horizontal"
      ? regularHorizontalBarHeight + (zoomedView ? 80 : 0)
      : zoomedView
        ? 320
        : useSocialMessageStyle || usePresentationTableStyle
          ? 172
          : 138;

  useEffect(() => {
    if (!supportsBarRotation) return;
    setBarOrientation(useSinglePeriodComparisonLayout ? "horizontal" : "vertical");
  }, [chart.id, supportsBarRotation, useSinglePeriodComparisonLayout]);

  const baseExportName = useMemo(
    () => chartTitle.replace(/[^a-z0-9_-]+/gi, "_").slice(0, 80) || "chart",
    [chartTitle],
  );

  const downloadChartImage = async () => {
    if (!cardRef.current || downloadInFlightRef.current) return;

    downloadInFlightRef.current = true;
    try {
      const { blob, extension } = await renderElementToBlob(cardRef.current);
      triggerBlobDownload(blob, `${baseExportName}.${extension}`);
      if (extension === "svg") {
        toast({
          title: "Downloaded as SVG",
          description:
            "PNG export was blocked by browser security for external resources.",
        });
      }
    } catch (errorCaught) {
      console.error("Failed to download chart card", errorCaught);
      toast({
        title: "Download failed",
        description: "Unable to download this card as shown right now.",
        variant: "destructive",
      });
    } finally {
      downloadInFlightRef.current = false;
    }
  };

  const downloadChartExcel = async () => {
    if (downloadInFlightRef.current || !hasExportableTabularData) return;

    downloadInFlightRef.current = true;
    try {
      const workbook = XLSX.utils.book_new();

      const metadataRows: ExcelRow[] = [
        ["Title", chartTitle],
        ["Chart Type", chart.chart_type],
        ["Axis", effectiveAxis ?? "N/A"],
        ["Generated At", new Date().toISOString()],
      ];
      appendWorksheetFromRows(workbook, "Metadata", metadataRows, "Metadata");

      if (isBiologicalFigure) {
        const biologicalHeaders = BIOLOGICAL_FACTOR_SEQUENCE.flatMap((factor) => [
          `${BIOLOGICAL_FACTOR_HEADERS[factor]} Female`,
          `${BIOLOGICAL_FACTOR_HEADERS[factor]} Male`,
        ]);
        const figureTableRows: ExcelRow[] = [
          ["Series", ...biologicalHeaders],
          ["Period", ...biologicalHeaders.map(() => biologicalFigurePeriodLabel)],
          ["Screened for Biological NCD Risk Factors", ...biologicalFigureSeriesValues.screened],
          ["Referred for Biological NCD Risk Factors", ...biologicalFigureSeriesValues.referred],
        ];
        appendWorksheetFromRows(workbook, "Report Table", figureTableRows, "Report Table");

        const biologicalDataRows: ExcelRow[] = [
          ["Factor", "Sex", "Period", "Screened for Biological NCD Risk Factors", "Referred for Biological NCD Risk Factors"],
          ...biologicalFigureRows.map((row) => [row.factor, row.sex, row.period ?? biologicalFigurePeriodLabel, row.screened, row.referred]),
        ];
        appendWorksheetFromRows(workbook, "Biological Data", biologicalDataRows, "Biological Data");
      } else if (chartTableRows.length > 0 && chartTableColumns.length > 0) {
        const tableRows: ExcelRow[] = [
          [chartTableLeadingColumnLabel, ...chartTableColumns],
          ...chartTableRows.map((row) => [row.label, ...row.values.map((value) => toExcelCellValue(value))]),
        ];
        appendWorksheetFromRows(workbook, "Report Table", tableRows, "Report Table");
      } else if (pieDisplayData.length > 0) {
        const pieRows: ExcelRow[] = [["Series", "Value"], ...pieDisplayData.map((row) => [row.name, toExcelCellValue(row.value)])];
        appendWorksheetFromRows(workbook, "Report Table", pieRows, "Report Table");
      }

      if (chartData.length > 0) {
        const headers = Object.keys(chartData[0]);
        const rawRows: ExcelRow[] = [
          headers,
          ...chartData.map((row) => headers.map((header) => toExcelCellValue(row[header]))),
        ];
        appendWorksheetFromRows(workbook, "Raw Data", rawRows, "Raw Data");
      }

      if (workbook.SheetNames.length === 0) {
        throw new Error("No chart data available to export.");
      }

      const workbookArray = XLSX.write(workbook, {
        bookType: "xlsx",
        type: "array",
        compression: true,
      }) as ArrayBuffer;
      const blob = new Blob([workbookArray], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      triggerBlobDownload(blob, `${baseExportName}.xlsx`);
      toast({
        title: "Excel downloaded",
        description: "Chart data was exported as an Excel workbook.",
      });
    } catch (errorCaught) {
      console.error("Failed to download chart workbook", errorCaught);
      toast({
        title: "Excel download failed",
        description: "Unable to export this chart to Excel right now.",
        variant: "destructive",
      });
    } finally {
      downloadInFlightRef.current = false;
    }
  };

  const handleDelete = async () => {
    setRemoving(true);
    try {
      await onDelete(chart);
    } catch (errorCaught) {
      console.error("Failed to delete chart", errorCaught);
      toast({
        title: "Delete failed",
        description: "Unable to remove this chart from the dashboard.",
        variant: "destructive",
      });
    } finally {
      setRemoving(false);
    }
  };

  const persistFilters = async (nextFilters: Record<string, string[]>, rollbackFilters: Record<string, string[]>) => {
    if (!chart.id || usingDemoDashboard) return;

    setSavingFilters(true);
    try {
      await dashboardSettingsService.updateChartFilters(dashboard.id, chart.id, nextFilters);
      await onRefresh();
    } catch (errorCaught) {
      console.error("Failed to update chart filters", errorCaught);
      setActiveFilters(rollbackFilters);
      toast({
        title: "Filter update failed",
        description: "Unable to save those chart filters right now.",
        variant: "destructive",
      });
    } finally {
      setSavingFilters(false);
    }
  };

  const handleToggleFilterValue = async (fieldName: string, value: string) => {
    if (!chart.id || usingDemoDashboard || savingFilters) return;

    const previousFilters = activeFilters;
    const currentValues = previousFilters[fieldName] ?? [];
    const nextValues = currentValues.includes(value)
      ? currentValues.filter((item) => item !== value)
      : [...currentValues, value];
    const nextFilters = sanitizeFilterGroups({
      ...previousFilters,
      [fieldName]: nextValues,
    });

    setActiveFilters(nextFilters);
    await persistFilters(nextFilters, previousFilters);
  };

  const handleClearFilters = async () => {
    if (!chart.id || usingDemoDashboard || savingFilters || savedFilterCount === 0) return;

    const previousFilters = activeFilters;
    const reservedMetricValues = getReservedMetricFilterValues(previousFilters);
    const nextFilters =
      reservedMetricValues.length > 0
        ? {
            metric: reservedMetricValues,
          }
        : {};
    setActiveFilters(nextFilters);
    await persistFilters(nextFilters, previousFilters);
  };

  const toggleFilterGroup = (groupName: string) => {
    setExpandedFilterGroups((previous) => ({
      ...previous,
      [groupName]: !previous[groupName],
    }));
  };

  const handleDatePeriodSelect = (value: string) => {
    setSelectedDate(value);
    if (!value || !effectiveAxis) {
      setSelectedPeriod("all");
      return;
    }
    const matchedPeriod = resolveDateToPeriodLabel(value, effectiveAxis, availablePeriods);
    setSelectedPeriod(matchedPeriod || "all");
  };
  const latestAvailablePeriod = availablePeriods[availablePeriods.length - 1] ?? null;
  const selectedPeriodIndex = selectedPeriod === "all" ? -1 : availablePeriods.indexOf(selectedPeriod);
  const canSelectPreviousPeriod = selectedPeriodIndex > 0;
  const canSelectNextPeriod = selectedPeriodIndex >= 0 && selectedPeriodIndex < availablePeriods.length - 1;

  const handleStepPeriod = (step: -1 | 1) => {
    if (selectedPeriodIndex < 0) return;
    const nextIndex = selectedPeriodIndex + step;
    if (nextIndex < 0 || nextIndex >= availablePeriods.length) return;
    setSelectedDate("");
    setSelectedPeriod(availablePeriods[nextIndex]);
  };

  return (
    <>
    <div ref={cardRef} className={zoomedView ? "w-full" : undefined}>
      <Card
        className={
          zoomedView
            ? "w-full overflow-hidden border-[#d7dee8] bg-[#fcfdff] text-card-foreground shadow-[0_20px_48px_rgba(15,23,42,0.14)]"
            : "w-full overflow-hidden border-[#d7dee8] bg-[#fcfdff] text-card-foreground shadow-[0_14px_36px_rgba(15,23,42,0.07)] hover:shadow-[0_18px_42px_rgba(15,23,42,0.10)]"
        }
      >
      <div className="h-2 w-full bg-[linear-gradient(90deg,#2f73b8_0%,#7eaad6_55%,#d7e5f4_100%)]" />
      <CardHeader className="border-b border-[#e5eaf1] bg-[#f8fbff] px-4 py-4">
        <ChartHeader
          title={chartTitle}
          subtitle={chartSubtitle}
          rightContent={
            <div className="flex flex-wrap gap-1.5">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="border-[#cfd8e3] bg-white text-[#334155] hover:bg-[#f8fafc] hover:text-[#0f172a]"
                  disabled={removing}
                >
                  <Menu className="h-4 w-4" />
                  <span className="sr-only">Chart actions</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                {chart.chart_type !== "pie" ? (
                  <>
                    <DropdownMenuItem
                      onClick={() => {
                        setSelectedAxis("quarter");
                        setSelectedDate("");
                        setSelectedPeriod("all");
                      }}
                      disabled={selectedAxis === "quarter"}
                    >
                      Quarter view
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => {
                        setSelectedAxis("month");
                        setSelectedDate("");
                        setSelectedPeriod("all");
                      }}
                      disabled={selectedAxis === "month"}
                    >
                      Month view
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => {
                        if (!latestAvailablePeriod) return;
                        setSelectedDate("");
                        setSelectedPeriod(latestAvailablePeriod);
                      }}
                      disabled={!latestAvailablePeriod}
                    >
                      Latest period
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleStepPeriod(-1)} disabled={!canSelectPreviousPeriod}>
                      Previous period
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleStepPeriod(1)} disabled={!canSelectNextPeriod}>
                      Next period
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => {
                        setSelectedDate("");
                        setSelectedPeriod("all");
                      }}
                      disabled={selectedPeriod === "all" && !selectedDate}
                    >
                      All periods
                    </DropdownMenuItem>
                  </>
                ) : null}
                {supportsBarRotation ? (
                  <DropdownMenuItem
                    onClick={() => setBarOrientation((current) => (current === "vertical" ? "horizontal" : "vertical"))}
                  >
                    <RotateCw className="h-4 w-4" />
                    {barOrientation === "vertical" ? "Horizontal" : "Vertical"}
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem onClick={() => onEdit(chart)}>
                  <Settings className="h-4 w-4" />
                  Settings
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setZoomOpen(true)} disabled={!zoomable}>
                  <Maximize2 className="h-4 w-4" />
                  Zoom
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => void downloadChartImage()} disabled={!hasRenderableData}>
                  <FileImage className="h-4 w-4" />
                  Download image
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => void downloadChartExcel()} disabled={!hasExportableTabularData}>
                  <FileSpreadsheet className="h-4 w-4" />
                  Download Excel (.xlsx)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleDelete} disabled={removing} variant="destructive">
                  {removing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {chart.chart_type !== "pie" ? (
              <div className="inline-flex rounded-md border border-[#cfd8e3] bg-white p-0.5">
                {(["quarter", "month"] as const).map((axisOption) => {
                  const active = selectedAxis === axisOption;
                  return (
                    <button
                      key={axisOption}
                      type="button"
                      onClick={() => setSelectedAxis(axisOption)}
                      className="rounded-[5px] px-2.5 py-1 text-[11px] font-semibold transition-colors"
                      style={{
                        backgroundColor: active ? "#2f73b8" : "transparent",
                        color: active ? "#ffffff" : "#475569",
                      }}
                    >
                      {axisOption === "quarter" ? "Quarter" : "Month"}
                    </button>
                  );
                })}
              </div>
            ) : null}
            {chart.chart_type !== "pie" && availablePeriods.length > 0 ? (
              <Select
                value={selectedPeriod}
                onValueChange={(value) => {
                  setSelectedPeriod(value);
                  setSelectedDate("");
                }}
              >
                <SelectTrigger className="h-9 min-w-[11.5rem] border-[#cfd8e3] bg-white text-xs font-medium text-[#334155]">
                  <SelectValue placeholder={effectiveAxis === "quarter" ? "All quarters" : "All months"} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All {effectiveAxis === "quarter" ? "quarters" : "months"}</SelectItem>
                  {availablePeriods.map((period) => (
                    <SelectItem key={period} value={period}>
                      {period}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
            {chart.chart_type !== "pie" ? (
              <Input
                type="date"
                value={selectedDate}
                onChange={(event) => handleDatePeriodSelect(event.target.value)}
                className="h-9 w-[9.75rem] border-[#cfd8e3] bg-white text-xs text-[#334155]"
                aria-label="Select specific date"
              />
            ) : null}
            {chart.chart_type !== "pie" && compareByGroupingMode === "coordinator" && coordinatorOptions.length > 0 ? (
              <Select value={selectedCoordinator} onValueChange={setSelectedCoordinator}>
                <SelectTrigger className="h-9 min-w-[12rem] border-[#cfd8e3] bg-white text-xs font-medium text-[#334155]">
                  <SelectValue placeholder="All coordinators" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All coordinators</SelectItem>
                  {coordinatorOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
            </div>
          }
        />
      </CardHeader>

      <CardContent className="space-y-3 bg-[#fcfdff] p-4">
        {dataLoading ? (
          <div
            className="flex h-[112px] items-center justify-center rounded-[1rem] border"
            style={{ backgroundColor: BONASO_COLORS.darkAccent, borderColor: "rgba(255,255,255,0.12)" }}
          >
            <Loader2 className="h-5 w-5 animate-spin" style={{ color: BONASO_COLORS.uberLightAccent }} />
          </div>
        ) : null}

        {!dataLoading && dataError ? (
          <div
            className="flex h-[112px] items-center justify-center rounded-[1rem] border border-dashed text-sm"
            style={{
              backgroundColor: BONASO_COLORS.darkAccent,
              borderColor: "rgba(255,255,255,0.16)",
              color: "rgba(255,255,255,0.72)",
            }}
          >
            Unable to load chart data.
          </div>
        ) : null}

        {!dataLoading && !dataError && isBiologicalFigure ? (
          <div ref={chartRef} className="space-y-3 rounded-[1rem] border p-3" style={{ backgroundColor: "#f2f2f2", borderColor: "#c6c6c6" }}>
            <div className="w-full" style={{ maxWidth: `${chartFrameMaxWidth}px` }}>
              <ResponsiveContainer width="100%" height={zoomedView ? 240 : 132}>
                <BarChart data={biologicalFigureRows} margin={{ top: 12, right: 18, left: 24, bottom: 8 }}>
                  <CartesianGrid vertical={false} stroke="#d1d5db" />
                  <XAxis dataKey="sex" tick={{ fill: "#5b5b5b", fontSize: 12 }} tickLine={false} axisLine={false} />
                  <YAxis
                    tick={{ fill: "#5b5b5b", fontSize: 12 }}
                    tickLine={false}
                    axisLine={false}
                    label={{ value: "No. Of People", angle: -90, position: "insideLeft", fill: "#525252", style: { fontSize: 13 } }}
                  />
                  <RechartsTooltip shared={false} content={<LegacyTooltip presentation />} cursor={{ fill: "rgba(15, 23, 42, 0.04)" }} />
                  <Bar dataKey="screened" name="Screened for Biological NCD Risk Factors" fill="#1f6b8b" radius={[3, 3, 0, 0]} maxBarSize={24} />
                  <Bar dataKey="referred" name="Referred for Biological NCD Risk Factors" fill="#ed7d31" radius={[3, 3, 0, 0]} maxBarSize={24} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {showSupportingData ? (
              <div className="overflow-x-auto rounded-md border border-[#c6c6c6] bg-[#f2f2f2]">
                <table className="min-w-full border-collapse text-sm text-[#5b5b5b]">
                  <thead>
                    <tr>
                      <th className="border border-[#c6c6c6] px-2 py-2 text-left font-medium"> </th>
                      {BIOLOGICAL_FACTOR_SEQUENCE.map((factor) => (
                        <th key={factor} className="border border-[#c6c6c6] px-2 py-2 text-center font-medium" colSpan={2}>
                          {BIOLOGICAL_FACTOR_HEADERS[factor].split(" ").map((word, index) => (
                            <span key={`${factor}-${word}-${index}`} className="inline-block mr-1 last:mr-0">{word}</span>
                          ))}
                        </th>
                      ))}
                    </tr>
                    <tr>
                      <th className="border border-[#c6c6c6] px-2 py-2 text-left font-medium"> </th>
                      {BIOLOGICAL_FACTOR_SEQUENCE.flatMap((factor) => ([
                        <th key={`${factor}-female`} className="border border-[#c6c6c6] px-3 py-1 text-center font-normal">Female</th>,
                        <th key={`${factor}-male`} className="border border-[#c6c6c6] px-3 py-1 text-center font-normal">Male</th>,
                      ]))}
                    </tr>
                    <tr>
                      <th className="border border-[#c6c6c6] px-2 py-1 text-left font-medium"> </th>
                      <th className="border border-[#c6c6c6] px-2 py-1 text-center font-medium" colSpan={BIOLOGICAL_FACTOR_SEQUENCE.length * 2}>{biologicalFigurePeriodLabel}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="border border-[#c6c6c6] px-2 py-1">
                        <span className="inline-flex items-center gap-2">
                          <span className="h-2.5 w-2.5 bg-[#1f6b8b]" />
                          Screened for Biological NCD Risk Factors
                        </span>
                      </td>
                      {biologicalFigureSeriesValues.screened.map((value, index) => (
                        <td key={`screened-${index}`} className="border border-[#c6c6c6] px-2 py-1 text-center tabular-nums">
                          {formatChartNumber(value)}
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <td className="border border-[#c6c6c6] px-2 py-1">
                        <span className="inline-flex items-center gap-2">
                          <span className="h-2.5 w-2.5 bg-[#ed7d31]" />
                          Referred for Biological NCD Risk Factors
                        </span>
                      </td>
                      {biologicalFigureSeriesValues.referred.map((value, index) => (
                        <td key={`referred-${index}`} className="border border-[#c6c6c6] px-2 py-1 text-center tabular-nums">
                          {formatChartNumber(value)}
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        ) : null}

        {!dataLoading && !dataError && !isBiologicalFigure && chart.chart_type !== "pie" && chartData.length > 0 ? (
          <div
            ref={chartRef}
            className={cn("rounded-[1rem] border px-3 pb-3", useSinglePeriodComparisonLayout ? "pt-3" : "pt-4")}
            style={chartPanelStyle}
          >
            {useSinglePeriodComparisonLayout ? (
              <div className="space-y-3">
                <div className="flex justify-end">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-[11px] font-semibold text-[#64748b] hover:bg-[#eef4fb] hover:text-[#1f2937]"
                    onClick={() => setShowComparisonSummary((current) => !current)}
                  >
                    {showComparisonSummary ? <ChevronUp className="mr-1.5 h-3.5 w-3.5" /> : <ChevronDown className="mr-1.5 h-3.5 w-3.5" />}
                    {showComparisonSummary ? "Hide summary" : "Show summary"}
                  </Button>
                </div>

                {showComparisonSummary ? (
                  <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
                    <div className="rounded-lg border border-[#d7dee8] bg-[#f8fbff] px-2.5 py-2">
                      <div className="text-[9px] font-semibold uppercase tracking-[0.16em] text-[#6b7c93]">Reporting period</div>
                      <div className="mt-0.5 text-[12px] font-semibold leading-4 text-[#1f2937]">{singlePeriodLabel}</div>
                    </div>
                    <div className="rounded-lg border border-[#d7dee8] bg-[#f8fbff] px-2.5 py-2">
                      <div className="text-[9px] font-semibold uppercase tracking-[0.16em] text-[#6b7c93]">Visible total</div>
                      <div className="mt-0.5 text-[12px] font-semibold leading-4 text-[#1f2937]">{formatChartNumber(singlePeriodTotal)}</div>
                      {singlePeriodTarget !== null ? (
                        <div className="mt-0.5 text-[10px] leading-4 text-[#64748b]">
                          Target: {formatChartNumber(singlePeriodTarget)}
                        </div>
                      ) : null}
                    </div>
                    <div className="rounded-lg border border-[#d7dee8] bg-[#f8fbff] px-2.5 py-2">
                      <div className="text-[9px] font-semibold uppercase tracking-[0.16em] text-[#6b7c93]">Largest contributor</div>
                      <div className="mt-0.5 truncate text-[12px] font-semibold leading-4 text-[#1f2937]" title={largestContributorSummary}>
                        {largestContributorSummary}
                      </div>
                      {singlePeriodPerformancePercent !== null ? (
                        <div className="mt-0.5 text-[10px] leading-4 text-[#64748b]">
                          Attainment: {formatChartPercent(singlePeriodPerformancePercent)}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                {barOrientation === "horizontal" ? (
                  <div className="w-full" style={{ maxWidth: `${chartFrameMaxWidth}px` }}>
                    <ResponsiveContainer width="100%" height={singlePeriodHorizontalHeight}>
                      <BarChart
                        data={singlePeriodComparisonRows}
                        layout="vertical"
                        margin={{ top: 4, right: 32, left: 20, bottom: 4 }}
                      >
                        <CartesianGrid horizontal={false} stroke="#e5e7eb" />
                        <XAxis
                          type="number"
                          tick={{ fill: axisTickColor, fontSize: 12 }}
                          tickLine={false}
                          axisLine={false}
                          tickFormatter={formatChartNumber}
                        />
                        <YAxis
                          type="category"
                          dataKey="label"
                          width={singlePeriodLayout.labelWidth}
                          interval={0}
                          tick={(props) => (
                            <SinglePeriodComparisonYAxisTick
                              {...props}
                              color={axisTickColor}
                              maxCharsPerLine={singlePeriodLayout.maxCharsPerLine}
                              lineHeight={singlePeriodLayout.lineHeight}
                            />
                          )}
                          tickLine={false}
                          axisLine={false}
                        />
                        <RechartsTooltip
                          cursor={{ fill: "#f8fafc" }}
                          formatter={(value: unknown, _name: unknown, item: { payload?: SinglePeriodComparisonRow }) => {
                            const payload = item?.payload;
                            const share = payload ? formatChartPercent(payload.share) : "0.0%";
                            return [`${formatChartNumber(value)} (${share} of visible total)`, "Reported value"];
                          }}
                          labelFormatter={(label) => `Series: ${String(label)}`}
                        />
                        {singlePeriodTarget !== null ? (
                          <ReferenceLine
                            x={singlePeriodTarget}
                            stroke={BONASO_COLORS.target}
                            strokeDasharray="6 4"
                            label={{ value: "Target", position: "top", fill: "#64748b", fontSize: 12 }}
                          />
                        ) : null}
                        <Bar dataKey="value" name="Reported value" radius={[0, 6, 6, 0]} maxBarSize={24}>
                          {singlePeriodComparisonRows.map((row) => (
                            <Cell key={row.key} fill={row.color} />
                          ))}
                          <LabelList
                            dataKey="value"
                            position="right"
                            formatter={(value: unknown) => formatChartNumber(value)}
                            style={{ fill: "#334155", fontSize: 12, fontWeight: 600 }}
                          />
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="w-full" style={{ maxWidth: `${chartFrameMaxWidth}px` }}>
                    <ResponsiveContainer width="100%" height={singlePeriodVerticalHeight}>
                      <BarChart
                        data={singlePeriodComparisonRows}
                        margin={{ top: 12, right: 18, left: 40, bottom: singlePeriodVerticalBottomMargin }}
                      >
                        <CartesianGrid vertical={false} stroke="#e5e7eb" />
                        <XAxis
                          dataKey="label"
                          interval={0}
                          height={singlePeriodVerticalXAxisHeight}
                          tick={(props) => (
                            <SinglePeriodComparisonXAxisTick
                              {...props}
                              color={axisTickColor}
                              maxCharsPerLine={singlePeriodVerticalMaxCharsPerLine}
                              lineHeight={singlePeriodVerticalTickLineHeight}
                              angle={singlePeriodVerticalTickAngle}
                            />
                          )}
                          tickLine={false}
                          axisLine={false}
                        />
                        <YAxis
                          tick={{ fill: axisTickColor, fontSize: 12 }}
                          tickLine={false}
                          axisLine={false}
                          width={presentationYAxisWidth}
                          tickFormatter={formatChartNumber}
                          label={{
                            value: "No. of people",
                            angle: -90,
                            position: "insideLeft",
                            offset: 2,
                            fill: "#475569",
                            style: { fontSize: 12, fontWeight: 500, letterSpacing: 0.2 },
                          }}
                        />
                        <RechartsTooltip
                          cursor={{ fill: "#f8fafc" }}
                          formatter={(value: unknown, _name: unknown, item: { payload?: SinglePeriodComparisonRow }) => {
                            const payload = item?.payload;
                            const share = payload ? formatChartPercent(payload.share) : "0.0%";
                            return [`${formatChartNumber(value)} (${share} of visible total)`, "Reported value"];
                          }}
                          labelFormatter={(label) => `Series: ${String(label)}`}
                        />
                        {singlePeriodTarget !== null ? (
                          <ReferenceLine
                            y={singlePeriodTarget}
                            stroke={BONASO_COLORS.target}
                            strokeDasharray="6 4"
                            label={{ value: "Target", position: "insideTopRight", fill: "#64748b", fontSize: 12 }}
                          />
                        ) : null}
                        <Bar dataKey="value" name="Reported value" radius={[6, 6, 0, 0]} maxBarSize={42}>
                          {singlePeriodComparisonRows.map((row) => (
                            <Cell key={row.key} fill={row.color} />
                          ))}
                          <LabelList
                            dataKey="value"
                            position="top"
                            formatter={(value: unknown) => formatChartNumber(value)}
                            style={{ fill: "#334155", fontSize: 12, fontWeight: 600 }}
                          />
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            ) : (
              <div className="w-full" style={{ maxWidth: `${chartFrameMaxWidth}px` }}>
                <ResponsiveContainer width="100%" height={standardChartHeight}>
                  {chart.chart_type === "line" ? (
                <LineChart
                  data={chartDataForRender}
                  margin={
                    usePresentationLineStyle
                      ? { top: presentationChartTopInset, right: 12, left: 12, bottom: 8 }
                      : undefined
                  }
                >
                  {usePresentationLineStyle ? (
                    <CartesianGrid vertical={false} stroke="#e5e7eb" />
                  ) : null}
                  <XAxis
                    dataKey="period"
                    tick={{ fill: axisTickColor, fontSize: 12 }}
                    tickFormatter={useSocialMessageStyle ? (value) => formatQuarterLabelNoSpace(String(value ?? "")) : undefined}
                    tickLine={false}
                    axisLine={false}
                    tickMargin={10}
                  />
                  <YAxis
                    tick={{ fill: axisTickColor, fontSize: 12 }}
                    tickLine={false}
                    axisLine={false}
                    width={usePresentationLineStyle ? presentationYAxisWidth : 64}
                    tickFormatter={usePresentationLineStyle ? formatChartNumber : undefined}
                    label={
                      usePresentationLineStyle
                        ? {
                            value: "No. of people",
                            angle: -90,
                            position: "insideLeft",
                            offset: 2,
                            fill: "#475569",
                            style: { fontSize: 12, fontWeight: 500, letterSpacing: 0.2 },
                          }
                        : undefined
                    }
                  />
                  <RechartsTooltip shared={false} cursor={{ fill: "none" }} content={<LegacyTooltip presentation={usePresentationLineStyle} />} />
                  {!usePresentationLineStyle ? <RechartsLegend /> : null}
                  {renderedSeries.map((series, index) => (
                    <Line
                      key={`${series.key}-achieved`}
                      type={usePresentationLineStyle ? "monotone" : "linear"}
                      dataKey={series.key}
                      name={series.label}
                      fill={usePresentationLineStyle ? getPresentationChartColor(index) : getLegacyChartColor(index)}
                      stroke={usePresentationLineStyle ? getPresentationChartColor(index) : getLegacyChartColor(index)}
                      strokeWidth={usePresentationLineStyle ? 2.5 : 1}
                      dot={usePresentationLineStyle ? { r: 3, strokeWidth: 1 } : true}
                      activeDot={usePresentationLineStyle ? { r: 5 } : true}
                    />
                  ))}
                  {trendLineSeries.map((series) => (
                    <Line
                      key={series.dataKey}
                      type={usePresentationLineStyle ? "monotone" : "linear"}
                      dataKey={series.dataKey}
                      name={series.name}
                      stroke={series.stroke}
                      strokeWidth={usePresentationLineStyle ? 2 : 1.5}
                      strokeDasharray="6 4"
                      strokeOpacity={0.85}
                      dot={false}
                      activeDot={false}
                    />
                  ))}
                  {hasLegacyChartData
                    ? hasTargetSeries
                      ? (
                          <Line
                            dataKey="Target"
                            name="Target"
                            fill={BONASO_COLORS.target}
                            stroke={BONASO_COLORS.target}
                            strokeDasharray={usePresentationLineStyle ? "6 4" : undefined}
                            strokeWidth={usePresentationLineStyle ? 2.5 : 1}
                            dot={usePresentationLineStyle ? { r: 3, strokeWidth: 1 } : true}
                            activeDot={usePresentationLineStyle ? { r: 5 } : true}
                          />
                        )
                      : null
                    : chart.use_target && renderedSeries.length === 1
                      ? (
                          <Line
                            dataKey={`${renderedSeries[0].key}_target`}
                            name="Target"
                            fill={BONASO_COLORS.target}
                            stroke={BONASO_COLORS.target}
                            strokeDasharray={usePresentationLineStyle ? "6 4" : undefined}
                            strokeWidth={usePresentationLineStyle ? 2.5 : 1}
                            dot={usePresentationLineStyle ? { r: 3, strokeWidth: 1 } : true}
                            activeDot={usePresentationLineStyle ? { r: 5 } : true}
                          />
                        )
                      : null}
                </LineChart>
                ) : barOrientation === "horizontal" ? (
                  <BarChart data={chartData} layout="vertical" margin={{ top: 8, right: 24, left: 8, bottom: 8 }}>
                    {usePresentationBarStyle ? (
                      <CartesianGrid horizontal={false} stroke={useSocialMessageStyle ? "#cecece" : "#e5e7eb"} />
                    ) : null}
                    <XAxis
                      type="number"
                      tick={{ fill: axisTickColor, fontSize: 12 }}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={usePresentationBarStyle ? formatChartNumber : undefined}
                      label={
                        usePresentationBarStyle
                          ? { value: "No. of People", position: "insideBottom", offset: -2, fill: "#525252", style: { fontSize: 13 } }
                          : undefined
                      }
                    />
                    <YAxis
                      type="category"
                      dataKey="period"
                      width={regularHorizontalBarLabelWidth}
                      interval={0}
                      tick={{ fill: axisTickColor, fontSize: 12 }}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(value) =>
                        truncateChartLabel(
                          useSocialMessageStyle ? formatQuarterLabelNoSpace(String(value ?? "")) : String(value ?? ""),
                          cardWidth > 0 && cardWidth < 760 ? 10 : 16,
                        )
                      }
                    />
                    <RechartsTooltip shared={false} cursor={{ fill: "none" }} content={<LegacyTooltip presentation={usePresentationBarStyle || useSocialMessageStyle} />} />
                    {!usePresentationBarStyle && !useSocialMessageStyle && renderedSeries.length < 12 ? <RechartsLegend /> : null}
                    {renderedSeries.map((series, index) => (
                      <Bar
                        key={`${series.key}-achieved`}
                        dataKey={series.key}
                        name={series.label}
                        stackId={series.stackId}
                        fill={
                          useSocialMessageStyle
                            ? getSocialMessageChartColor(series.label, index)
                            : usePresentationBarStyle
                              ? getPresentationChartColor(index)
                              : getLegacyChartColor(index)
                        }
                        radius={usePresentationBarStyle ? [0, 4, 4, 0] : undefined}
                        maxBarSize={usePresentationBarStyle ? 28 : undefined}
                      />
                    ))}
                    {hasLegacyChartData
                      ? hasTargetSeries
                        ? <Bar dataKey="Target" name="Target" fill={BONASO_COLORS.target} radius={usePresentationBarStyle ? [0, 4, 4, 0] : undefined} />
                        : null
                      : chart.use_target && renderedSeries.length === 1
                        ? <Bar dataKey={`${renderedSeries[0].key}_target`} name="Target" fill={BONASO_COLORS.target} radius={usePresentationBarStyle ? [0, 4, 4, 0] : undefined} />
                        : null}
                  </BarChart>
                ) : (
                  <BarChart
                    data={chartData}
                    margin={
                      usePresentationBarStyle
                        ? {
                            top: presentationChartTopInset,
                            right: 12,
                            left: compareByGroupingMode ? 20 : 8,
                            bottom: compareByGroupingMode ? 12 : 8,
                          }
                        : compareByGroupingMode
                          ? { top: 8, right: 12, left: 0, bottom: 8 }
                          : undefined
                    }
                  >
                    {usePresentationBarStyle ? (
                      <CartesianGrid vertical={false} stroke={useSocialMessageStyle ? "#cecece" : "#e5e7eb"} />
                    ) : null}
                    <XAxis
                      dataKey="period"
                      interval={compareByGroupingMode ? 0 : undefined}
                      height={groupedBarXAxisHeight}
                      tick={
                        compareByGroupingMode
                          ? (
                              <WrappedXAxisTick
                                color={axisTickColor}
                                maxCharsPerLine={groupedBarTickMaxCharsPerLine}
                                lineHeight={groupedBarTickLineHeight}
                              />
                            )
                          : { fill: axisTickColor, fontSize: 12 }
                      }
                      tickLine={false}
                      axisLine={false}
                      tickMargin={10}
                    />
                    <YAxis
                      tick={{ fill: axisTickColor, fontSize: 12 }}
                      tickLine={false}
                      axisLine={false}
                      width={usePresentationBarStyle ? presentationYAxisWidth : 64}
                      tickFormatter={usePresentationBarStyle ? formatChartNumber : undefined}
                      label={
                        usePresentationBarStyle
                          ? {
                              value: "No. of people",
                              angle: -90,
                              position: "insideLeft",
                              offset: 2,
                              fill: "#475569",
                              style: { fontSize: 12, fontWeight: 500, letterSpacing: 0.2 },
                            }
                          : undefined
                      }
                    />
                    <RechartsTooltip shared={false} cursor={{ fill: "none" }} content={<LegacyTooltip presentation={usePresentationBarStyle || useSocialMessageStyle} />} />
                    {!usePresentationBarStyle && !useSocialMessageStyle && renderedSeries.length < 12 ? <RechartsLegend /> : null}
                    {renderedSeries.map((series, index) => (
                      <Bar
                        key={`${series.key}-achieved`}
                        dataKey={series.key}
                        name={series.label}
                        stackId={series.stackId}
                        fill={
                          useSocialMessageStyle
                            ? getSocialMessageChartColor(series.label, index)
                            : usePresentationBarStyle
                              ? getPresentationChartColor(index)
                              : getLegacyChartColor(index)
                        }
                        radius={usePresentationBarStyle ? [4, 4, 0, 0] : undefined}
                        maxBarSize={usePresentationBarStyle ? 28 : undefined}
                      />
                    ))}
                    {hasLegacyChartData
                      ? hasTargetSeries
                        ? <Bar dataKey="Target" name="Target" fill={BONASO_COLORS.target} radius={usePresentationBarStyle ? [4, 4, 0, 0] : undefined} />
                        : null
                      : chart.use_target && renderedSeries.length === 1
                        ? <Bar dataKey={`${renderedSeries[0].key}_target`} name="Target" fill={BONASO_COLORS.target} radius={usePresentationBarStyle ? [4, 4, 0, 0] : undefined} />
                        : null}
                  </BarChart>
                  )}
                </ResponsiveContainer>
              </div>
            )}
            {presentationLegendItems.length > 1 ? (
              <div className="mt-3 rounded-[0.9rem] border border-[#d7dee8] bg-[#f8fbff] px-3 py-2">
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#64748b]">Key</div>
                <div className="flex flex-wrap gap-2">
                  {presentationLegendItems.map((item) => (
                    <div
                      key={item.key}
                      className="inline-flex max-w-full items-start gap-2 rounded-full border border-[#d7dee8] bg-white px-3 py-1.5 text-xs font-medium text-[#334155]"
                    >
                      <span
                        className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: item.color }}
                      />
                      <div className="min-w-0">
                        <div className="whitespace-normal break-words leading-snug">{item.label}</div>
                        <div className="text-[11px] font-semibold text-[#64748b]">
                          Count: {formatChartNumber(item.total)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {!dataLoading && !dataError && showPieLegendPrompt ? (
          <div
            className="rounded-[1rem] border p-3 text-sm"
            style={{
              backgroundColor: BONASO_COLORS.darkAccent,
              borderColor: "rgba(255,255,255,0.12)",
              color: "rgba(255,255,255,0.78)",
            }}
          >
            Select a legend item to view pie charts.
          </div>
        ) : null}

        {!dataLoading && !dataError && chart.chart_type === "pie" && pieDisplayData.length > 0 && !showPieLegendPrompt ? (
          <div
            ref={chartRef}
            className={cn("rounded-[1rem] border", zoomedView ? "p-3" : "p-2.5")}
            style={{ backgroundColor: "#ffffff", borderColor: "#d1d5db" }}
          >
            {shouldUsePieFallbackBreakdown ? (
              <div className="mb-3 grid gap-2.5 md:grid-cols-3">
                <div className="rounded-xl border border-[#d7dee8] bg-[#f8fbff] px-4 py-3">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#6b7c93]">Pie basis</div>
                  <div className="mt-1 text-sm font-semibold text-[#1f2937]">
                    {cleanLabel(derivedDisaggregateMatrix?.rowDimensionKey || "category")} contribution
                  </div>
                </div>
                <div className="rounded-xl border border-[#d7dee8] bg-[#f8fbff] px-4 py-3">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#6b7c93]">Visible total</div>
                  <div className="mt-1 text-sm font-semibold text-[#1f2937]">{formatChartNumber(pieDisplayTotal)}</div>
                </div>
                <div className="rounded-xl border border-[#d7dee8] bg-[#f8fbff] px-4 py-3">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#6b7c93]">Largest segment</div>
                  <div className="mt-1 text-sm font-semibold text-[#1f2937]">
                    {pieDisplayData[0]
                      ? `${pieDisplayData[0].name} (${formatChartPercent((pieDisplayData[0].value / Math.max(pieDisplayTotal, 1)) * 100)})`
                      : "-"}
                  </div>
                </div>
              </div>
            ) : null}

            <div className="w-full" style={{ maxWidth: `${chartFrameMaxWidth}px` }}>
              <div className="grid gap-2.5" style={{ gridTemplateColumns: `minmax(0,1fr) ${pieLegendColumnWidth}px` }}>
                <ResponsiveContainer width="100%" height={pieChartHeight}>
                  <PieChart>
                    <RechartsTooltip shared={false} content={<LegacyTooltip presentation />} />
                    <Pie
                      data={pieDisplayData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={pieInnerRadius}
                      outerRadius={pieOuterRadius}
                      paddingAngle={pieDisplayData.length > 1 ? 2 : 0}
                      stroke="#ffffff"
                      strokeWidth={2}
                    >
                      {pieDisplayData.map((entry, index) => (
                        <Cell key={entry.key} fill={getPresentationChartColor(index)} stroke={getPresentationChartColor(index)} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>

                <div className="rounded-xl border border-[#e5e7eb] bg-[#f8fafc] p-2">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#64748b]">Breakdown</div>
                  <div className="mt-2 space-y-1.5 overflow-y-auto pr-1" style={{ maxHeight: `${pieLegendMaxHeight}px` }}>
                    {pieDisplayData.map((entry, index) => {
                      const percent = pieDisplayTotal > 0 ? (entry.value / pieDisplayTotal) * 100 : 0;

                      return (
                        <div key={entry.key} className="rounded-md border border-[#e2e8f0] bg-white px-2 py-1.5">
                          <div className="flex items-center gap-2">
                            <span
                              className="h-2 w-2 rounded-full"
                              style={{ backgroundColor: getPresentationChartColor(index) }}
                            />
                            <div className="min-w-0 flex-1 truncate text-xs font-medium text-[#1f2937]">{entry.name}</div>
                            <div className="text-[10px] font-semibold text-[#64748b]">{formatChartPercent(percent)}</div>
                          </div>
                          <div className="mt-0.5 text-xs tabular-nums text-[#334155]">{formatChartNumber(entry.value)}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {!dataLoading && !dataError && !isBiologicalFigure && chartData.length === 0 && pieDisplayData.length === 0 ? (
          <div
            className="rounded-[1rem] border border-dashed p-3 text-sm"
            style={{
              backgroundColor: BONASO_COLORS.darkAccent,
              borderColor: "rgba(255,255,255,0.14)",
              color: "rgba(255,255,255,0.78)",
            }}
          >
            <i>No data yet.</i>
          </div>
        ) : null}

        {hasSupportingDataSection ? (
          <div className="flex justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 border-[#d7dee8] bg-white px-3 text-xs font-semibold text-[#475569] hover:bg-[#f8fafc] hover:text-[#0f172a]"
              onClick={() => setShowSupportingData((value) => !value)}
            >
              {showSupportingData ? <ChevronUp className="mr-1.5 h-3.5 w-3.5" /> : <ChevronDown className="mr-1.5 h-3.5 w-3.5" />}
              {showSupportingData ? "Hide data table" : "Show data table"}
            </Button>
          </div>
        ) : null}

        {showSupportingData && hasDisaggregateMatrix ? (
          <ConsolidatedMatrixTable
            title={`Disaggregate Matrix (${derivedDisaggregateMatrix.rowDimensionKey} x ${derivedDisaggregateMatrix.columnDimensionKey})`}
            matrix={derivedDisaggregateMatrix}
            className="space-y-3 border border-[#c6c6c6] bg-white p-4"
          />
        ) : null}

        {showSupportingData && hasPresentationSupportingTable ? (
          <>
            <div
              className="overflow-x-auto rounded-[1rem] border shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]"
              style={{
                borderColor: isSocialMessageFigure ? "#c6c6c6" : "#d7dee8",
                backgroundColor: isSocialMessageFigure ? "#efefef" : "#ffffff",
              }}
            >
              <table className="min-w-full border-collapse text-sm text-[#5f6368]">
                <thead>
                  <tr style={{ backgroundColor: isSocialMessageFigure ? "#efefef" : "#f8fafc" }}>
                    <th className="border border-[#d1d5db] px-4 py-3 text-left font-semibold">
                      {chartTableLeadingColumnLabel}
                    </th>
                    {chartTableColumns.map((header) => (
                      <th key={header} className="border border-[#d1d5db] px-4 py-3 text-center font-semibold">
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {chartTableRows.map((row) => (
                    <tr key={row.key}>
                      <td className="border border-[#d1d5db] px-4 py-3 font-medium">
                        <span className="inline-flex items-center gap-2">
                          <span className="h-3 w-3 shrink-0" style={{ backgroundColor: row.color }} />
                          {row.label}
                        </span>
                      </td>
                      {row.values.map((value, index) => (
                        <td key={`${row.key}-${index}`} className="border border-[#d1d5db] px-4 py-3 text-center tabular-nums">
                          {isSocialMessageFigure
                            ? (() => {
                                const numeric =
                                  typeof value === "number"
                                    ? value
                                    : Number(String(value ?? "0").replaceAll(",", ""));
                                return Number.isFinite(numeric) ? String(numeric) : String(value ?? 0);
                              })()
                            : formatChartNumber(value)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}

        {showSupportingData && hasLegacySupportingTable ? (
          <>
            <Separator className="bg-border" />
            <div
              className="overflow-x-auto rounded-[1rem] border"
              style={{ backgroundColor: BONASO_COLORS.darkAccent, borderColor: "rgba(255,255,255,0.12)" }}
            >
              <table className="min-w-full text-sm">
                <thead>
                  <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.12)" }}>
                    {Object.keys(chartData[0]).map((header) => (
                      <th key={header} className="px-3 py-2 text-left font-medium" style={{ color: "rgba(255,255,255,0.76)" }}>
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {chartData.map((row, index) => (
                    <tr
                      key={`row-${index}`}
                      style={{
                        borderBottom: index === chartData.length - 1 ? "none" : "1px solid rgba(255,255,255,0.08)",
                      }}
                    >
                      {Object.keys(chartData[0]).map((header) => (
                        <td key={`${index}-${header}`} className="px-3 py-2" style={{ color: BONASO_COLORS.white }}>
                          {String(row[header] ?? "")}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}

        <div className="flex items-center justify-end">
          <Popover open={showFilters} onOpenChange={setShowFilters}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 gap-2 rounded-full px-3 text-xs font-semibold"
                style={{
                  borderColor: usePresentationTableStyle ? "#d7dee8" : "rgba(255,255,255,0.16)",
                  backgroundColor: usePresentationTableStyle ? "#f8fbff" : BONASO_COLORS.uberDarkAccent,
                  color: usePresentationTableStyle ? "#334155" : BONASO_COLORS.white,
                }}
              >
                {showFilters ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                {savedFilterCount > 0 ? `Filters (${savedFilterCount})` : "Filters"}
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              sideOffset={8}
              className="w-[min(92vw,32rem)] max-h-[70vh] overflow-y-auto p-0"
              style={{
                backgroundColor: usePresentationTableStyle ? "#f8fbff" : BONASO_COLORS.uberDarkAccent,
                borderColor: usePresentationTableStyle ? "#d7dee8" : "rgba(255,255,255,0.1)",
                color: usePresentationTableStyle ? "#475569" : "rgba(255,255,255,0.82)",
              }}
            >
              <div
                className="flex items-center justify-between px-4 py-3 text-sm"
                style={{ borderBottom: usePresentationTableStyle ? "1px solid #d7dee8" : "1px solid rgba(255,255,255,0.1)" }}
              >
                <div>
                  <div
                    className="text-[11px] font-semibold uppercase tracking-[0.18em]"
                    style={{ color: usePresentationTableStyle ? "#7c8da6" : "rgba(255,255,255,0.58)" }}
                  >
                    Analytics Filters
                  </div>
                  <div className="mt-1 text-xs" style={{ color: usePresentationTableStyle ? "#64748b" : "rgba(255,255,255,0.72)" }}>
                    {savedFilterCount > 0 ? `${savedFilterCount} saved filter${savedFilterCount === 1 ? "" : "s"}` : "No saved filters"}
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2 text-xs"
                  style={{ color: usePresentationTableStyle ? "#475569" : "rgba(255,255,255,0.82)" }}
                  onClick={handleClearFilters}
                  disabled={savingFilters || savedFilterCount === 0}
                >
                  {savingFilters ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
                  Clear all
                </Button>
              </div>

              <div className="px-4 py-3 text-sm">
                {usingDemoDashboard ? (
                  <div>Demo charts keep filters read-only.</div>
                ) : visibleFilterGroups.length > 0 ? (
                  <div className="space-y-4">
                    {visibleFilterGroups.map((group) => {
                      const selectedValues = activeFilters[group.name] ?? [];
                      const expanded = expandedFilterGroups[group.name] ?? false;

                      return (
                        <div
                          key={group.name}
                          className="rounded-xl border"
                          style={{ borderColor: usePresentationTableStyle ? "#d7dee8" : "rgba(255,255,255,0.1)" }}
                        >
                          <button
                            type="button"
                            onClick={() => toggleFilterGroup(group.name)}
                            className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
                          >
                            <span
                              className="text-sm font-semibold"
                              style={{ color: usePresentationTableStyle ? "#334155" : BONASO_COLORS.white }}
                            >
                              {group.label}
                            </span>
                            <span
                              className="ml-auto text-xs"
                              style={{ color: usePresentationTableStyle ? "#6b7c93" : "rgba(255,255,255,0.58)" }}
                            >
                              {selectedValues.length > 0 ? `${selectedValues.length} selected` : "All"}
                            </span>
                            {expanded ? (
                              <ChevronUp
                                className="h-4 w-4"
                                style={{ color: usePresentationTableStyle ? "#6b7c93" : "rgba(255,255,255,0.72)" }}
                              />
                            ) : (
                              <ChevronDown
                                className="h-4 w-4"
                                style={{ color: usePresentationTableStyle ? "#6b7c93" : "rgba(255,255,255,0.72)" }}
                              />
                            )}
                          </button>
                          {expanded ? (
                            <div
                              className="flex flex-wrap gap-2 border-t px-3 py-3"
                              style={{ borderColor: usePresentationTableStyle ? "#d7dee8" : "rgba(255,255,255,0.1)" }}
                            >
                              {group.options.map((option) => {
                                const active = selectedValues.includes(option.value);

                                return (
                                  <button
                                    key={`${group.name}-${option.value}`}
                                    type="button"
                                    onClick={() => handleToggleFilterValue(group.name, option.value)}
                                    disabled={savingFilters}
                                    className="rounded-full border px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60"
                                    style={{
                                      borderColor: usePresentationTableStyle
                                        ? active
                                          ? "#7eaad6"
                                          : "#d7dee8"
                                        : active
                                          ? BONASO_COLORS.uberLightAccent
                                          : "rgba(255,255,255,0.16)",
                                      backgroundColor: usePresentationTableStyle
                                        ? active
                                          ? "#e8f1fb"
                                          : "#ffffff"
                                        : active
                                          ? "rgba(161, 246, 195, 0.18)"
                                          : "rgba(255,255,255,0.04)",
                                      color: usePresentationTableStyle
                                        ? active
                                          ? "#2f73b8"
                                          : "#475569"
                                        : active
                                          ? BONASO_COLORS.uberLightAccent
                                          : BONASO_COLORS.white,
                                    }}
                                  >
                                    {option.label}
                                  </button>
                                );
                              })}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : primaryIndicatorCategory === "social" || primaryIndicatorCategory === "assessment" ? (
                  <div>
                    No available filter values for this {primaryIndicatorCategory} chart yet.
                  </div>
                ) : (
                  <div>
                    You cannot apply filters to this indicator type{primaryIndicatorType ? ` (${cleanLabel(primaryIndicatorType)})` : ""}.
                  </div>
                )}
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </CardContent>
      </Card>
    </div>
    {zoomable ? (
      <Dialog open={zoomOpen} onOpenChange={setZoomOpen}>
        <DialogContent className="max-h-[96vh] w-[min(96vw,1600px)] max-w-[min(96vw,1600px)] overflow-y-auto border-0 bg-transparent p-2 shadow-none sm:max-w-[min(96vw,1600px)]">
          <DialogHeader className="sr-only">
            <DialogTitle>{`Zoomed chart: ${chartTitle}`}</DialogTitle>
          </DialogHeader>
          <DashboardChartCard
            chart={chart}
            dashboard={dashboard}
            onEdit={onEdit}
            onDelete={onDelete}
            onRefresh={onRefresh}
            zoomable={false}
            zoomedView
          />
        </DialogContent>
      </Dialog>
    ) : null}
    </>
  );
}

