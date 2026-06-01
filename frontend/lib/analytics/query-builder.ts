import type { Aggregate, Indicator, Organization } from "../types";
import {
  getAggregateValueDisaggregateRows,
  toSafeAggregateNumber,
} from "../aggregates/disaggregate-normalization.ts";
import {
  getAggregatePeriodLabel,
  type AggregatePeriodMode,
} from "../aggregates/quarter-buckets.ts";
import { resolveIndicatorIdString } from "../indicators/id-aliases.ts";
import type { AnalyticsScopeMode } from "./org-scope.ts";

export type AnalyticsPeriodMode = "date-range" | "month" | "quarter" | "year";
export type AnalyticsComparisonMode =
  | "none"
  | "period"
  | "organization"
  | "coordinator"
  | "indicator"
  | "disaggregate"
  | "disaggregation";
export type AnalyticsChartType =
  | "kpi"
  | "bar"
  | "stacked-bar"
  | "line"
  | "area"
  | "pie"
  | "donut"
  | "table"
  | "matrix"
  | "heatmap"
  | "progress";
export type AnalyticsAggregationMode = "sum" | "average" | "count" | "latest";

export type AnalyticsQueryContract = {
  project_id?: string | null;
  reporting_period_id?: string | null;
  selected_periods?: string[];
  period_mode?: AnalyticsPeriodMode;
  date_from?: string | null;
  date_to?: string | null;
  scope_mode: AnalyticsScopeMode;
  parent_org_id?: string | null;
  selected_org_ids?: string[];
  indicator_id?: string | null;
  indicator_ids?: string[];
  chart_type?: AnalyticsChartType;
  aggregation?: AnalyticsAggregationMode;
  group_by?: string | null;
  stack_by?: string | null;
  comparison_mode?: AnalyticsComparisonMode;
  disaggregation_keys?: string[];
  cascade_organization?: boolean;
};

export type AnalyticsFact = {
  aggregateId: string;
  organizationId: string;
  organizationName: string;
  indicatorId: string;
  indicatorName: string;
  projectId: string;
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  value: number;
  disaggregates: Record<string, string>;
  notes?: string;
};

export type AnalyticsKpiSummary = {
  totalReportedValue: number;
  organizationsReporting: number;
  reportingCompletenessRate: number;
  missingOrganizations: number;
  selectedIndicatorsCount: number;
};

export type OrganizationBreakdownRow = {
  organizationId: string;
  organizationName: string;
  totalValue: number;
  contributionPercent: number;
};

export type ReportingCompletenessSummary = {
  submittedOrgIds: string[];
  missingOrgIds: string[];
  submittedCount: number;
  missingCount: number;
  submittedPercent: number;
  missingPercent: number;
};

export type RawAggregateRecord = {
  rowKey: string;
  id: string;
  organization: string;
  indicator: string;
  period: string;
  disaggregationLabels: string;
  submittedValue: number;
  notes: string;
};

export type ConsolidatedMatrixData = {
  rowDimensionKey: string;
  columnDimensionKey: string;
  rowLabels: string[];
  columnLabels: string[];
  cells: number[][];
  rowTotals: number[];
  columnTotals: number[];
  grandTotal: number;
};

const getAggregateTotal = (value: unknown) => {
  if (typeof value === "number" || typeof value === "string") return toSafeAggregateNumber(value);
  if (!value || typeof value !== "object") return 0;
  const source = value as Record<string, unknown>;
  if (source.total !== undefined) return toSafeAggregateNumber(source.total);
  if (source.value !== undefined) return toSafeAggregateNumber(source.value);
  if (source.male !== undefined || source.female !== undefined) {
    return toSafeAggregateNumber(source.male) + toSafeAggregateNumber(source.female);
  }
  return 0;
};

const parsePeriodMode = (mode?: AnalyticsPeriodMode): AggregatePeriodMode => {
  if (mode === "month") return "month";
  if (mode === "year") return "year";
  return "quarter";
};

