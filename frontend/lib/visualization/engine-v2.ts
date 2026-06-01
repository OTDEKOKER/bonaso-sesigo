// Parallel v2 visualization engine.
// This stays side-by-side with the legacy engine until the renderer migration is complete.

export type Primitive = string | number | boolean | null | undefined;

export type DimensionKey =
  | "sex"
  | "age_band"
  | "age_band_short"
  | "age_band_long"
  | "key_population"
  | "district"
  | "referral_type"
  | "service_type"
  | "counselling_category"
  | "tobacco_use"
  | "alcohol_use"
  | "family_planning_method"
  | "social_media_platform"
  | "non_traditional_site"
  | "cancer_type"
  | "screening_type"
  | "activity_type"
  | "location"
  | "target_group"
  | string;

export type OrgScope = "all_orgs" | "parent_org" | "selected_orgs" | "self_only";
export type PeriodMode = "monthly" | "quarterly" | "yearly" | "custom";
export type ComparisonMode =
  | "none"
  | "organization"
  | "coordinator"
  | "indicator"
  | "disaggregate"
  | "period"
  | "sex"
  | "age"
  | "key_population";
export type ChartType =
  | "kpi"
  | "bar"
  | "stacked-bar"
  | "grouped-bar"
  | "heatmap"
  | "line"
  | "funnel"
  | "table";

export interface AggregateRecord {
  id?: string | number;
  project_id?: string | number | null;
  project_name?: string | null;
  indicator_id?: string | number | null;
  indicator_name?: string | null;
  organization_id?: string | number | null;
  organization_name?: string | null;
  organization_type?: string | null;
  parent_organization_id?: string | number | null;
  parent_organization_name?: string | null;
  reporting_period?: string | null;
  reporting_period_type?: string | null;
  reporting_start_date?: string | null;
  reporting_end_date?: string | null;
  value?: number | string | null;
  target?: number | string | null;
  stage?: string | null;
  notes?: string | null;
  value_json?: unknown;
  disaggregations?: Record<string, Primitive>;
  [key: string]: unknown;
}

export interface NormalizedAggregateFact {
  id: string;
  projectId: string | null;
  projectName: string | null;
  indicatorId: string | null;
  indicatorName: string | null;
  organizationId: string | null;
  organizationName: string | null;
  organizationType: string | null;
  parentOrganizationId: string | null;
  parentOrganizationName: string | null;
  reportingPeriod: string | null;
  reportingPeriodType: string | null;
  reportingStartDate: string | null;
  reportingEndDate: string | null;
  value: number;
  target: number | null;
  stage: string | null;
  notes: string | null;
  dimensions: Record<string, string>;
  raw: AggregateRecord;
}

export interface KPIItem {
  key: string;
  label: string;
  value: number | string;
  helperText?: string;
}

export interface SeriesDatum {
  name: string;
  value: number;
  target?: number | null;
}

export interface HeatmapDatum {
  x: string;
  y: string;
  value: number;
}

export interface TableModel {
  columns: string[];
  rows: Array<Record<string, string | number | null>>;
  totals?: Record<string, number>;
}

export interface VisualizationRequest {
  indicatorId?: string;
  indicatorName?: string;
  records: AggregateRecord[];
  availableDimensions?: string[];
  selectedDimensions?: string[];
  comparisonMode?: ComparisonMode;
  hierarchyScope: OrgScope;
  selectedParentOrgId?: string;
  selectedOrgIds?: string[];
  currentOrgId?: string;
  periodMode?: PeriodMode;
  chartMode?: "auto" | ChartType;
}

export interface VisualizationResult {
  summary: KPIItem[];
  recommendedChart: ChartType;
  chartProps: unknown;
  comparisonChartProps?: unknown;
  trendChartProps?: unknown;
  heatmapProps?: unknown;
  funnelProps?: unknown;
  tableProps: TableModel;
  availableViews: ChartType[];
  warnings?: string[];
  facts: NormalizedAggregateFact[];
}

const DEFAULT_DIMENSION_ORDERS: Record<string, string[]> = {
  sex: ["Male", "Female", "Other", "Unknown"],
  age_band: ["10-14", "15-19", "20-24", "25-29", "30-34", "35-39", "40-44", "45-49", "50-54", "55-59", "60-64", "65+"],
  age_band_short: ["10-14", "15-19", "20-24", "25-29", "30-34", "35-39", "40-44", "45-49", "50-54", "55-59", "60-64", "65+"],
  age_band_long: ["10-14", "15-19", "20-24", "25-29", "30-34", "35-39", "40-44", "45-49", "50-54", "55-59", "60-64", "65+"],
  quarter: ["Q1", "Q2", "Q3", "Q4"],
};

