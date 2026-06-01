import { cleanLabel } from "../../components/analysis/analytics-utils.ts";
import {
  buildConsolidatedMatrix,
  buildRawRecords,
  type AnalyticsFact,
  type ConsolidatedMatrixData,
  type RawAggregateRecord,
} from "../analytics/query-builder.ts";
import type { AnalyticsFilterState } from "../../hooks/use-analytics-filters";
import { getIndicatorChartLabel, getIndicatorDisplayName } from "../indicators/display-name";
import { normalizeOrganizationType } from "../organization-hierarchy.ts";
import type { Indicator, Organization } from "../types";

const CHART_COLORS = [
  "#1f6a8a",
  "#e67e22",
  "#2e8b57",
  "#9c2f92",
  "#f2b134",
  "#4472c4",
  "#0f4258",
  "#d1495b",
] as const;

const FUNNEL_STAGE_DEFINITIONS = [
  {
    key: "tested",
    label: "Tested / Screened",
    patterns: [/test/i, /screen/i, /psychoeducation/i, /messag/i],
  },
  {
    key: "positive",
    label: "Positive / Referred",
    patterns: [/positive/i, /refer/i],
  },
  {
    key: "art",
    label: "ART / Initiated / Treated",
    patterns: [/\bart\b/i, /initiat/i, /treat/i, /counsel/i, /complete/i],
  },
] as const;

export type VisualizationKind =
  | "bar"
  | "grouped-bar"
  | "stacked-bar"
  | "heatmap"
  | "funnel"
  | "cascade"
  | "trend";

export type VisualizationKpi = {
  key: string;
  title: string;
  value: string;
  helper: string;
};

export type VisualizationSeries = {
  key: string;
  label: string;
  color: string;
  stackId?: string;
};

export type DrilldownTarget = {
  dimension: string;
  value: string;
  seriesDimension?: string;
  seriesValue?: string;
};

export type BarLikeChart = {
  kind: "bar" | "grouped-bar" | "stacked-bar" | "trend";
  title: string;
  description: string;
  xKey: string;
  yAxisLabel: string;
  data: Array<Record<string, string | number>>;
  series: VisualizationSeries[];
  drilldownDimension?: string;
  secondaryDrilldownDimension?: string;
  emptyMessage?: string;
};

export type HeatmapChart = {
  kind: "heatmap";
  title: string;
  description: string;
  xDimension: string;
  yDimension: string;
  xLabels: string[];
  yLabels: string[];
  cells: number[][];
  emptyMessage?: string;
};

export type FunnelChart = {
  kind: "funnel" | "cascade";
  title: string;
  description: string;
  steps: Array<{
    key: string;
    label: string;
    value: number;
    retentionPercent: number;
    conversionPercent: number | null;
    dropoffPercent: number;
    targetValue?: number;
    targetRetentionPercent?: number | null;
    targetConversionPercent?: number | null;
    breakdown?: Array<{
      key: string;
      label: string;
      value: number;
      targetValue?: number;
      sharePercent: number;
    }>;
  }>;
  emptyMessage?: string;
};

export type VisualizationChart = BarLikeChart | HeatmapChart | FunnelChart;

export type DimensionSummary = {
  key: string;
  label: string;
  distinctValues: string[];
  distinctCount: number;
};

export type VisualizationTable = {
  matrix: ConsolidatedMatrixData | null;
  rawRows: RawAggregateRecord[];
  rowDimensionKey: string;
  columnDimensionKey: string;
};

export type VisualizationResult = {
  normalizedRecords: NormalizedAggregateRecord[];
  dimensions: DimensionSummary[];
  kpis: VisualizationKpi[];
  insights: string[];
  recommendedChart: VisualizationChart | null;
  overviewChart: VisualizationChart | null;
  comparisonChart: VisualizationChart | null;
  disaggregationChart: VisualizationChart | null;
  trendChart: VisualizationChart | null;
  funnelChart: VisualizationChart | null;
  table: VisualizationTable;
  availableViews: Array<"overview" | "disaggregation" | "comparison" | "trends" | "table">;
};

export type NormalizedAggregateRecord = {
  key: string;
  aggregateId: string;
  indicatorId: string;
  indicatorName: string;
  organizationId: string;
  organizationName: string;
  projectId: string;
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  value: number;
  target: number | null;
  achievementPercent: number | null;
  dimensions: Record<string, string>;
  recordType: "value";
  source: AnalyticsFact;
};

export type VisualizationRequest = {
  indicatorId?: string | null;
  records: AnalyticsFact[];
  dimensions?: string[];
  indicators: Indicator[];
  organizations: Organization[];
  scopedOrgIds: string[];
  selectedPeriods: string[];
  periodMode: AnalyticsFilterState["periodMode"];
  projectId?: string | null;
  comparisonMode: AnalyticsFilterState["comparisonMode"];
  drilldownFilters?: Record<string, string[]>;
  chartMode?: VisualizationKind | "auto";
};