const getDateRangeBounds = (
  dateFrom?: string | null,
  dateTo?: string | null,
): { from?: Date; to?: Date } => {
  const from = dateFrom ? new Date(dateFrom) : undefined;
  const to = dateTo ? new Date(dateTo) : undefined;
  return {
    from: from && !Number.isNaN(from.getTime()) ? from : undefined,
    to: to && !Number.isNaN(to.getTime()) ? to : undefined,
  };
};

const getIndicatorDisaggregateKeys = (indicator?: Indicator | null): string[] => {
  if (!indicator?.aggregate_disaggregation_config?.dimensions) return [];
  return indicator.aggregate_disaggregation_config.dimensions
    .map((dimension) => String(dimension.key || "").trim())
    .filter(Boolean);
};

const flattenDisaggregateFacts = (input: {
  aggregate: Aggregate;
  indicator?: Indicator | null;
  periodLabel: string;
  indicatorName: string;
  organizationName: string;
}): AnalyticsFact[] => {
  const { aggregate, indicator, periodLabel, indicatorName, organizationName } = input;
  if (!aggregate.value || typeof aggregate.value !== "object") {
    return [
      {
        aggregateId: String(aggregate.id),
        organizationId: String(aggregate.organization),
        organizationName,
        indicatorId: String(aggregate.indicator),
        indicatorName,
        projectId: String(aggregate.project),
        periodLabel,
        periodStart: aggregate.period_start,
        periodEnd: aggregate.period_end,
        value: getAggregateTotal(aggregate.value),
        disaggregates: {},
        notes: aggregate.notes || "",
      },
    ];
  }

  const normalizedRows = getAggregateValueDisaggregateRows(aggregate.value);
  if (normalizedRows.length === 0) {
    return [
      {
        aggregateId: String(aggregate.id),
        organizationId: String(aggregate.organization),
        organizationName,
        indicatorId: String(aggregate.indicator),
        indicatorName,
        projectId: String(aggregate.project),
        periodLabel,
        periodStart: aggregate.period_start,
        periodEnd: aggregate.period_end,
        value: getAggregateTotal(aggregate.value),
        disaggregates: {},
        notes: aggregate.notes || "",
      },
    ];
  }

  const configuredKeys = getIndicatorDisaggregateKeys(indicator);
  const firstKey = configuredKeys[0] || "option";
  const secondKey = configuredKeys[1] || "sex";
  const thirdKey = configuredKeys[2] || "age_range";
  const facts: AnalyticsFact[] = [];
  normalizedRows.forEach((row) => {
    facts.push({
      aggregateId: String(aggregate.id),
      organizationId: String(aggregate.organization),
      organizationName,
      indicatorId: String(aggregate.indicator),
      indicatorName,
      projectId: String(aggregate.project),
      periodLabel,
      periodStart: aggregate.period_start,
      periodEnd: aggregate.period_end,
      value: row.value,
      disaggregates: {
        [firstKey]: row.first || "Unspecified",
        [secondKey]: row.second || "Unspecified",
        [thirdKey]: row.third || "Unspecified",
      },
      notes: aggregate.notes || "",
    });
  });

  if (facts.length === 0) {
    return [
      {
        aggregateId: String(aggregate.id),
        organizationId: String(aggregate.organization),
        organizationName,
        indicatorId: String(aggregate.indicator),
        indicatorName,
        projectId: String(aggregate.project),
        periodLabel,
        periodStart: aggregate.period_start,
        periodEnd: aggregate.period_end,
        value: getAggregateTotal(aggregate.value),
        disaggregates: {},
        notes: aggregate.notes || "",
      },
    ];
  }

  return facts;
};