const FLOW_STAGE_ALIASES = new Set([
  "tested",
  "positive",
  "initiated",
  "initiated on art",
  "screened",
  "eligible",
  "referred",
  "completed",
  "treated",
  "counselled",
  "counselling",
  "psychoeducation",
]);

function toId(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  return String(value);
}

function toNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const cleaned = value.replace(/,/g, "").trim();
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function toOptionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = toNumber(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeDimensionLabel(value: Primitive): string {
  if (value === null || value === undefined || value === "") return "Unknown";
  return String(value).trim();
}

function getRecordDisaggregations(record: AggregateRecord): Record<string, Primitive> {
  const base =
    record.disaggregations && typeof record.disaggregations === "object"
      ? record.disaggregations
      : {};

  const known: Record<string, Primitive> = {};
  for (const [key, value] of Object.entries(record)) {
    if (
      [
        "id",
        "project_id",
        "project_name",
        "indicator_id",
        "indicator_name",
        "organization_id",
        "organization_name",
        "organization_type",
        "parent_organization_id",
        "parent_organization_name",
        "reporting_period",
        "reporting_period_type",
        "reporting_start_date",
        "reporting_end_date",
        "value",
        "target",
        "stage",
        "notes",
        "value_json",
        "disaggregations",
      ].includes(key)
    ) {
      continue;
    }

    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean" ||
      value == null
    ) {
      known[key] = value as Primitive;
    }
  }

  return { ...known, ...base };
}

export function normalizeAggregateRecords(records: AggregateRecord[]): NormalizedAggregateFact[] {
  return records.map((record, index) => {
    const dimensions = Object.fromEntries(
      Object.entries(getRecordDisaggregations(record)).map(([key, value]) => [
        key,
        normalizeDimensionLabel(value),
      ]),
    );

    return {
      id: toId(record.id) ?? `fact-${index}`,
      projectId: toId(record.project_id),
      projectName: (record.project_name as string | null) ?? null,
      indicatorId: toId(record.indicator_id),
      indicatorName: (record.indicator_name as string | null) ?? null,
      organizationId: toId(record.organization_id),
      organizationName: (record.organization_name as string | null) ?? null,
      organizationType: (record.organization_type as string | null) ?? null,
      parentOrganizationId: toId(record.parent_organization_id),
      parentOrganizationName:
        (record.parent_organization_name as string | null) ?? null,
      reportingPeriod: (record.reporting_period as string | null) ?? null,
      reportingPeriodType:
        (record.reporting_period_type as string | null) ?? null,
      reportingStartDate:
        (record.reporting_start_date as string | null) ?? null,
      reportingEndDate: (record.reporting_end_date as string | null) ?? null,
      value: toNumber(record.value),
      target: toOptionalNumber(record.target),
      stage: (record.stage as string | null) ?? null,
      notes: (record.notes as string | null) ?? null,
      dimensions,
      raw: record,
    };
  });
}

export function extractAvailableDimensions(facts: NormalizedAggregateFact[]): string[] {
  const set = new Set<string>();
  for (const fact of facts) {
    for (const key of Object.keys(fact.dimensions)) set.add(key);
  }
  return Array.from(set);
}

export function resolveHierarchyScope(
  facts: NormalizedAggregateFact[],
  scope: OrgScope,
  args: { selectedParentOrgId?: string; selectedOrgIds?: string[]; currentOrgId?: string },
): NormalizedAggregateFact[] {
  const { selectedParentOrgId, selectedOrgIds = [], currentOrgId } = args;

  switch (scope) {
    case "all_orgs":
      return facts;
    case "parent_org":
      if (!selectedParentOrgId) return facts;
      return facts.filter(
        (fact) =>
          fact.organizationId === selectedParentOrgId ||
          fact.parentOrganizationId === selectedParentOrgId,
      );
    case "selected_orgs": {
      const allowed = new Set(selectedOrgIds.map(String));
      if (allowed.size === 0) return facts;
      return facts.filter(
        (fact) => fact.organizationId && allowed.has(fact.organizationId),
      );
    }
    case "self_only":
      if (!currentOrgId) return facts;
      return facts.filter((fact) => fact.organizationId === currentOrgId);
    default:
      return facts;
  }
}