type TargetLookupContext = {
  selectedPeriods: string[];
  periodMode: AnalyticsFilterState["periodMode"];
  projectId?: string | null;
};

type ComparisonGroupingMode = "organization" | "coordinator" | "indicator" | "disaggregate" | "disaggregation";

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(
    Number.isFinite(value) ? value : 0,
  );
}

function formatPercent(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "No target";
  return `${value.toFixed(1)}%`;
}

function normalizeDimensionValue(value: string | undefined) {
  const trimmed = String(value || "").trim();
  return trimmed || "Unspecified";
}

function normalizeText(value: string) {
  return value.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

function parseQuarterFromLabel(label: string): 1 | 2 | 3 | 4 | null {
  const match = String(label || "")
    .trim()
    .match(/^Q([1-4])\s+\d{4}(?:\/\d{2,4})?$/i);
  if (!match) return null;
  return Number(match[1]) as 1 | 2 | 3 | 4;
}

function buildIndicatorMap(indicators: Indicator[]) {
  return new Map(indicators.map((indicator) => [String(indicator.id), indicator]));
}

function buildOrganizationMap(organizations: Organization[]) {
  return new Map(organizations.map((organization) => [String(organization.id), organization]));
}

function resolveCoordinatorLabelByOrganizationId(
  organizationId: string,
  organizationMap: Map<string, Organization>,
) {
  let cursor = organizationMap.get(String(organizationId));
  const visited = new Set<string>();

  while (cursor) {
    const cursorId = String(cursor.id);
    if (visited.has(cursorId)) break;
    visited.add(cursorId);

    const normalizedType = normalizeOrganizationType(cursor.type);
    if (
      normalizedType === "coordinator" ||
      normalizedType === "senior_coordinator" ||
      normalizedType === "funder"
    ) {
      return cursor.name || "Unassigned coordinator";
    }

    if (!cursor.parentId) break;
    cursor = organizationMap.get(String(cursor.parentId));
  }

  return "Unassigned coordinator";
}

function getTargetForIndicatorOrganization(
  indicator: Indicator | undefined,
  organizationId: string,
  context: TargetLookupContext,
) {
  if (!indicator?.project_targets?.length) return 0;

  return indicator.project_targets.reduce((sum, target) => {
    if (context.projectId && String(target.project) !== String(context.projectId)) return sum;
    if (String(target.organization) !== organizationId) return sum;

    if (context.periodMode === "quarter" && context.selectedPeriods.length > 0) {
      return (
        sum +
        context.selectedPeriods.reduce((quarterSum, periodLabel) => {
          const quarter = parseQuarterFromLabel(periodLabel);
          if (!quarter) return quarterSum;
          const value =
            quarter === 1
              ? target.q1_target
              : quarter === 2
                ? target.q2_target
                : quarter === 3
                  ? target.q3_target
                  : target.q4_target;
          return quarterSum + (typeof value === "number" ? value : 0);
        }, 0)
      );
    }

    return sum + (typeof target.target_value === "number" ? target.target_value : 0);
  }, 0);
}

function buildTargetLookup(
  indicators: Indicator[],
  scopedOrgIds: string[],
  context: TargetLookupContext,
) {
  const indicatorMap = buildIndicatorMap(indicators);
  const byIndicator = new Map<string, number>();
  const byIndicatorOrg = new Map<string, number>();

  indicatorMap.forEach((indicator, indicatorId) => {
    const total = scopedOrgIds.reduce(
      (sum, organizationId) =>
        sum + getTargetForIndicatorOrganization(indicator, organizationId, context),
      0,
    );
    byIndicator.set(indicatorId, total);

    scopedOrgIds.forEach((organizationId) => {
      byIndicatorOrg.set(
        `${indicatorId}::${organizationId}`,
        getTargetForIndicatorOrganization(indicator, organizationId, context),
      );
    });
  });

  return { byIndicator, byIndicatorOrg };
}

function passesDrilldown(
  fact: AnalyticsFact,
  drilldownFilters: Record<string, string[]>,
  organizationMap: Map<string, Organization>,
  indicatorMap: Map<string, Indicator>,
) {
  return Object.entries(drilldownFilters).every(([dimension, selectedValues]) => {
    if (selectedValues.length === 0) return true;
    if (dimension === "organization") {
      return selectedValues.includes(fact.organizationId) || selectedValues.includes(fact.organizationName);
    }
    if (dimension === "coordinator") {
      const coordinator = resolveCoordinatorLabelByOrganizationId(String(fact.organizationId), organizationMap);
      return selectedValues.includes(coordinator);
    }
    if (dimension === "indicator") {
      const indicator = indicatorMap.get(String(fact.indicatorId));
      const displayName = getIndicatorDisplayName(indicator, `Indicator ${fact.indicatorId}`);
      const chartLabel = getIndicatorChartLabel(
        {
          code: indicator?.code,
          name: fact.indicatorName || indicator?.name,
          short_name: indicator?.short_name,
        },
        `Indicator ${fact.indicatorId}`,
      );
      return (
        selectedValues.includes(fact.indicatorId) ||
        selectedValues.includes(fact.indicatorName) ||
        selectedValues.includes(displayName) ||
        selectedValues.includes(chartLabel)
      );
    }
    if (dimension === "period") {
      return selectedValues.includes(fact.periodLabel);
    }
    if (dimension === "stage") {
      const normalizedSelections = selectedValues.map((value) => normalizeText(value));
      const source = `${fact.disaggregates.stage || ""} ${fact.disaggregates.flow_stage || ""} ${fact.indicatorName} ${fact.notes || ""}`;
      return FUNNEL_STAGE_DEFINITIONS.some((stage) => {
        const matchesSelection =
          normalizedSelections.includes(normalizeText(stage.key)) ||
          normalizedSelections.includes(normalizeText(stage.label));
        if (!matchesSelection) return false;
        return stage.patterns.some((pattern) => pattern.test(source));
      });
    }
    const value = fact.disaggregates[dimension];
    return selectedValues.includes(normalizeDimensionValue(value));
  });
}

export function normalizeAggregateRecords(input: {
  records: AnalyticsFact[];
  indicators: Indicator[];
  organizations: Organization[];
  scopedOrgIds: string[];
  selectedPeriods: string[];
  periodMode: AnalyticsFilterState["periodMode"];
  projectId?: string | null;
  drilldownFilters?: Record<string, string[]>;
}) {
  const {
    records,
    indicators,
    organizations,
    scopedOrgIds,
    selectedPeriods,
    periodMode,
    projectId,
    drilldownFilters = {},
  } = input;
  const indicatorMap = buildIndicatorMap(indicators);
  const organizationMap = buildOrganizationMap(organizations);
  const targetLookup = buildTargetLookup(indicators, scopedOrgIds, {
    selectedPeriods,
    periodMode,
    projectId,
  });
  const assignedTargetAggregateIds = new Set<string>();

  return records
    .filter((fact) => passesDrilldown(fact, drilldownFilters, organizationMap, indicatorMap))
    .map<NormalizedAggregateRecord>((fact, index) => {
      const indicatorId = String(fact.indicatorId);
      const organizationId = String(fact.organizationId);
      const indicator = indicatorMap.get(indicatorId);
      const organization = organizationMap.get(organizationId);
      const aggregateId = String(fact.aggregateId || "");
      let target = targetLookup.byIndicatorOrg.get(`${indicatorId}::${organizationId}`) ?? null;
      if (aggregateId && assignedTargetAggregateIds.has(aggregateId)) {
        target = null;
      } else if (aggregateId) {
        assignedTargetAggregateIds.add(aggregateId);
      }
      const achievementPercent = target && target > 0 ? (fact.value / target) * 100 : null;

      return {
        key: `${fact.aggregateId}-${index}`,
        aggregateId: fact.aggregateId,
        indicatorId,
        indicatorName: getIndicatorChartLabel(
          {
            code: indicator?.code,
            name: fact.indicatorName || indicator?.name,
            short_name: indicator?.short_name,
          },
          `Indicator ${indicatorId}`,
        ),
        organizationId,
        organizationName: fact.organizationName || organization?.name || "Organization",
        projectId: String(fact.projectId || ""),
        periodLabel: fact.periodLabel,
        periodStart: fact.periodStart,
        periodEnd: fact.periodEnd,
        value: fact.value,
        target,
        achievementPercent,
        dimensions: Object.fromEntries(
          Object.entries(fact.disaggregates).map(([key, value]) => [key, normalizeDimensionValue(value)]),
        ),
        recordType: "value",
        source: fact,
      };
    });
}

export function extractDimensions(records: NormalizedAggregateRecord[]): DimensionSummary[] {
  const valuesByDimension = new Map<string, Set<string>>();

  records.forEach((record) => {
    Object.entries(record.dimensions).forEach(([key, value]) => {
      if (!valuesByDimension.has(key)) valuesByDimension.set(key, new Set());
      valuesByDimension.get(key)?.add(normalizeDimensionValue(value));
    });
  });

  return Array.from(valuesByDimension.entries())
    .map(([key, values]) => {
      const distinctValues = Array.from(values).sort((left, right) => left.localeCompare(right));
      return {
        key,
        label: cleanLabel(key),
        distinctValues,
        distinctCount: distinctValues.length,
      };
    })
    .sort((left, right) => right.distinctCount - left.distinctCount);
}

export function buildFactTable(records: NormalizedAggregateRecord[]) {
  return records.map((record) => record.source);
}

function aggregateSum<T extends string>(
  records: NormalizedAggregateRecord[],
  keyBuilder: (record: NormalizedAggregateRecord) => T,
) {
  const totals = new Map<T, number>();
  records.forEach((record) => {
    const key = keyBuilder(record);
    totals.set(key, (totals.get(key) || 0) + record.value);
  });
  return totals;
}

function getTopDimensionInsight(records: NormalizedAggregateRecord[], dimension: string | undefined) {
  if (!dimension) return null;
  const totals = aggregateSum(records, (record) => record.dimensions[dimension] || "Unspecified");
  const topEntry = Array.from(totals.entries()).sort((left, right) => right[1] - left[1])[0];
  if (!topEntry) return null;
  return `${cleanLabel(dimension)} leader: ${topEntry[0]} (${formatNumber(topEntry[1])})`;
}

export function buildKPI(input: {
  records: NormalizedAggregateRecord[];
  scopedOrgIds: string[];
  selectedIndicatorIds: string[];
  dimensions: string[];
}) {
  const { records, scopedOrgIds, selectedIndicatorIds, dimensions } = input;
  const total = records.reduce((sum, record) => sum + record.value, 0);
  const target = records.reduce((sum, record) => sum + (record.target || 0), 0);
  const reportingOrganizations = new Set(records.map((record) => record.organizationId)).size;
  const completeness = scopedOrgIds.length > 0 ? (reportingOrganizations / scopedOrgIds.length) * 100 : 0;
  const highestOrganization = Array.from(
    aggregateSum(records, (record) => record.organizationName).entries(),
  ).sort((left, right) => right[1] - left[1])[0];
  const primaryInsight = getTopDimensionInsight(records, dimensions[0]);

  return {
    cards: [
      {
        key: "total",
        title: "Total reported",
        value: formatNumber(total),
        helper: `${reportingOrganizations} reporting organization${reportingOrganizations === 1 ? "" : "s"}`,
      },
      {
        key: "target",
        title: "Target",
        value: target > 0 ? formatNumber(target) : "No target",
        helper: target > 0 ? `${formatPercent((total / target) * 100)} achievement` : "Targets not configured",
      },
      {
        key: "completeness",
        title: "Completeness",
        value: `${completeness.toFixed(1)}%`,
        helper: `${Math.max(0, scopedOrgIds.length - reportingOrganizations)} organizations missing`,
      },
      {
        key: "coverage",
        title: "Indicator coverage",
        value: String(selectedIndicatorIds.length),
        helper: highestOrganization
          ? `Largest contributor: ${highestOrganization[0]}`
          : "No organization totals yet",
      },
    ] satisfies VisualizationKpi[],
    insights: [
      primaryInsight,
      highestOrganization
        ? `Highest organization total: ${highestOrganization[0]} (${formatNumber(highestOrganization[1])})`
        : null,
      target > 0 && total > target
        ? `Overachievement: ${formatPercent((total / target) * 100)} of target reached`
        : null,
    ].filter((entry): entry is string => Boolean(entry)),
  };
}

export function buildBarSeries(
  records: NormalizedAggregateRecord[],
  dimension: string,
): BarLikeChart | null {
  if (!dimension || records.length === 0) return null;

  const buckets = aggregateSum(records, (record) => record.dimensions[dimension] || "Unspecified");
  const data = Array.from(buckets.entries())
    .sort((left, right) => right[1] - left[1])
    .slice(0, 12)
    .map(([label, value]) => ({ category: label, value }));

  if (data.length === 0) return null;

  return {
    kind: "bar",
    title: `${cleanLabel(dimension)} distribution`,
    description: `Reported values grouped by ${cleanLabel(dimension).toLowerCase()}.`,
    xKey: "category",
    yAxisLabel: "Number of people",
    data,
    series: [{ key: "value", label: "Value", color: CHART_COLORS[0] }],
    drilldownDimension: dimension,
  };
}

export function buildStackedSeries(
  records: NormalizedAggregateRecord[],
  dimensionA: string,
  dimensionB: string,
): BarLikeChart | null {
  if (!dimensionA || !dimensionB || records.length === 0) return null;

  const categoryMap = new Map<string, Record<string, string | number>>();
  const seriesLabels = new Set<string>();

  records.forEach((record) => {
    const primary = record.dimensions[dimensionA] || "Unspecified";
    const secondary = record.dimensions[dimensionB] || "Unspecified";
    const current = categoryMap.get(primary) || { category: primary };
    current[secondary] = Number(current[secondary] || 0) + record.value;
    categoryMap.set(primary, current);
    seriesLabels.add(secondary);
  });

  const series = Array.from(seriesLabels)
    .sort((left, right) => left.localeCompare(right))
    .slice(0, 8)
    .map((label, index) => ({
      key: label,
      label,
      color: CHART_COLORS[index % CHART_COLORS.length],
      stackId: "stack",
    }));

  const data = Array.from(categoryMap.values())
    .map((row) => {
      const total = series.reduce((sum, item) => sum + Number(row[item.key] || 0), 0);
      return { ...row, value: total };
    })
    .sort((left, right) => Number(right.value || 0) - Number(left.value || 0))
    .slice(0, 10);

  if (data.length === 0 || series.length === 0) return null;

  return {
    kind: "stacked-bar",
    title: `${cleanLabel(dimensionA)} by ${cleanLabel(dimensionB)}`,
    description: `Stacked composition of ${cleanLabel(dimensionA).toLowerCase()} across ${cleanLabel(dimensionB).toLowerCase()}.`,
    xKey: "category",
    yAxisLabel: "Number of people",
    data,
    series,
    drilldownDimension: dimensionA,
    secondaryDrilldownDimension: dimensionB,
  };
}

export function buildHeatmap(
  records: NormalizedAggregateRecord[],
  dimensionA: string,
  dimensionB: string,
): HeatmapChart | null {
  if (!dimensionA || !dimensionB || records.length === 0) return null;

  const matrix = buildConsolidatedMatrix({
    facts: buildFactTable(records),
    rowDimensionKey: dimensionA,
    columnDimensionKey: dimensionB,
  });

  if (matrix.rowLabels.length === 0 || matrix.columnLabels.length === 0) return null;

  return {
    kind: "heatmap",
    title: `${cleanLabel(dimensionA)} x ${cleanLabel(dimensionB)}`,
    description: `Heatmap of reported values across ${cleanLabel(dimensionA).toLowerCase()} and ${cleanLabel(dimensionB).toLowerCase()}.`,
    xDimension: dimensionB,
    yDimension: dimensionA,
    xLabels: matrix.columnLabels,
    yLabels: matrix.rowLabels,
    cells: matrix.cells,
  };
}

function getStageKeyFromRecord(record: NormalizedAggregateRecord) {
  const explicitStage =
    record.dimensions.stage ||
    record.dimensions.flow_stage ||
    record.dimensions.cascade_stage ||
    record.dimensions.cascade_step;
  if (explicitStage) {
    const normalizedStage = normalizeText(explicitStage);
    const matchingStage = FUNNEL_STAGE_DEFINITIONS.find((stage) =>
      stage.patterns.some((pattern) => pattern.test(normalizedStage)),
    );
    if (matchingStage) return matchingStage.key;
  }

  const source = normalizeText(
    `${record.source.indicatorName || record.indicatorName} ${record.source.notes || ""}`,
  );
  return (
    FUNNEL_STAGE_DEFINITIONS.find((stage) =>
      stage.patterns.some((pattern) => pattern.test(source)),
    )?.key || null
  );
}

function getStageLabel(stageKey: string) {
  return FUNNEL_STAGE_DEFINITIONS.find((stage) => stage.key === stageKey)?.label || cleanLabel(stageKey);
}

export function buildFunnel(
  records: NormalizedAggregateRecord[],
  options?: {
    disaggregationDimension?: string;
    includeTargets?: boolean;
  },
): FunnelChart | null {
  if (records.length === 0) return null;

  const includeTargets = options?.includeTargets !== false;
  const disaggregationDimension = options?.disaggregationDimension || "";
  const totalsByStage = new Map<string, { value: number; target: number }>();
  const breakdownByStage = new Map<string, Map<string, { value: number; target: number }>>();

  records.forEach((record) => {
    const stageKey = getStageKeyFromRecord(record);
    if (!stageKey) return;
    const current = totalsByStage.get(stageKey) || { value: 0, target: 0 };
    current.value += record.value;
    if (includeTargets && typeof record.target === "number" && Number.isFinite(record.target)) {
      current.target += record.target;
    }
    totalsByStage.set(stageKey, current);

    if (disaggregationDimension) {
      const segmentLabel =
        record.dimensions[disaggregationDimension] || "Unspecified";
      const stageBreakdown =
        breakdownByStage.get(stageKey) || new Map<string, { value: number; target: number }>();
      const currentBreakdown = stageBreakdown.get(segmentLabel) || { value: 0, target: 0 };
      currentBreakdown.value += record.value;
      if (includeTargets && typeof record.target === "number" && Number.isFinite(record.target)) {
        currentBreakdown.target += record.target;
      }
      stageBreakdown.set(segmentLabel, currentBreakdown);
      breakdownByStage.set(stageKey, stageBreakdown);
    }
  });

  const orderedStages = FUNNEL_STAGE_DEFINITIONS.map((stage) => stage.key).filter((stageKey) =>
    totalsByStage.has(stageKey),
  );

  if (orderedStages.length < 2) return null;

  const firstValue = totalsByStage.get(orderedStages[0])?.value || 0;
  const firstTargetValue = totalsByStage.get(orderedStages[0])?.target || 0;
  const steps = orderedStages.map((stageKey, index) => {
    const totals = totalsByStage.get(stageKey) || { value: 0, target: 0 };
    const value = totals.value;
    const targetValue = totals.target;
    const previousTotals =
      index === 0
        ? totals
        : totalsByStage.get(orderedStages[index - 1]) || totals;
    const previousValue = previousTotals.value;
    const previousTargetValue = previousTotals.target;
    const conversionPercent =
      index === 0
        ? null
        : previousValue > 0
          ? (value / previousValue) * 100
          : 0;
    const targetConversionPercent =
      includeTargets && index > 0
        ? previousTargetValue > 0
          ? (targetValue / previousTargetValue) * 100
          : 0
        : null;

    const breakdownEntries = disaggregationDimension
      ? Array.from((breakdownByStage.get(stageKey) || new Map()).entries())
          .map(([key, breakdown]) => ({
            key,
            label: key,
            value: breakdown.value,
            targetValue: includeTargets ? breakdown.target : undefined,
            sharePercent: value > 0 ? (breakdown.value / value) * 100 : 0,
          }))
          .sort((left, right) => right.value - left.value)
      : undefined;

    return {
      key: stageKey,
      label: getStageLabel(stageKey),
      value,
      targetValue: includeTargets ? targetValue : undefined,
      retentionPercent: previousValue > 0 ? (value / previousValue) * 100 : 0,
      conversionPercent,
      dropoffPercent: previousValue > 0 ? Math.max(0, 100 - (value / previousValue) * 100) : 0,
      targetRetentionPercent:
        includeTargets && firstTargetValue > 0 ? (targetValue / firstTargetValue) * 100 : null,
      targetConversionPercent,
      breakdown: breakdownEntries && breakdownEntries.length > 0 ? breakdownEntries : undefined,
    };
  });

  return {
    kind: "cascade",
    title: "Program cascade",
    description:
      disaggregationDimension
        ? `Stage-to-stage progression with ${cleanLabel(disaggregationDimension).toLowerCase()} disaggregation.`
        : "Stage-to-stage progression for matched cascade indicators.",
    steps: steps.map((step) => ({
      ...step,
      retentionPercent: firstValue > 0 ? (step.value / firstValue) * 100 : 0,
    })),
  };
}

export function buildTrend(records: NormalizedAggregateRecord[]): BarLikeChart | null {
  if (records.length === 0) return null;

  const seriesLabels = Array.from(new Set(records.map((record) => record.indicatorName))).slice(0, 6);
  const rowsByPeriod = new Map<string, Record<string, string | number>>();

  records.forEach((record) => {
    const period = record.periodLabel || "Unspecified";
    const current = rowsByPeriod.get(period) || { period };
    current[record.indicatorName] = Number(current[record.indicatorName] || 0) + record.value;
    rowsByPeriod.set(period, current);
  });

  const data = Array.from(rowsByPeriod.values());
  if (data.length < 2) return null;

  return {
    kind: "trend",
    title: "Trend over time",
    description: "Period-by-period movement for the selected indicators.",
    xKey: "period",
    yAxisLabel: "Number of people",
    data,
    series: seriesLabels.map((label, index) => ({
      key: label,
      label,
      color: CHART_COLORS[index % CHART_COLORS.length],
    })),
    drilldownDimension: "period",
  };
}

function buildComparisonChart(
  records: NormalizedAggregateRecord[],
  indicators: Indicator[],
  scopedOrgIds: string[],
  context: TargetLookupContext,
  options: {
    mode: ComparisonGroupingMode;
    organizations: Organization[];
    disaggregationDimension?: string;
  },
): BarLikeChart | null {
  if (records.length === 0) return null;

  if (options.mode === "indicator") {
    const indicatorsById = buildIndicatorMap(indicators);
    const actualByIndicator = new Map<string, number>();
    const targetByIndicator = new Map<string, number>();
    const indicatorLabelById = new Map<string, string>();

    records.forEach((record) => {
      const indicatorId = String(record.indicatorId || "");
      if (!indicatorId) return;
      const indicatorMeta = indicatorsById.get(indicatorId);
      const indicatorLabel = getIndicatorChartLabel(
        {
          code: indicatorMeta?.code,
          name: indicatorMeta?.name || record.indicatorName,
          short_name: indicatorMeta?.short_name,
        },
        "Indicator",
      );
      indicatorLabelById.set(indicatorId, indicatorLabel || "Indicator");
      actualByIndicator.set(indicatorId, (actualByIndicator.get(indicatorId) || 0) + record.value);
    });

    indicators.forEach((indicator) => {
      const indicatorId = String(indicator.id);
      const label = getIndicatorChartLabel(indicator, `Indicator ${indicatorId}`);
      indicatorLabelById.set(indicatorId, label);
      const indicatorTarget = scopedOrgIds.reduce(
        (sum, organizationId) => sum + getTargetForIndicatorOrganization(indicator, organizationId, context),
        0,
      );
      targetByIndicator.set(indicatorId, indicatorTarget);
    });

    const data = Array.from(new Set([...actualByIndicator.keys(), ...targetByIndicator.keys()]))
      .map((indicatorId) => ({
        category: indicatorLabelById.get(indicatorId) || "Indicator",
        actual: actualByIndicator.get(indicatorId) || 0,
        target: targetByIndicator.get(indicatorId) || 0,
      }))
      .filter((entry) => entry.actual > 0 || entry.target > 0)
      .sort((left, right) => Math.max(right.actual, right.target) - Math.max(left.actual, left.target))
      .slice(0, 12);

    if (data.length === 0) return null;

    return {
      kind: "grouped-bar",
      title: "Indicator comparison",
      description: "Actual reported values against configured targets for each indicator in scope.",
      xKey: "category",
      yAxisLabel: "Number of people",
      data,
      series: [
        { key: "actual", label: "Actual", color: CHART_COLORS[0] },
        { key: "target", label: "Target", color: CHART_COLORS[1] },
      ],
      drilldownDimension: "indicator",
    };
  }

  if (options.mode === "disaggregate" || options.mode === "disaggregation") {
    const disaggregationDimension = options.disaggregationDimension || "";
    if (!disaggregationDimension) return null;

    const actualByDimension = new Map<string, number>();
    records.forEach((record) => {
      const category = record.dimensions[disaggregationDimension] || "Unspecified";
      actualByDimension.set(category, (actualByDimension.get(category) || 0) + record.value);
    });

    const data = Array.from(actualByDimension.entries())
      .map(([category, value]) => ({ category, value }))
      .filter((entry) => entry.value > 0)
      .sort((left, right) => right.value - left.value)
      .slice(0, 12);

    if (data.length === 0) return null;

    return {
      kind: "bar",
      title: `${cleanLabel(disaggregationDimension)} comparison`,
      description: `Actual reported values grouped by ${cleanLabel(disaggregationDimension).toLowerCase()}.`,
      xKey: "category",
      yAxisLabel: "Number of people",
      data,
      series: [{ key: "value", label: "Value", color: CHART_COLORS[0] }],
      drilldownDimension: disaggregationDimension,
    };
  }

  const organizationMap = buildOrganizationMap(options.organizations);
  const recordOrgNameById = new Map(records.map((record) => [record.organizationId, record.organizationName]));
  const targetByGroup = new Map<string, number>();
  const actualByGroup = new Map<string, number>();

  const resolveGroupLabel = (organizationId: string, fallbackName?: string) => {
    if (options.mode === "coordinator") {
      return resolveCoordinatorLabelByOrganizationId(organizationId, organizationMap);
    }
    return fallbackName || organizationMap.get(organizationId)?.name || organizationId;
  };

  records.forEach((record) => {
    const label = resolveGroupLabel(record.organizationId, record.organizationName);
    actualByGroup.set(label, (actualByGroup.get(label) || 0) + record.value);
  });

  scopedOrgIds.forEach((organizationId) => {
    let orgTarget = 0;
    indicators.forEach((indicator) => {
      orgTarget += getTargetForIndicatorOrganization(indicator, organizationId, context);
    });
    const groupLabel = resolveGroupLabel(
      organizationId,
      recordOrgNameById.get(organizationId) || organizationMap.get(organizationId)?.name,
    );
    targetByGroup.set(groupLabel, (targetByGroup.get(groupLabel) || 0) + orgTarget);
  });

  const data = Array.from(new Set([...actualByGroup.keys(), ...targetByGroup.keys()]))
    .map((groupLabel) => ({
      category: groupLabel,
      actual: actualByGroup.get(groupLabel) || 0,
      target: targetByGroup.get(groupLabel) || 0,
    }))
    .sort((left, right) => Number(right.actual) - Number(left.actual))
    .slice(0, 12);

  if (data.length === 0) return null;

  return {
    kind: "grouped-bar",
    title: options.mode === "coordinator" ? "Coordinator comparison" : "Organization comparison",
    description:
      options.mode === "coordinator"
        ? "Actual reported values against configured targets for each coordinator in scope."
        : "Actual reported values against configured targets for each organization in scope.",
    xKey: "category",
    yAxisLabel: "Number of people",
    data,
    series: [
      { key: "actual", label: "Actual", color: CHART_COLORS[0] },
      { key: "target", label: "Target", color: CHART_COLORS[1] },
    ],
    drilldownDimension: options.mode,
  };
}

export function buildTable(
  records: NormalizedAggregateRecord[],
  rowDimensionKey: string,
  columnDimensionKey: string,
): VisualizationTable {
  return {
    matrix:
      records.length > 0
        ? buildConsolidatedMatrix({
            facts: buildFactTable(records),
            rowDimensionKey,
            columnDimensionKey,
          })
        : null,
    rawRows: buildRawRecords(buildFactTable(records)),
    rowDimensionKey,
    columnDimensionKey,
  };
}

export function recommendVisualization(input: {
  dimensions: string[];
  comparisonMode: AnalyticsFilterState["comparisonMode"];
  hasTrend: boolean;
  hasFunnel: boolean;
  chartMode?: VisualizationKind | "auto";
}) {
  if (input.chartMode && input.chartMode !== "auto") return input.chartMode;
  if (input.hasFunnel) return "funnel";
  if (input.hasTrend) return "trend";
  if (input.comparisonMode === "disaggregate" || input.comparisonMode === "disaggregation") return "bar";
  if (
    input.comparisonMode === "organization" ||
    input.comparisonMode === "coordinator" ||
    input.comparisonMode === "indicator"
  ) {
    return "grouped-bar";
  }
  if (input.dimensions.length >= 3) return "heatmap";
  if (input.dimensions.length === 2) return "stacked-bar";
  return "bar";
}

export function buildVisualizationResult(request: VisualizationRequest): VisualizationResult {
  const normalizedRecords = normalizeAggregateRecords({
    records: request.records,
    indicators: request.indicators,
    organizations: request.organizations,
    scopedOrgIds: request.scopedOrgIds,
    selectedPeriods: request.selectedPeriods,
    periodMode: request.periodMode,
    projectId: request.projectId,
    drilldownFilters: request.drilldownFilters,
  });
  const selectedIndicatorIds = request.indicatorId
    ? [String(request.indicatorId)]
    : Array.from(new Set(normalizedRecords.map((record) => record.indicatorId)));
  const dimensions = extractDimensions(normalizedRecords);
  const orderedDimensions =
    request.dimensions && request.dimensions.length > 0
      ? request.dimensions
      : dimensions.map((dimension) => dimension.key);
  const primaryDimension = orderedDimensions[0] || dimensions[0]?.key || "option";
  const secondaryDimension = orderedDimensions[1] || dimensions[1]?.key || "sex";
  const table = buildTable(normalizedRecords, primaryDimension, secondaryDimension);
  const kpi = buildKPI({
    records: normalizedRecords,
    scopedOrgIds: request.scopedOrgIds,
    selectedIndicatorIds,
    dimensions: orderedDimensions,
  });
  const disaggregationChart =
    orderedDimensions.length >= 3
      ? buildHeatmap(normalizedRecords, primaryDimension, secondaryDimension)
      : orderedDimensions.length >= 2
        ? buildStackedSeries(normalizedRecords, primaryDimension, secondaryDimension)
        : buildBarSeries(normalizedRecords, primaryDimension);
  const comparisonChart = buildComparisonChart(
    normalizedRecords,
    request.indicators,
    request.scopedOrgIds,
    {
      selectedPeriods: request.selectedPeriods,
      periodMode: request.periodMode,
      projectId: request.projectId,
    },
    {
      mode:
        request.comparisonMode === "coordinator"
          ? "coordinator"
          : request.comparisonMode === "indicator"
            ? "indicator"
            : request.comparisonMode === "disaggregate" || request.comparisonMode === "disaggregation"
              ? "disaggregation"
            : "organization",
      organizations: request.organizations,
      disaggregationDimension: primaryDimension,
    },
  );
  const trendChart = buildTrend(normalizedRecords);
  const funnelChart = buildFunnel(normalizedRecords, {
    disaggregationDimension: orderedDimensions[0],
    includeTargets: true,
  });
  const recommendation = recommendVisualization({
    dimensions: orderedDimensions,
    comparisonMode: request.comparisonMode,
    hasTrend: Boolean(trendChart),
    hasFunnel: Boolean(funnelChart),
    chartMode: request.chartMode,
  });

  let recommendedChart: VisualizationChart | null = null;
  if (recommendation === "funnel") recommendedChart = funnelChart;
  if (recommendation === "trend") recommendedChart = trendChart;
  if (recommendation === "grouped-bar") recommendedChart = comparisonChart;
  if (recommendation === "heatmap") recommendedChart = buildHeatmap(normalizedRecords, primaryDimension, secondaryDimension);
  if (recommendation === "stacked-bar") {
    recommendedChart = buildStackedSeries(normalizedRecords, primaryDimension, secondaryDimension);
  }
  if (recommendation === "bar") {
    recommendedChart =
      buildBarSeries(normalizedRecords, primaryDimension) ||
      comparisonChart ||
      trendChart ||
      disaggregationChart;
  }

  return {
    normalizedRecords,
    dimensions,
    kpis: kpi.cards,
    insights: kpi.insights,
    recommendedChart,
    overviewChart: recommendedChart,
    comparisonChart,
    disaggregationChart,
    trendChart,
    funnelChart,
    table,
    availableViews: ["overview", "disaggregation", "comparison", "trends", "table"],
  };
}
