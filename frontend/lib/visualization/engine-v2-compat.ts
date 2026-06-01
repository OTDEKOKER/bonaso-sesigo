// Compatibility wrapper for the v2 engine.
// It accepts the current AnalyticsFact-based request and returns the legacy visualization result shape.

import type {
  AnalyticsComparisonMode,
  AnalyticsFact,
  ConsolidatedMatrixData,
  RawAggregateRecord,
} from "../analytics/query-builder";
import type { AnalyticsScopeMode } from "../analytics/org-scope.ts";
import type { Indicator, Organization } from "../types.ts";
import type {
  DimensionSummary,
  NormalizedAggregateRecord as LegacyNormalizedAggregateRecord,
  VisualizationChart,
  VisualizationKpi,
  VisualizationRequest as LegacyVisualizationRequest,
  VisualizationResult as LegacyVisualizationResult,
  VisualizationTable,
} from "./engine.ts";
import {
  aggregateRecordToLegacyChart,
  mapLegacyFiltersToVisualizationRequest,
} from "./adapters.ts";
import {
  buildCascadeDataset,
  buildComparisonDataset,
  buildHeatmapDataset,
  buildStackedSeries,
  buildTargetVsAchievementDataset,
  buildTimeSeriesDataset,
  buildVisualizationEngine,
  sortDimensionValues,
  type NormalizedAggregateFact,
  type SeriesDatum,
  type VisualizationResult as VisualizationResultV2,
} from "./engine-v2.ts";

type LegacyCompatibleRequest = Omit<LegacyVisualizationRequest, "organizations" | "indicators"> & {
  organizations: Organization[];
  indicators: Indicator[];
  currentOrgId?: string | null;
  scopeMode?: AnalyticsScopeMode;
  parentOrgId?: string | null;
  selectedOrgIds?: string[];
};

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(
    Number.isFinite(value) ? value : 0,
  );
}