export function filterByIndicator(
  facts: NormalizedAggregateFact[],
  indicatorId?: string,
  indicatorName?: string,
): NormalizedAggregateFact[] {
  return facts.filter((fact) => {
    if (indicatorId && fact.indicatorId !== indicatorId) return false;
    if (indicatorName && fact.indicatorName !== indicatorName) return false;
    return true;
  });
}

export function sortDimensionValues(values: string[], dimension: string): string[] {
  const order = DEFAULT_DIMENSION_ORDERS[dimension] ?? [];
  const ranked = new Map(order.map((value, index) => [value, index]));
  return [...values].sort((a, b) => {
    const aRank = ranked.has(a) ? ranked.get(a)! : Number.MAX_SAFE_INTEGER;
    const bRank = ranked.has(b) ? ranked.get(b)! : Number.MAX_SAFE_INTEGER;
    if (aRank !== bRank) return aRank - bRank;
    return a.localeCompare(b);
  });
}

function groupSum<T extends string>(
  facts: NormalizedAggregateFact[],
  keyFn: (fact: NormalizedAggregateFact) => T,
): Map<T, number> {
  const map = new Map<T, number>();
  for (const fact of facts) {
    const key = keyFn(fact);
    map.set(key, (map.get(key) ?? 0) + fact.value);
  }
  return map;
}

export function buildMetricSummary(facts: NormalizedAggregateFact[]): KPIItem[] {
  const total = facts.reduce((sum, fact) => sum + fact.value, 0);
  const totalTarget = facts.reduce((sum, fact) => sum + (fact.target ?? 0), 0);
  const achievement = totalTarget > 0 ? (total / totalTarget) * 100 : null;

  const byOrg = groupSum(facts, (fact) => fact.organizationName ?? "Unknown");
  const topOrg = [...byOrg.entries()].sort((a, b) => b[1] - a[1])[0];

  const sexFacts = facts.filter((fact) => fact.dimensions.sex);
  const bySex = groupSum(sexFacts, (fact) => fact.dimensions.sex ?? "Unknown");

  return [
    { key: "total", label: "Total", value: total },
    { key: "target", label: "Target", value: totalTarget },
    {
      key: "achievement",
      label: "Achievement %",
      value: achievement === null ? "—" : `${achievement.toFixed(1)}%`,
    },
    {
      key: "top_org",
      label: "Top Organization",
      value: topOrg?.[0] ?? "—",
      helperText: topOrg ? String(topOrg[1]) : undefined,
    },
    {
      key: "sex_split",
      label: "Sex Split",
      value:
        bySex.size > 0
          ? [...bySex.entries()]
              .map(([sex, value]) => `${sex}: ${value}`)
              .join(" | ")
          : "—",
    },
  ];
}

export function buildComparisonDataset(
  facts: NormalizedAggregateFact[],
  compareBy: "organization" | "period" | string,
): SeriesDatum[] {
  const keyFn = (fact: NormalizedAggregateFact) => {
    if (compareBy === "organization") return fact.organizationName ?? "Unknown";
    if (compareBy === "indicator") return fact.indicatorName ?? "Unknown";
    if (compareBy === "period") return fact.reportingPeriod ?? "Unknown";
    return fact.dimensions[compareBy] ?? "Unknown";
  };

  const sums = groupSum(facts, keyFn);
  return [...sums.entries()].map(([name, value]) => ({ name, value }));
}

export function buildTargetVsAchievementDataset(
  facts: NormalizedAggregateFact[],
  compareBy: "organization" | "period" | string,
): SeriesDatum[] {
  const map = new Map<string, { value: number; target: number }>();

  for (const fact of facts) {
    const key =
      compareBy === "organization"
        ? fact.organizationName ?? "Unknown"
        : compareBy === "indicator"
          ? fact.indicatorName ?? "Unknown"
        : compareBy === "period"
          ? fact.reportingPeriod ?? "Unknown"
          : fact.dimensions[compareBy] ?? "Unknown";

    const existing = map.get(key) ?? { value: 0, target: 0 };
    existing.value += fact.value;
    existing.target += fact.target ?? 0;
    map.set(key, existing);
  }

  return [...map.entries()].map(([name, item]) => ({
    name,
    value: item.value,
    target: item.target,
  }));
}

