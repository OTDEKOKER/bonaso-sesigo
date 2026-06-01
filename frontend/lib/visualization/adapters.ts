import type {
  AnalyticsComparisonMode,
  AnalyticsFact,
  AnalyticsPeriodMode,
} from "../analytics/query-builder";
import type { AnalyticsScopeMode } from "../analytics/org-scope.ts";
import { normalizeOrganizationType } from "../organization-hierarchy.ts";
import type { Indicator, Organization } from "../types.ts";
import type {
  AggregateRecord,
  ChartType as VisualizationChartTypeV2,
  ComparisonMode as VisualizationComparisonModeV2,
  PeriodMode as VisualizationPeriodModeV2,
  SeriesDatum,
} from "./engine-v2.ts";
import type {
  FunnelChart,
  HeatmapChart,
  VisualizationChart as LegacyVisualizationChart,
} from "./engine.ts";

const LEGACY_CHART_COLORS = [
  "#1f6a8a",
  "#e67e22",
  "#2e8b57",
  "#9c2f92",
  "#f2b134",
  "#4472c4",
  "#0f4258",
  "#d1495b",
] as const;

type AdapterLookupOptions = {
  organizationsById?: Map<string, Organization>;
  indicatorsById?: Map<string, Indicator>;
  selectedPeriods?: string[];
  periodMode?: AnalyticsPeriodMode;
  projectId?: string | null;
  drilldownFilters?: Record<string, string[]>;
};

type LegacyFilterMappingInput = {
  facts: AnalyticsFact[];
  scopeMode: AnalyticsScopeMode;
  comparisonMode: AnalyticsComparisonMode;
  periodMode: AnalyticsPeriodMode;
  disaggregationKeys?: string[];
  selectedParentOrgId?: string;
  selectedOrgIds?: string[];
  currentOrgId?: string;
  indicatorId?: string | null;
  indicatorName?: string;
  chartMode?:
    | "auto"
    | "bar"
    | "grouped-bar"
    | "stacked-bar"
    | "heatmap"
    | "funnel"
    | "cascade"
    | "trend"
    | "table"
    | "kpi";
  lookups?: AdapterLookupOptions;
};

type LegacyChartAdapterOptions = {
  title: string;
  description: string;
  drilldownDimension?: string;
  secondaryDrilldownDimension?: string;
};

const FUNNEL_STAGE_PATTERNS = [
  { stage: "screened", patterns: [/test/i, /screen/i] },
  { stage: "counselling", patterns: [/counsel/i, /psychoeducation/i] },
  { stage: "referred", patterns: [/refer/i] },
  { stage: "treated", patterns: [/treat/i, /initiat/i] },
] as const;

function inferPeriodModeFromLabel(label: string): AnalyticsPeriodMode {
  if (/^Q[1-4]\s+\d{4}(?:\/\d{2,4})?$/i.test(label)) return "quarter";
  if (/^[A-Za-z]{3,9}\s+\d{4}$/i.test(label)) return "month";
  if (/^\d{4}$/.test(label)) return "year";
  return "date-range";
}

function mapPeriodMode(mode: AnalyticsPeriodMode): VisualizationPeriodModeV2 {
  if (mode === "month") return "monthly";
  if (mode === "year") return "yearly";
  if (mode === "date-range") return "custom";
  return "quarterly";
}

function mapComparisonMode(
  mode: AnalyticsComparisonMode,
): VisualizationComparisonModeV2 {
  if (mode === "organization") return "organization";
  if (mode === "coordinator") return "coordinator";
  if (mode === "indicator") return "indicator";
  if (mode === "disaggregate") return "disaggregate";
  if (mode === "period") return "period";
  return "none";
}

function mapChartMode(
  mode?: LegacyFilterMappingInput["chartMode"],
): "auto" | VisualizationChartTypeV2 {
  if (!mode || mode === "auto") return "auto";
  if (mode === "trend") return "line";
  if (mode === "cascade") return "funnel";
  return mode;
}

function toSafeNumber(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const numeric = Number(value.replace(/,/g, "").trim());
    return Number.isFinite(numeric) ? numeric : 0;
  }
  return 0;
}

function parseQuarterFromLabel(label: string): 1 | 2 | 3 | 4 | null {
  const match = String(label || "")
    .trim()
    .match(/^Q([1-4])\s+\d{4}(?:\/\d{2,4})?$/i);
  if (!match) return null;
  return Number(match[1]) as 1 | 2 | 3 | 4;
}