function cleanDimensionLabel(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function getDimensionValue(fact: NormalizedAggregateFact, dimension: string) {
  if (dimension === "organization") return fact.organizationName ?? "Unknown";
  if (dimension === "period") return fact.reportingPeriod ?? "Unknown";
  return fact.dimensions[dimension] ?? "Unknown";
}

function buildDimensionSummaries(
  facts: NormalizedAggregateFact[],
): DimensionSummary[] {
  const valuesByDimension = new Map<string, Set<string>>();

  facts.forEach((fact) => {
    Object.entries(fact.dimensions).forEach(([key, value]) => {
      const current = valuesByDimension.get(key) || new Set<string>();
      current.add(value || "Unknown");
      valuesByDimension.set(key, current);
    });
  });

  return Array.from(valuesByDimension.entries())
    .map(([key, values]) => {
      const distinctValues = Array.from(values).sort((left, right) =>
        left.localeCompare(right),
      );
      return {
        key,
        label: cleanDimensionLabel(key),
        distinctValues,
        distinctCount: distinctValues.length,
      };
    })
    .sort((left, right) => right.distinctCount - left.distinctCount);
}

function buildAnalyticsFactFromV2(
  fact: NormalizedAggregateFact,
): AnalyticsFact {
  const raw = fact.raw as Record<string, unknown>;
  if (raw.legacy_fact && typeof raw.legacy_fact === "object") {
    return raw.legacy_fact as AnalyticsFact;
  }

  return {
    aggregateId: fact.id,
    organizationId: fact.organizationId ?? "",
    organizationName: fact.organizationName ?? "Organization",
    indicatorId: fact.indicatorId ?? "",
    indicatorName: fact.indicatorName ?? "Indicator",
    projectId: fact.projectId ?? "",
    periodLabel: fact.reportingPeriod ?? "Unknown",
    periodStart: fact.reportingStartDate ?? "",
    periodEnd: fact.reportingEndDate ?? "",
    value: fact.value,
    disaggregates: fact.dimensions,
    notes: fact.notes ?? "",
  };
}

function buildLegacyNormalizedRecords(
  facts: NormalizedAggregateFact[],
): LegacyNormalizedAggregateRecord[] {
  return facts.map((fact, index) => ({
    key: fact.id || `v2-fact-${index}`,
    aggregateId: fact.id,
    indicatorId: fact.indicatorId ?? "",
    indicatorName: fact.indicatorName ?? "Indicator",
    organizationId: fact.organizationId ?? "",
    organizationName: fact.organizationName ?? "Organization",
    projectId: fact.projectId ?? "",
    periodLabel: fact.reportingPeriod ?? "Unknown",
    periodStart: fact.reportingStartDate ?? "",
    periodEnd: fact.reportingEndDate ?? "",
    value: fact.value,
    target: fact.target,
    achievementPercent:
      fact.target && fact.target > 0 ? (fact.value / fact.target) * 100 : null,
    dimensions: fact.dimensions,
    recordType: "value",
    source: buildAnalyticsFactFromV2(fact),
  }));
}

function buildLegacyInsights(
  facts: NormalizedAggregateFact[],
  dimensions: string[],
  warnings?: string[],
) {
  const insights = new Set<string>();

  if (dimensions[0]) {
    const byPrimary = new Map<string, number>();
    facts.forEach((fact) => {
      const key = getDimensionValue(fact, dimensions[0]);
      byPrimary.set(key, (byPrimary.get(key) ?? 0) + fact.value);
    });
    const top = [...byPrimary.entries()].sort((left, right) => right[1] - left[1])[0];
    if (top) {
      insights.add(
        `${cleanDimensionLabel(dimensions[0])} leader: ${top[0]} (${formatNumber(top[1])})`,
      );
    }
  }

  const byOrg = new Map<string, number>();
  facts.forEach((fact) => {
    const key = fact.organizationName ?? "Unknown";
    byOrg.set(key, (byOrg.get(key) ?? 0) + fact.value);
  });
  const topOrg = [...byOrg.entries()].sort((left, right) => right[1] - left[1])[0];
  if (topOrg) {
    insights.add(
      `Highest organization total: ${topOrg[0]} (${formatNumber(topOrg[1])})`,
    );
  }

  (warnings || []).forEach((warning) => insights.add(warning));
  return Array.from(insights);
}

export function buildLegacyCompatibleSummary(input: {
  facts: NormalizedAggregateFact[];
  scopedOrgIds: string[];
  selectedIndicatorIds: string[];
}): VisualizationKpi[] {
  const { facts, scopedOrgIds, selectedIndicatorIds } = input;
  const total = facts.reduce((sum, fact) => sum + fact.value, 0);
  const target = facts.reduce((sum, fact) => sum + (fact.target ?? 0), 0);
  const reportingOrganizations = new Set(
    facts.map((fact) => fact.organizationId).filter(Boolean),
  ).size;
  const completeness =
    scopedOrgIds.length > 0
      ? (reportingOrganizations / scopedOrgIds.length) * 100
      : 0;
  const highestOrganization = Array.from(
    facts.reduce((map, fact) => {
      const key = fact.organizationName ?? "Unknown";
      map.set(key, (map.get(key) ?? 0) + fact.value);
      return map;
    }, new Map<string, number>()).entries(),
  ).sort((left, right) => right[1] - left[1])[0];

  return [
    {
      key: "total",
      title: "Total reported",
      value: formatNumber(total),
      helper: `${reportingOrganizations} reporting organization${
        reportingOrganizations === 1 ? "" : "s"
      }`,
    },
    {
      key: "target",
      title: "Target",
      value: target > 0 ? formatNumber(target) : "No target",
      helper:
        target > 0
          ? `${((total / target) * 100).toFixed(1)}% achievement`
          : "Targets not configured",
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
  ];
}

function buildMatrix(input: {
  facts: NormalizedAggregateFact[];
  rowDimensionKey: string;
  columnDimensionKey: string;
}): ConsolidatedMatrixData | null {
  const { facts, rowDimensionKey, columnDimensionKey } = input;
  if (facts.length === 0) return null;

  const rowLabels = sortDimensionValues(
    Array.from(
      new Set(
        facts.map((fact) => getDimensionValue(fact, rowDimensionKey)).filter(Boolean),
      ),
    ),
    rowDimensionKey,
  );
  const columnLabels = sortDimensionValues(
    Array.from(
      new Set(
        facts
          .map((fact) => getDimensionValue(fact, columnDimensionKey))
          .filter(Boolean),
      ),
    ),
    columnDimensionKey,
  );

  if (rowLabels.length === 0 || columnLabels.length === 0) return null;

  const cellMap = new Map<string, number>();
  facts.forEach((fact) => {
    const rowLabel = getDimensionValue(fact, rowDimensionKey);
    const columnLabel = getDimensionValue(fact, columnDimensionKey);
    const key = `${rowLabel}::${columnLabel}`;
    cellMap.set(key, (cellMap.get(key) ?? 0) + fact.value);
  });

  const cells = rowLabels.map((rowLabel) =>
    columnLabels.map((columnLabel) => cellMap.get(`${rowLabel}::${columnLabel}`) ?? 0),
  );
  const rowTotals = cells.map((row) => row.reduce((sum, value) => sum + value, 0));
  const columnTotals = columnLabels.map((_, columnIndex) =>
    cells.reduce((sum, row) => sum + (row[columnIndex] ?? 0), 0),
  );
  const grandTotal = rowTotals.reduce((sum, value) => sum + value, 0);

  return {
    rowDimensionKey,
    columnDimensionKey,
    rowLabels,
    columnLabels,
    cells,
    rowTotals,
    columnTotals,
    grandTotal,
  };
}

function buildRawRows(facts: NormalizedAggregateFact[]): RawAggregateRecord[] {
  return facts.map((fact, index) => ({
    rowKey: `${fact.id}-${index}`,
    id: fact.id,
    organization: fact.organizationName ?? "Organization",
    indicator: fact.indicatorName ?? "Indicator",
    period: fact.reportingPeriod ?? "Unknown",
    disaggregationLabels: Object.entries(fact.dimensions)
      .map(([key, value]) => `${cleanDimensionLabel(key)}: ${value}`)
      .join(" | "),
    submittedValue: fact.value,
    notes: fact.notes ?? "",
  }));
}

function toStageKey(value: string | null | undefined) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_\s-]+/g, "_");
}