export function buildStackedSeries(
  facts: NormalizedAggregateFact[],
  categoryDimension: string,
  stackDimension: string,
): { categories: string[]; series: Array<{ name: string; data: number[] }> } {
  const categories = sortDimensionValues(
    [...new Set(facts.map((fact) => fact.dimensions[categoryDimension] ?? "Unknown"))],
    categoryDimension,
  );
  const stacks = sortDimensionValues(
    [...new Set(facts.map((fact) => fact.dimensions[stackDimension] ?? "Unknown"))],
    stackDimension,
  );

  const valueMap = new Map<string, number>();
  for (const fact of facts) {
    const category = fact.dimensions[categoryDimension] ?? "Unknown";
    const stack = fact.dimensions[stackDimension] ?? "Unknown";
    const key = `${category}__${stack}`;
    valueMap.set(key, (valueMap.get(key) ?? 0) + fact.value);
  }

  return {
    categories,
    series: stacks.map((stack) => ({
      name: stack,
      data: categories.map((category) => valueMap.get(`${category}__${stack}`) ?? 0),
    })),
  };
}

export function buildHeatmapDataset(
  facts: NormalizedAggregateFact[],
  xDimension: string,
  yDimension: string,
): { x: string[]; y: string[]; data: HeatmapDatum[] } {
  const x = sortDimensionValues(
    [...new Set(facts.map((fact) => fact.dimensions[xDimension] ?? "Unknown"))],
    xDimension,
  );
  const y = sortDimensionValues(
    [...new Set(facts.map((fact) => fact.dimensions[yDimension] ?? "Unknown"))],
    yDimension,
  );

  const sumMap = new Map<string, number>();
  for (const fact of facts) {
    const xValue = fact.dimensions[xDimension] ?? "Unknown";
    const yValue = fact.dimensions[yDimension] ?? "Unknown";
    const key = `${xValue}__${yValue}`;
    sumMap.set(key, (sumMap.get(key) ?? 0) + fact.value);
  }

  const data: HeatmapDatum[] = [];
  for (const yValue of y) {
    for (const xValue of x) {
      data.push({
        x: xValue,
        y: yValue,
        value: sumMap.get(`${xValue}__${yValue}`) ?? 0,
      });
    }
  }

  return { x, y, data };
}

export function buildTimeSeriesDataset(facts: NormalizedAggregateFact[]): SeriesDatum[] {
  const sums = groupSum(facts, (fact) => fact.reportingPeriod ?? "Unknown");
  const periods = sortDimensionValues([...sums.keys()], "quarter");
  return periods.map((name) => ({ name, value: sums.get(name) ?? 0 }));
}

export function buildCascadeDataset(facts: NormalizedAggregateFact[]): SeriesDatum[] {
  const stageFacts = facts.filter(
    (fact) => fact.stage && FLOW_STAGE_ALIASES.has(fact.stage.toLowerCase()),
  );
  const sums = new Map<string, { value: number; target: number }>();
  for (const fact of stageFacts) {
    const stage = fact.stage ?? "Unknown";
    const current = sums.get(stage) ?? { value: 0, target: 0 };
    current.value += fact.value;
    current.target += fact.target ?? 0;
    sums.set(stage, current);
  }
  return [...sums.entries()].map(([name, totals]) => ({
    name,
    value: totals.value,
    target: totals.target,
  }));
}

export function buildMatrixTableDataset(
  facts: NormalizedAggregateFact[],
  dimensions: string[],
): TableModel {
  const columns = ["organization", "period", ...dimensions, "value", "target", "stage"];

  const rows = facts.map((fact) => {
    const row: Record<string, string | number | null> = {
      organization: fact.organizationName,
      period: fact.reportingPeriod,
      value: fact.value,
      target: fact.target,
      stage: fact.stage,
    };

    for (const dimension of dimensions) {
      row[dimension] = fact.dimensions[dimension] ?? null;
    }

    return row;
  });

  const totals = {
    value: facts.reduce((sum, fact) => sum + fact.value, 0),
    target: facts.reduce((sum, fact) => sum + (fact.target ?? 0), 0),
  };

  return { columns, rows, totals };
}