function resolveCoordinatorLabel(
  fact: AnalyticsFact,
  organizationsById?: Map<string, Organization>,
) {
  if (!organizationsById) return "Unassigned coordinator";

  const initialOrganization = organizationsById.get(String(fact.organizationId));
  if (!initialOrganization) return "Unassigned coordinator";

  let cursor: Organization | undefined = initialOrganization;
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
    cursor = organizationsById.get(String(cursor.parentId));
  }

  return "Unassigned coordinator";
}

function getIndicatorTargetForFact(
  indicator: Indicator | undefined,
  fact: AnalyticsFact,
  options?: AdapterLookupOptions,
) {
  if (!indicator?.project_targets?.length) return null;
  const selectedPeriods = options?.selectedPeriods?.length
    ? options.selectedPeriods
    : [fact.periodLabel];
  const periodMode =
    options?.periodMode || inferPeriodModeFromLabel(fact.periodLabel);
  const projectId = options?.projectId ?? fact.projectId ?? null;

  const matchingTargets = indicator.project_targets.filter((target) => {
    if (projectId && String(target.project) !== String(projectId)) return false;
    return String(target.organization) === fact.organizationId;
  });

  if (matchingTargets.length === 0) return null;

  return matchingTargets.reduce((sum, target) => {
    if (periodMode === "quarter") {
      return (
        sum +
        selectedPeriods.reduce((periodSum, periodLabel) => {
          const quarter = parseQuarterFromLabel(periodLabel);
          if (!quarter) return periodSum;
          const value =
            quarter === 1
              ? target.q1_target
              : quarter === 2
                ? target.q2_target
                : quarter === 3
                  ? target.q3_target
                  : target.q4_target;
          return periodSum + toSafeNumber(value);
        }, 0)
      );
    }
    return sum + toSafeNumber(target.target_value);
  }, 0);
}

function passesDrilldownFilters(
  fact: AnalyticsFact,
  filters: Record<string, string[]> = {},
  options?: AdapterLookupOptions,
) {
  return Object.entries(filters).every(([dimension, selectedValues]) => {
    if (!selectedValues.length) return true;
    if (dimension === "organization") {
      return (
        selectedValues.includes(fact.organizationId) ||
        selectedValues.includes(fact.organizationName)
      );
    }
    if (dimension === "coordinator") {
      const coordinator = resolveCoordinatorLabel(fact, options?.organizationsById);
      return selectedValues.includes(coordinator);
    }
    if (dimension === "indicator") {
      return (
        selectedValues.includes(fact.indicatorId) ||
        selectedValues.includes(fact.indicatorName)
      );
    }
    if (dimension === "period") {
      return selectedValues.includes(fact.periodLabel);
    }
    if (dimension === "stage") {
      const inferredStage = inferStageFromFact(fact);
      if (!inferredStage) return false;
      const normalizedSelections = selectedValues.map((value) => value.toLowerCase());
      const source = `${inferredStage} ${fact.indicatorName} ${fact.notes || ""}`.toLowerCase();
      return normalizedSelections.some((selection) => source.includes(selection));
    }
    return selectedValues.includes(fact.disaggregates[dimension]);
  });
}

function buildTargetSeriesData(data: SeriesDatum[]) {
  return data.map((item) => ({
    category: item.name,
    actual: item.value,
    target: item.target ?? 0,
  }));
}

function buildColor(index: number) {
  return LEGACY_CHART_COLORS[index % LEGACY_CHART_COLORS.length];
}

function inferStageFromFact(fact: AnalyticsFact) {
  const explicitStage = fact.disaggregates.stage || fact.disaggregates.flow_stage;
  if (explicitStage) return explicitStage;

  const source = `${fact.indicatorName} ${fact.notes || ""}`.toLowerCase();
  return (
    FUNNEL_STAGE_PATTERNS.find((entry) =>
      entry.patterns.some((pattern) => pattern.test(source)),
    )?.stage ?? null
  );
}

function buildLegacyHeatmap(
  chartProps: {
    x: string[];
    y: string[];
    data: Array<{ x: string; y: string; value: number }>;
  },
  options: LegacyChartAdapterOptions,
): HeatmapChart {
  const cells = chartProps.y.map((rowLabel) =>
    chartProps.x.map((columnLabel) => {
      const match = chartProps.data.find(
        (datum) => datum.x === columnLabel && datum.y === rowLabel,
      );
      return match?.value ?? 0;
    }),
  );

  return {
    kind: "heatmap",
    title: options.title,
    description: options.description,
    xDimension: options.secondaryDrilldownDimension || "column",
    yDimension: options.drilldownDimension || "row",
    xLabels: chartProps.x,
    yLabels: chartProps.y,
    cells,
    sourceEngine: "v2",
  } as HeatmapChart;
}