function addCascadeBreakdownToChart(input: {
  chart: VisualizationChart | null;
  facts: NormalizedAggregateFact[];
  disaggregationDimension?: string;
}) {
  const { chart, facts, disaggregationDimension } = input;
  if (!chart || (chart.kind !== "cascade" && chart.kind !== "funnel")) return chart;
  if (!disaggregationDimension || disaggregationDimension === "stage") return chart;

  const enhancedSteps = chart.steps.map((step) => {
    const matchingFacts = facts.filter(
      (fact) => toStageKey(fact.stage) === toStageKey(step.key),
    );
    if (matchingFacts.length === 0) return step;

    const breakdown = new Map<string, { value: number; target: number }>();
    matchingFacts.forEach((fact) => {
      const key = fact.dimensions[disaggregationDimension] || "Unspecified";
      const current = breakdown.get(key) || { value: 0, target: 0 };
      current.value += fact.value;
      current.target += fact.target ?? 0;
      breakdown.set(key, current);
    });

    return {
      ...step,
      breakdown: Array.from(breakdown.entries())
        .map(([key, values]) => ({
          key,
          label: key,
          value: values.value,
          targetValue: values.target > 0 ? values.target : undefined,
          sharePercent: step.value > 0 ? (values.value / step.value) * 100 : 0,
        }))
        .sort((left, right) => right.value - left.value),
    };
  });

  return {
    ...chart,
    kind: "cascade",
    steps: enhancedSteps,
  } as VisualizationChart;
}