export function buildAnalyticsFacts(input: {
  aggregates: Aggregate[];
  organizationsById: Map<string, Organization>;
  indicatorsById: Map<string, Indicator>;
  query: AnalyticsQueryContract;
  scopedOrgIds: string[];
}): AnalyticsFact[] {
  const {
    aggregates,
    organizationsById,
    indicatorsById,
    query,
    scopedOrgIds,
  } = input;
  const scopedSet = new Set(scopedOrgIds.map(String));
  const indicatorIds = (query.indicator_ids || [])
    .map((indicatorId) => resolveIndicatorIdString(indicatorId))
    .filter(Boolean);
  if (query.indicator_id) indicatorIds.push(resolveIndicatorIdString(query.indicator_id));
  const indicatorSet = new Set(indicatorIds);
  const selectedPeriods = new Set(
    [query.reporting_period_id || "", ...(query.selected_periods || [])]
      .map((value) => String(value).trim())
      .filter(Boolean),
  );
  const periodMode = parsePeriodMode(query.period_mode);
  const dateBounds = getDateRangeBounds(query.date_from, query.date_to);

  return aggregates.flatMap((aggregate) => {
    if (query.project_id && String(aggregate.project) !== String(query.project_id)) return [];
    if (!scopedSet.has(String(aggregate.organization))) return [];
    if (indicatorSet.size > 0 && !indicatorSet.has(resolveIndicatorIdString(aggregate.indicator))) return [];

    const aggregateStart = new Date(aggregate.period_start);
    const aggregateEnd = new Date(aggregate.period_end || aggregate.period_start);
    if (dateBounds.from && !Number.isNaN(aggregateEnd.getTime()) && aggregateEnd < dateBounds.from) {
      return [];
    }
    if (dateBounds.to && !Number.isNaN(aggregateStart.getTime()) && aggregateStart > dateBounds.to) {
      return [];
    }

    const periodLabel =
      query.period_mode === "date-range"
        ? query.reporting_period_id || "Selected Range"
        : getAggregatePeriodLabel(aggregate, periodMode) || "Unspecified Period";
    if (selectedPeriods.size > 0 && !selectedPeriods.has(periodLabel)) return [];

    const indicator = indicatorsById.get(String(aggregate.indicator));
    const organization = organizationsById.get(String(aggregate.organization));
    const indicatorName = aggregate.indicator_name || indicator?.name || `Indicator ${aggregate.indicator}`;
    const organizationName = organization?.name || aggregate.organization_name || `Org ${aggregate.organization}`;

    return flattenDisaggregateFacts({
      aggregate,
      indicator,
      periodLabel,
      indicatorName,
      organizationName,
    });
  });
}

const aggregateValues = (values: number[], mode: AnalyticsAggregationMode) => {
  if (values.length === 0) return 0;
  if (mode === "count") return values.length;
  if (mode === "average") return values.reduce((sum, value) => sum + value, 0) / values.length;
  if (mode === "latest") return values[values.length - 1] || 0;
  return values.reduce((sum, value) => sum + value, 0);
};

export function computeAnalyticsKpiSummary(input: {
  facts: AnalyticsFact[];
  scopedOrgIds: string[];
  selectedIndicatorIds: string[];
}): AnalyticsKpiSummary {
  const { facts, scopedOrgIds, selectedIndicatorIds } = input;
  const totalReportedValue = facts.reduce((sum, fact) => sum + fact.value, 0);
  const organizationsReporting = new Set(facts.map((fact) => fact.organizationId)).size;
  const scopedCount = scopedOrgIds.length;
  const completeness =
    scopedCount === 0 ? 0 : Math.min(100, (organizationsReporting / scopedCount) * 100);
  return {
    totalReportedValue,
    organizationsReporting,
    reportingCompletenessRate: completeness,
    missingOrganizations: Math.max(0, scopedCount - organizationsReporting),
    selectedIndicatorsCount: selectedIndicatorIds.length,
  };
}

export function buildOrganizationBreakdown(input: {
  facts: AnalyticsFact[];
  aggregationMode?: AnalyticsAggregationMode;
}): OrganizationBreakdownRow[] {
  const mode = input.aggregationMode || "sum";
  const valuesByOrg = new Map<string, { name: string; values: number[] }>();
  input.facts.forEach((fact) => {
    const current = valuesByOrg.get(fact.organizationId) || {
      name: fact.organizationName,
      values: [],
    };
    current.values.push(fact.value);
    valuesByOrg.set(fact.organizationId, current);
  });

  const rows = Array.from(valuesByOrg.entries()).map(([organizationId, bucket]) => ({
    organizationId,
    organizationName: bucket.name,
    totalValue: aggregateValues(bucket.values, mode),
    contributionPercent: 0,
  }));
  const grandTotal = rows.reduce((sum, row) => sum + row.totalValue, 0);
  return rows
    .map((row) => ({
      ...row,
      contributionPercent: grandTotal <= 0 ? 0 : (row.totalValue / grandTotal) * 100,
    }))
    .sort((left, right) => right.totalValue - left.totalValue);
}