function buildLegacyFunnel(
  chartProps: SeriesDatum[],
  options: LegacyChartAdapterOptions,
): FunnelChart | null {
  if (!Array.isArray(chartProps) || chartProps.length === 0) return null;

  const steps = chartProps.map((item, index) => {
    const previousValue =
      index === 0 ? item.value : chartProps[index - 1]?.value ?? item.value;
    const previousTarget =
      index === 0 ? item.target ?? 0 : chartProps[index - 1]?.target ?? item.target ?? 0;
    const stageOneValue = chartProps[0]?.value ?? item.value;
    const stageOneTarget = chartProps[0]?.target ?? item.target ?? 0;
    const retentionPercent =
      stageOneValue > 0 ? (item.value / stageOneValue) * 100 : 0;
    const conversionPercent =
      index === 0 ? null : previousValue > 0 ? (item.value / previousValue) * 100 : 0;
    const targetConversionPercent =
      index === 0
        ? null
        : previousTarget > 0
          ? ((item.target ?? 0) / previousTarget) * 100
          : 0;
    const targetRetentionPercent =
      stageOneTarget > 0 ? ((item.target ?? 0) / stageOneTarget) * 100 : null;
    const dropoffPercent =
      index === 0 || previousValue <= 0
        ? 0
        : Math.max(0, 100 - (item.value / previousValue) * 100);

    return {
      key: item.name.toLowerCase().replace(/\s+/g, "_"),
      label: item.name,
      value: item.value,
      retentionPercent,
      conversionPercent,
      dropoffPercent,
      targetValue: item.target ?? undefined,
      targetRetentionPercent,
      targetConversionPercent,
    };
  });

  return {
    kind: "cascade",
    title: options.title,
    description: options.description,
    steps,
    sourceEngine: "v2",
  } as FunnelChart;
}

export function analyticsFactToAggregateRecord(
  fact: AnalyticsFact,
  options?: AdapterLookupOptions,
): AggregateRecord {
  const organization = options?.organizationsById?.get(String(fact.organizationId));
  const indicator = options?.indicatorsById?.get(String(fact.indicatorId));
  const target = getIndicatorTargetForFact(indicator, fact, options);
  const coordinator = resolveCoordinatorLabel(fact, options?.organizationsById);

  return {
    id: fact.aggregateId,
    project_id: fact.projectId,
    indicator_id: fact.indicatorId,
    indicator_name: fact.indicatorName,
    organization_id: fact.organizationId,
    organization_name: fact.organizationName,
    organization_type: organization?.type ?? null,
    parent_organization_id: organization?.parentId ?? null,
    parent_organization_name: organization?.parentId
      ? options?.organizationsById?.get(String(organization.parentId))?.name ?? null
      : null,
    reporting_period: fact.periodLabel,
    reporting_period_type: mapPeriodMode(
      options?.periodMode || inferPeriodModeFromLabel(fact.periodLabel),
    ),
    reporting_start_date: fact.periodStart,
    reporting_end_date: fact.periodEnd,
    value: fact.value,
    target,
    stage: inferStageFromFact(fact),
    notes: fact.notes ?? null,
    disaggregations: {
      ...fact.disaggregates,
      coordinator,
    },
    legacy_fact: fact,
    legacy_aggregate_id: fact.aggregateId,
  };
}

export function analyticsFactsToAggregateRecords(
  facts: AnalyticsFact[],
  options?: AdapterLookupOptions,
): AggregateRecord[] {
  const seenAggregateTargets = new Set<string>();

  return facts
    .filter((fact) => passesDrilldownFilters(fact, options?.drilldownFilters, options))
    .map((fact) => {
      const record = analyticsFactToAggregateRecord(fact, options);
      const aggregateKey = String(fact.aggregateId || "");
      if (aggregateKey && seenAggregateTargets.has(aggregateKey)) {
        record.target = null;
      } else if (aggregateKey) {
        seenAggregateTargets.add(aggregateKey);
      }
      return record;
    });
}