export function buildLegacyCompatibleTable(input: {
  facts: NormalizedAggregateFact[];
  dimensions: string[];
}): VisualizationTable {
  const rowDimensionKey = input.dimensions[0] || "organization";
  const columnDimensionKey = input.dimensions[1] || "period";

  return {
    matrix: buildMatrix({
      facts: input.facts,
      rowDimensionKey,
      columnDimensionKey,
    }),
    rawRows: buildRawRows(input.facts),
    rowDimensionKey,
    columnDimensionKey,
  };
}

function sortSeriesData(
  data: SeriesDatum[],
  mode: "value-desc" | "dimension",
  dimension?: string,
) {
  if (mode === "value-desc") {
    return [...data].sort((left, right) => right.value - left.value);
  }

  const orderedNames = sortDimensionValues(
    data.map((item) => item.name),
    dimension || "",
  );
  const rank = new Map(orderedNames.map((name, index) => [name, index]));
  return [...data].sort((left, right) => {
    const leftRank = rank.get(left.name) ?? Number.MAX_SAFE_INTEGER;
    const rightRank = rank.get(right.name) ?? Number.MAX_SAFE_INTEGER;
    if (leftRank !== rightRank) return leftRank - rightRank;
    return left.name.localeCompare(right.name);
  });
}

function getRecommendedOptions(
  result: VisualizationResultV2,
  dimensions: string[],
): {
  chartType: string;
  chartProps: unknown;
  drilldownDimension?: string;
  secondaryDrilldownDimension?: string;
} {
  if (result.recommendedChart === "grouped-bar" || result.recommendedChart === "bar") {
    return {
      chartType: result.recommendedChart,
      chartProps: result.chartProps,
      drilldownDimension: dimensions[0] || "organization",
    };
  }

  if (result.recommendedChart === "stacked-bar") {
    return {
      chartType: "stacked-bar",
      chartProps: result.chartProps,
      drilldownDimension: dimensions[0] || "organization",
      secondaryDrilldownDimension: dimensions[1] || "period",
    };
  }

  if (result.recommendedChart === "heatmap") {
    return {
      chartType: "heatmap",
      chartProps: result.chartProps,
      drilldownDimension: dimensions[0] || "organization",
      secondaryDrilldownDimension: dimensions[1] || "period",
    };
  }

  if (result.recommendedChart === "line") {
    return {
      chartType: "line",
      chartProps: result.chartProps,
      drilldownDimension: "period",
    };
  }

  if (result.recommendedChart === "funnel") {
    return {
      chartType: "funnel",
      chartProps: result.chartProps,
    };
  }

  return {
    chartType: result.recommendedChart,
    chartProps: result.chartProps,
  };
}