export function recommendVisualization(args: {
  selectedDimensions: string[];
  comparisonMode?: ComparisonMode;
  hasTarget: boolean;
  hasTimeSeries: boolean;
  hasFlowStages: boolean;
  chartMode?: "auto" | ChartType;
}): ChartType {
  if (args.chartMode && args.chartMode !== "auto") return args.chartMode;
  if (args.hasFlowStages) return "funnel";
  if (args.comparisonMode === "disaggregate") return "bar";
  if (
    args.comparisonMode === "organization" ||
    args.comparisonMode === "coordinator" ||
    args.comparisonMode === "indicator"
  ) {
    return args.hasTarget ? "grouped-bar" : "bar";
  }
  if (args.hasTimeSeries && args.selectedDimensions.length === 0) return "line";
  if (args.selectedDimensions.length === 0) return args.hasTarget ? "grouped-bar" : "kpi";
  if (args.selectedDimensions.length === 1) return args.hasTarget ? "grouped-bar" : "bar";
  if (args.selectedDimensions.length === 2) return "stacked-bar";
  return "heatmap";
}

export function buildVisualizationEngine(request: VisualizationRequest): VisualizationResult {
  const warnings: string[] = [];

  const normalized = normalizeAggregateRecords(request.records);
  let facts = filterByIndicator(normalized, request.indicatorId, request.indicatorName);
  facts = resolveHierarchyScope(facts, request.hierarchyScope, {
    selectedParentOrgId: request.selectedParentOrgId,
    selectedOrgIds: request.selectedOrgIds,
    currentOrgId: request.currentOrgId,
  });

  const availableDimensions = request.availableDimensions?.length
    ? request.availableDimensions
    : extractAvailableDimensions(facts);

  const selectedDimensions = request.selectedDimensions?.filter(Boolean) ?? [];
  const hasTarget = facts.some((fact) => fact.target !== null);
  const hasTimeSeries = new Set(
    facts.map((fact) => fact.reportingPeriod).filter(Boolean),
  ).size > 1;
  const hasFlowStages = facts.some(
    (fact) => fact.stage && FLOW_STAGE_ALIASES.has(fact.stage.toLowerCase()),
  );

  const recommendedChart = recommendVisualization({
    selectedDimensions,
    comparisonMode: request.comparisonMode,
    hasTarget,
    hasTimeSeries,
    hasFlowStages,
    chartMode: request.chartMode,
  });

  const summary = buildMetricSummary(facts);
  const tableProps = buildMatrixTableDataset(facts, availableDimensions);

  let chartProps: unknown = null;
  let comparisonChartProps: unknown = undefined;
  let trendChartProps: unknown = undefined;
  let heatmapProps: unknown = undefined;
  let funnelProps: unknown = undefined;

  if (recommendedChart === "kpi") {
    chartProps = { summary };
  }

  if (recommendedChart === "bar" || recommendedChart === "grouped-bar") {
    const isDisaggregateComparison = request.comparisonMode === "disaggregate";
    const compareBy =
      request.comparisonMode === "organization"
        ? "organization"
        : request.comparisonMode === "coordinator"
          ? "coordinator"
          : request.comparisonMode === "indicator"
            ? "indicator"
            : request.comparisonMode === "disaggregate"
              ? selectedDimensions[0] ?? "organization"
            : selectedDimensions[0] ?? "organization";

    chartProps = hasTarget && !isDisaggregateComparison
      ? buildTargetVsAchievementDataset(facts, compareBy)
      : buildComparisonDataset(facts, compareBy);
  }

  if (recommendedChart === "stacked-bar") {
    if (selectedDimensions.length < 2) {
      warnings.push(
        "Stacked bar was recommended without two selected dimensions. Falling back to comparison dataset.",
      );
      chartProps = buildComparisonDataset(
        facts,
        selectedDimensions[0] ?? "organization",
      );
    } else {
      chartProps = buildStackedSeries(facts, selectedDimensions[0], selectedDimensions[1]);
    }
  }

  if (recommendedChart === "heatmap") {
    if (selectedDimensions.length < 2) {
      warnings.push("Heatmap was recommended without at least two selected dimensions.");
    } else {
      heatmapProps = buildHeatmapDataset(facts, selectedDimensions[0], selectedDimensions[1]);
      chartProps = heatmapProps;
    }
  }

  if (recommendedChart === "line") {
    trendChartProps = buildTimeSeriesDataset(facts);
    chartProps = trendChartProps;
  }

  if (recommendedChart === "funnel") {
    funnelProps = buildCascadeDataset(facts);
    chartProps = funnelProps;
  }

  if (
    request.comparisonMode === "organization" ||
    request.comparisonMode === "coordinator" ||
    request.comparisonMode === "indicator" ||
    request.comparisonMode === "disaggregate"
  ) {
    const comparisonDimension =
      request.comparisonMode === "coordinator"
        ? "coordinator"
        : request.comparisonMode === "indicator"
          ? "indicator"
          : request.comparisonMode === "disaggregate"
            ? selectedDimensions[0] ?? "organization"
          : "organization";
    comparisonChartProps = hasTarget && request.comparisonMode !== "disaggregate"
      ? buildTargetVsAchievementDataset(facts, comparisonDimension)
      : buildComparisonDataset(facts, comparisonDimension);
  }

  if (hasTimeSeries) {
    trendChartProps = buildTimeSeriesDataset(facts);
  }

  if (selectedDimensions.length >= 2) {
    heatmapProps = buildHeatmapDataset(facts, selectedDimensions[0], selectedDimensions[1]);
  }

  if (hasFlowStages) {
    funnelProps = buildCascadeDataset(facts);
  }

  const availableViews: ChartType[] = ["kpi", "table"];
  if (
    selectedDimensions.length >= 1 ||
    request.comparisonMode === "organization" ||
    request.comparisonMode === "coordinator" ||
    request.comparisonMode === "indicator" ||
    request.comparisonMode === "disaggregate"
  ) {
    availableViews.push("bar", "grouped-bar");
  }
  if (selectedDimensions.length >= 2) availableViews.push("stacked-bar", "heatmap");
  if (hasTimeSeries) availableViews.push("line");
  if (hasFlowStages) availableViews.push("funnel");

  return {
    summary,
    recommendedChart,
    chartProps,
    comparisonChartProps,
    trendChartProps,
    heatmapProps,
    funnelProps,
    tableProps,
    availableViews: Array.from(new Set(availableViews)),
    warnings: warnings.length ? warnings : undefined,
    facts,
  };
}