export function mapLegacyFiltersToVisualizationRequest(
  input: LegacyFilterMappingInput,
) {
  const records = analyticsFactsToAggregateRecords(input.facts, input.lookups);
  const selectedDimensions = (input.disaggregationKeys || []).filter(Boolean);
  const availableDimensions = Array.from(
    new Set(
      records.flatMap((record) =>
        Object.keys(record.disaggregations || {}).filter(Boolean),
      ),
    ),
  );

  return {
    indicatorId: input.indicatorId ?? undefined,
    indicatorName: input.indicatorName,
    records,
    availableDimensions,
    selectedDimensions,
    comparisonMode: mapComparisonMode(input.comparisonMode),
    hierarchyScope: input.scopeMode,
    selectedParentOrgId: input.selectedParentOrgId,
    selectedOrgIds: input.selectedOrgIds,
    currentOrgId: input.currentOrgId,
    periodMode: mapPeriodMode(input.periodMode),
    chartMode: mapChartMode(input.chartMode),
  };
}

export function aggregateRecordToLegacyChart(input: {
  chartType: VisualizationChartTypeV2;
  chartProps: unknown;
  options: LegacyChartAdapterOptions;
}): LegacyVisualizationChart | null {
  const { chartType, chartProps, options } = input;

  if (chartType === "kpi" || chartType === "table") return null;

  if (chartType === "heatmap") {
    if (
      !chartProps ||
      typeof chartProps !== "object" ||
      !Array.isArray((chartProps as { x?: unknown[] }).x) ||
      !Array.isArray((chartProps as { y?: unknown[] }).y) ||
      !Array.isArray((chartProps as { data?: unknown[] }).data)
    ) {
      return null;
    }
    return buildLegacyHeatmap(
      chartProps as {
        x: string[];
        y: string[];
        data: Array<{ x: string; y: string; value: number }>;
      },
      options,
    );
  }

  if (chartType === "funnel") {
    return buildLegacyFunnel((chartProps as SeriesDatum[]) ?? [], options);
  }

  if (chartType === "line") {
    const data = Array.isArray(chartProps) ? (chartProps as SeriesDatum[]) : [];
    if (!data.length) return null;
    return {
      kind: "trend",
      title: options.title,
      description: options.description,
      xKey: "period",
      yAxisLabel: "Number of people",
      data: data.map((item) => ({ period: item.name, value: item.value })),
      series: [{ key: "value", label: "Value", color: buildColor(0) }],
      drilldownDimension: options.drilldownDimension,
      sourceEngine: "v2",
    } as LegacyVisualizationChart;
  }

  if (chartType === "stacked-bar") {
    const stacked = chartProps as {
      categories?: string[];
      series?: Array<{ name: string; data: number[] }>;
    };
    if (!Array.isArray(stacked?.categories) || !Array.isArray(stacked?.series)) {
      return null;
    }

    const data = stacked.categories.map((category, categoryIndex) => {
      const row: Record<string, string | number> = { category };
      stacked.series?.forEach((series) => {
        row[series.name] = series.data[categoryIndex] ?? 0;
      });
      return row;
    });

    return {
      kind: "stacked-bar",
      title: options.title,
      description: options.description,
      xKey: "category",
      yAxisLabel: "Number of people",
      data,
      series: (stacked.series || []).map((series, index) => ({
        key: series.name,
        label: series.name,
        color: buildColor(index),
        stackId: "stack",
      })),
      drilldownDimension: options.drilldownDimension,
      secondaryDrilldownDimension: options.secondaryDrilldownDimension,
      sourceEngine: "v2",
    } as LegacyVisualizationChart;
  }

  const seriesData = Array.isArray(chartProps) ? (chartProps as SeriesDatum[]) : [];
  if (!seriesData.length) return null;

  const hasTarget = seriesData.some((item) => item.target != null);
  if (chartType === "grouped-bar" || hasTarget) {
    return {
      kind: "grouped-bar",
      title: options.title,
      description: options.description,
      xKey: "category",
      yAxisLabel: "Number of people",
      data: buildTargetSeriesData(seriesData),
      series: [
        { key: "actual", label: "Actual", color: buildColor(0) },
        { key: "target", label: "Target", color: buildColor(1) },
      ],
      drilldownDimension: options.drilldownDimension,
      sourceEngine: "v2",
    } as LegacyVisualizationChart;
  }

  return {
    kind: "bar",
    title: options.title,
    description: options.description,
    xKey: "category",
    yAxisLabel: "Number of people",
    data: seriesData.map((item) => ({ category: item.name, value: item.value })),
    series: [{ key: "value", label: "Value", color: buildColor(0) }],
    drilldownDimension: options.drilldownDimension,
    sourceEngine: "v2",
  } as LegacyVisualizationChart;
}