export function buildLegacyCompatibleVisualization(input: {
  result: VisualizationResultV2;
  view: "overview" | "comparison" | "disaggregation" | "trends" | "funnel";
  dimensions: string[];
  comparisonMode: AnalyticsComparisonMode;
}): VisualizationChart | null {
  const { result, view, dimensions, comparisonMode } = input;

  if (view === "comparison") {
    const disaggregateDimension = dimensions[0] || "organization";
    const compareDimension =
      comparisonMode === "coordinator"
        ? "coordinator"
        : comparisonMode === "indicator"
          ? "indicator"
          : comparisonMode === "disaggregate"
            ? disaggregateDimension
          : "organization";
    const compareLabel =
      comparisonMode === "coordinator"
        ? "Coordinator"
        : comparisonMode === "indicator"
          ? "Indicator"
          : comparisonMode === "disaggregate"
            ? cleanDimensionLabel(disaggregateDimension)
          : "Organization";
    const rawDataset =
      comparisonMode === "organization" || comparisonMode === "coordinator" || comparisonMode === "indicator"
        ? ((result.comparisonChartProps as SeriesDatum[] | undefined) ?? [])
        : comparisonMode === "disaggregate"
          ? buildComparisonDataset(result.facts, compareDimension)
        : result.facts.some((fact) => fact.target !== null)
          ? buildTargetVsAchievementDataset(result.facts, compareDimension)
          : buildComparisonDataset(result.facts, compareDimension);
    const dataset = sortSeriesData(rawDataset, "value-desc");

    return aggregateRecordToLegacyChart({
      chartType:
        comparisonMode === "disaggregate"
          ? "bar"
          : result.facts.some((fact) => fact.target !== null)
            ? "grouped-bar"
            : "bar",
      chartProps: dataset,
      options: {
        title: `${compareLabel} comparison`,
        description:
          comparisonMode === "disaggregate"
            ? `Actual reported values grouped by ${compareLabel.toLowerCase()}.`
            : `Actual reported values against configured targets for each ${compareLabel.toLowerCase()} in scope.`,
        drilldownDimension: compareDimension,
      },
    });
  }

  if (view === "disaggregation") {
    if (dimensions.length >= 3) {
      return aggregateRecordToLegacyChart({
        chartType: "heatmap",
        chartProps:
          result.heatmapProps ||
          buildHeatmapDataset(result.facts, dimensions[0], dimensions[1]),
        options: {
          title: `${cleanDimensionLabel(dimensions[0])} x ${cleanDimensionLabel(dimensions[1])}`,
          description:
            "Heatmap of reported values across the selected disaggregation dimensions.",
          drilldownDimension: dimensions[0],
          secondaryDrilldownDimension: dimensions[1],
        },
      });
    }

    if (dimensions.length >= 2) {
      return aggregateRecordToLegacyChart({
        chartType: "stacked-bar",
        chartProps: buildStackedSeries(result.facts, dimensions[0], dimensions[1]),
        options: {
          title: `${cleanDimensionLabel(dimensions[0])} by ${cleanDimensionLabel(dimensions[1])}`,
          description:
            "Stacked composition of the selected disaggregation dimensions.",
          drilldownDimension: dimensions[0],
          secondaryDrilldownDimension: dimensions[1],
        },
      });
    }

    if (dimensions.length === 1) {
      const dataset = sortSeriesData(
        buildComparisonDataset(result.facts, dimensions[0]),
        "dimension",
        dimensions[0],
      );

      return aggregateRecordToLegacyChart({
        chartType: "bar",
        chartProps: dataset,
        options: {
          title: `${cleanDimensionLabel(dimensions[0])} distribution`,
          description: "Reported values grouped by the selected disaggregation dimension.",
          drilldownDimension: dimensions[0],
        },
      });
    }

    return null;
  }

  if (view === "trends") {
    return aggregateRecordToLegacyChart({
      chartType: "line",
      chartProps: result.trendChartProps || buildTimeSeriesDataset(result.facts),
      options: {
        title: "Trend over time",
        description: "Period-by-period movement for the selected indicators.",
        drilldownDimension: "period",
      },
    });
  }

  if (view === "funnel") {
    const chart = aggregateRecordToLegacyChart({
      chartType: "funnel",
      chartProps: result.funnelProps || buildCascadeDataset(result.facts),
      options: {
        title: "Program cascade",
        description: "Stage-to-stage progression for matched cascade indicators.",
      },
    });
    return addCascadeBreakdownToChart({
      chart,
      facts: result.facts,
      disaggregationDimension: dimensions[0],
    });
  }

  const recommendation = getRecommendedOptions(result, dimensions);
  const overviewChartType =
    dimensions.length === 1 && recommendation.chartType === "grouped-bar"
      ? "bar"
      : recommendation.chartType;
  const overviewChartProps =
    dimensions.length === 1 && recommendation.chartType === "grouped-bar"
      ? sortSeriesData(buildComparisonDataset(result.facts, dimensions[0]), "dimension", dimensions[0])
      : recommendation.chartType === "grouped-bar" || recommendation.chartType === "bar"
        ? sortSeriesData((recommendation.chartProps as SeriesDatum[] | undefined) ?? [], "value-desc")
        : recommendation.chartProps;

  return aggregateRecordToLegacyChart({
    chartType: overviewChartType as never,
    chartProps: overviewChartProps,
    options: {
      title: "Overview",
      description: "Automatically selected chart for the current reporting configuration.",
      drilldownDimension: recommendation.drilldownDimension,
      secondaryDrilldownDimension: recommendation.secondaryDrilldownDimension,
    },
  });
}