export function buildEChartsOption(result: VisualizationResult): Record<string, unknown> {
  switch (result.recommendedChart) {
    case "bar":
    case "grouped-bar": {
      const data = (result.chartProps as SeriesDatum[]) ?? [];
      return {
        tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
        xAxis: { type: "category", data: data.map((item) => item.name) },
        yAxis: { type: "value" },
        series: [
          {
            name: "Actual",
            type: "bar",
            data: data.map((item) => item.value),
          },
          ...(data.some((item) => item.target != null)
            ? [
                {
                  name: "Target",
                  type: "bar",
                  data: data.map((item) => item.target ?? 0),
                },
              ]
            : []),
        ],
      };
    }
    case "stacked-bar": {
      const data = result.chartProps as {
        categories: string[];
        series: Array<{ name: string; data: number[] }>;
      };
      return {
        tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
        legend: {},
        xAxis: { type: "category", data: data.categories },
        yAxis: { type: "value" },
        series: data.series.map((item) => ({ ...item, type: "bar", stack: "total" })),
      };
    }
    case "heatmap": {
      const data = result.chartProps as { x: string[]; y: string[]; data: HeatmapDatum[] };
      return {
        tooltip: { position: "top" },
        xAxis: { type: "category", data: data.x, splitArea: { show: true } },
        yAxis: { type: "category", data: data.y, splitArea: { show: true } },
        visualMap: {
          min: 0,
          max: Math.max(...data.data.map((item) => item.value), 0),
          calculable: true,
          orient: "horizontal",
          left: "center",
          bottom: 0,
        },
        series: [
          {
            type: "heatmap",
            data: data.data.map((item) => [item.x, item.y, item.value]),
            label: { show: true },
          },
        ],
      };
    }
    case "line": {
      const data = (result.chartProps as SeriesDatum[]) ?? [];
      return {
        tooltip: { trigger: "axis" },
        xAxis: { type: "category", data: data.map((item) => item.name) },
        yAxis: { type: "value" },
        series: [{ type: "line", data: data.map((item) => item.value), smooth: true }],
      };
    }
    case "funnel": {
      const data = (result.chartProps as SeriesDatum[]) ?? [];
      return {
        tooltip: { trigger: "item" },
        series: [
          {
            type: "funnel",
            data: data.map((item) => ({ name: item.name, value: item.value })),
          },
        ],
      };
    }
    default:
      return {};
  }
}

export const visualizationEngineV2 = {
  normalizeAggregateRecords,
  extractAvailableDimensions,
  resolveHierarchyScope,
  buildMetricSummary,
  buildComparisonDataset,
  buildTargetVsAchievementDataset,
  buildStackedSeries,
  buildHeatmapDataset,
  buildTimeSeriesDataset,
  buildCascadeDataset,
  buildMatrixTableDataset,
  recommendVisualization,
  buildVisualizationEngine,
  buildEChartsOption,
};