export function computeReportingCompleteness(input: {
  facts: AnalyticsFact[];
  scopedOrgIds: string[];
}): ReportingCompletenessSummary {
  const submittedSet = new Set(input.facts.map((fact) => fact.organizationId));
  const scopedSet = new Set(input.scopedOrgIds.map(String));
  const submittedOrgIds = Array.from(submittedSet).filter((id) => scopedSet.has(id));
  const missingOrgIds = Array.from(scopedSet).filter((id) => !submittedSet.has(id));
  const total = submittedOrgIds.length + missingOrgIds.length;
  const submittedPercent = total === 0 ? 0 : (submittedOrgIds.length / total) * 100;
  return {
    submittedOrgIds,
    missingOrgIds,
    submittedCount: submittedOrgIds.length,
    missingCount: missingOrgIds.length,
    submittedPercent,
    missingPercent: 100 - submittedPercent,
  };
}

export function buildRawRecords(facts: AnalyticsFact[]): RawAggregateRecord[] {
  return facts.map((fact, index) => {
    const disaggregationLabels = Object.entries(fact.disaggregates)
      .map(([key, value]) => `${key}: ${value}`)
      .join(" | ");

    return {
      rowKey: [
        fact.aggregateId,
        fact.organizationId,
        fact.indicatorId,
        fact.periodLabel,
        disaggregationLabels,
        String(fact.value),
        String(index),
      ].join("::"),
      id: fact.aggregateId,
      organization: fact.organizationName,
      indicator: fact.indicatorName,
      period: fact.periodLabel,
      disaggregationLabels,
      submittedValue: fact.value,
      notes: fact.notes || "",
    };
  });
}

export function buildConsolidatedMatrix(input: {
  facts: AnalyticsFact[];
  rowDimensionKey: string;
  columnDimensionKey: string;
  rowValues?: string[];
  columnValues?: string[];
}): ConsolidatedMatrixData {
  const rowKey = input.rowDimensionKey || "option";
  const columnKey = input.columnDimensionKey || "sex";
  const discoveredRows = new Set(input.rowValues || []);
  const discoveredColumns = new Set(input.columnValues || []);

  input.facts.forEach((fact) => {
    discoveredRows.add(fact.disaggregates[rowKey] || "Unspecified");
    discoveredColumns.add(fact.disaggregates[columnKey] || "Unspecified");
  });

  const rowLabels = Array.from(discoveredRows);
  const columnLabels = Array.from(discoveredColumns);
  const rowIndex = new Map(rowLabels.map((label, index) => [label, index]));
  const columnIndex = new Map(columnLabels.map((label, index) => [label, index]));

  const cells = rowLabels.map(() => columnLabels.map(() => 0));
  input.facts.forEach((fact) => {
    const rowLabel = fact.disaggregates[rowKey] || "Unspecified";
    const columnLabel = fact.disaggregates[columnKey] || "Unspecified";
    const rIndex = rowIndex.get(rowLabel);
    const cIndex = columnIndex.get(columnLabel);
    if (rIndex === undefined || cIndex === undefined) return;
    cells[rIndex][cIndex] += fact.value;
  });

  const rowTotals = cells.map((row) => row.reduce((sum, value) => sum + value, 0));
  const columnTotals = columnLabels.map((_, column) =>
    cells.reduce((sum, row) => sum + (row[column] || 0), 0),
  );
  const grandTotal = rowTotals.reduce((sum, value) => sum + value, 0);

  return {
    rowDimensionKey: rowKey,
    columnDimensionKey: columnKey,
    rowLabels,
    columnLabels,
    cells,
    rowTotals,
    columnTotals,
    grandTotal,
  };
}