export function buildVisualizationResultV2Compat(
  request: LegacyCompatibleRequest,
): LegacyVisualizationResult {
  const organizationsById = new Map(
    request.organizations.map((organization) => [String(organization.id), organization]),
  );
  const indicatorsById = new Map(
    request.indicators.map((indicator) => [String(indicator.id), indicator]),
  );
  const v2Request = mapLegacyFiltersToVisualizationRequest({
    facts: request.records,
    scopeMode: request.scopeMode || "all_orgs",
    comparisonMode: request.comparisonMode,
    periodMode: request.periodMode,
    disaggregationKeys: request.dimensions,
    selectedParentOrgId: request.parentOrgId || undefined,
    selectedOrgIds: request.selectedOrgIds,
    currentOrgId: request.currentOrgId || undefined,
    indicatorId: request.indicatorId ?? undefined,
    chartMode: request.chartMode || "auto",
    lookups: {
      organizationsById,
      indicatorsById,
      selectedPeriods: request.selectedPeriods,
      periodMode: request.periodMode,
      projectId: request.projectId,
      drilldownFilters: request.drilldownFilters,
    },
  });

  const v2Result = buildVisualizationEngine(v2Request);
  const normalizedRecords = buildLegacyNormalizedRecords(v2Result.facts);
  const dimensions = buildDimensionSummaries(v2Result.facts);
  const orderedDimensions =
    request.dimensions && request.dimensions.length > 0
      ? request.dimensions
      : dimensions.map((dimension) => dimension.key);
  const selectedIndicatorIds = request.indicatorId
    ? [String(request.indicatorId)]
    : Array.from(
        new Set(v2Result.facts.map((fact) => fact.indicatorId).filter(Boolean) as string[]),
      );

  const table = buildLegacyCompatibleTable({
    facts: v2Result.facts,
    dimensions: orderedDimensions,
  });
  const kpis = buildLegacyCompatibleSummary({
    facts: v2Result.facts,
    scopedOrgIds: request.scopedOrgIds,
    selectedIndicatorIds,
  });
  const overviewChart = buildLegacyCompatibleVisualization({
    result: v2Result,
    view: "overview",
    dimensions: orderedDimensions,
    comparisonMode: request.comparisonMode,
  });
  const comparisonChart = buildLegacyCompatibleVisualization({
    result: v2Result,
    view: "comparison",
    dimensions: orderedDimensions,
    comparisonMode: request.comparisonMode,
  });
  const disaggregationChart = buildLegacyCompatibleVisualization({
    result: v2Result,
    view: "disaggregation",
    dimensions: orderedDimensions,
    comparisonMode: request.comparisonMode,
  });
  const trendChart = buildLegacyCompatibleVisualization({
    result: v2Result,
    view: "trends",
    dimensions: orderedDimensions,
    comparisonMode: request.comparisonMode,
  });
  const funnelChart = buildLegacyCompatibleVisualization({
    result: v2Result,
    view: "funnel",
    dimensions: orderedDimensions,
    comparisonMode: request.comparisonMode,
  });

  return {
    normalizedRecords,
    dimensions,
    kpis,
    insights: buildLegacyInsights(
      v2Result.facts,
      orderedDimensions,
      v2Result.warnings,
    ),
    recommendedChart: overviewChart,
    overviewChart,
    comparisonChart,
    disaggregationChart,
    trendChart,
    funnelChart,
    table,
    availableViews: ["overview", "disaggregation", "comparison", "trends", "table"],
  };
}
