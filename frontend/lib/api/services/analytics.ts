/**
 * Legacy Analytics Service
 *
 * Frontend support for the older analytics model:
 * - ChartField
 * - IndicatorChartSetting
 * - DashboardSetting
 *
 * The current backend in some environments still stores dashboards as generic
 * analysis reports. This service prefers the legacy analytics endpoints and
 * falls back to the saved-report shape when those endpoints are unavailable.
 */

import { api, fetchWithAuth, normalizeApiError, type ApiError, type PaginatedResponse } from "../client";

export type ChartFieldName =
  | "age_range"
  | "sex"
  | "kp_type"
  | "disability_type"
  | "special_attribute"
  | "district"
  | "citizenship"
  | "hiv_status"
  | "pregnancy"
  | "coordinator"
  | "organization"
  | "option"
  | "platform"
  | "metric";

export type LegacyChartType = "pie" | "line" | "bar";
export type LegacyChartAxis = "month" | "quarter";

export interface AnalyticsOption {
  value: string;
  label: string;
}

export interface ChartField {
  id?: number;
  name: ChartFieldName;
  label?: string;
}

export interface ChartFilter {
  id?: number;
  field?: number | null;
  field_detail?: ChartField | null;
  value: string;
}

export interface IndicatorChartSetting {
  id?: number;
  name?: string | null;
  display_name?: string;
  indicators: number[];
  indicator_details?: Array<{
    id: number;
    name?: string;
    short_name?: string;
    display_name?: string;
    code?: string;
    type?: string;
    category?: string;
    options?: Array<string | { label: string; value: string }>;
  }>;
  chart_type: LegacyChartType;
  tabular?: boolean;
  axis?: LegacyChartAxis | null;
  legend?: ChartFieldName | null;
  stack?: ChartFieldName | null;
  use_target?: boolean;
  filters?: ChartFilter[];
  average?: boolean;
  repeat_only?: boolean;
  repeat_n?: number | null;
  start?: string | null;
  end?: string | null;
  chart_data?: Record<string, unknown> | Array<Record<string, unknown>>;
  targets?: Array<Record<string, number>>;
  allow_targets?: boolean;
  created_by?: number | null;
  created_at?: string;
  updated_at?: string;
}

export interface DashboardIndicatorChart {
  id?: number;
  dashboard?: number;
  chart?: number;
  chart_detail?: IndicatorChartSetting | null;
  order?: number;
  width?: string | null;
  height?: string | null;
}

export interface DashboardFilter {
  id?: number;
  field?: number | null;
  field_detail?: ChartField | null;
  value: string;
}

export interface DashboardSetting {
  id: number;
  name: string;
  display_name?: string;
  description?: string | null;
  project?: number | null;
  project_name?: string;
  organization?: number | null;
  organization_name?: string;
  cascade_organization?: boolean;
  charts?: IndicatorChartSetting[];
  chart_links?: DashboardIndicatorChart[];
  filters?: DashboardFilter[];
  created_by?: number | null;
  created_by_name?: string;
  created_at?: string;
  updated_at?: string;
}

export interface RequestLog {
  id: number;
  path: string;
  timestamp: string;
  method: string;
  status_code: number;
  response_time_ms: number;
  user?: number | null;
  user_name?: string;
}

export interface DashboardMeta {
  chart_types: AnalyticsOption[];
  axes: AnalyticsOption[];
  fields: Array<AnalyticsOption & { value: ChartFieldName }>;
}

export interface DashboardSettingsFilters {
  search?: string;
  page?: string | number;
  page_size?: string | number;
}

export interface DashboardSettingRequest {
  name: string;
  description?: string | null;
  project_id?: number | null;
  organization_id?: number | null;
  cascade_organization?: boolean;
  charts?: IndicatorChartSetting[];
}

export interface DashboardChartRequest {
  id?: number | null;
  name?: string | null;
  indicators: number[];
  chart_type: LegacyChartType;
  tabular?: boolean;
  axis?: LegacyChartAxis | null;
  legend?: ChartFieldName | null;
  stack?: ChartFieldName | null;
  use_target?: boolean;
  filters?: ChartFilter[];
  average?: boolean;
  repeat_only?: boolean;
  repeat_n?: number | null;
  start?: string | null;
  end?: string | null;
}

async function downloadBlob(endpoint: string): Promise<Blob> {
  const response = await fetchWithAuth(endpoint);
  if (!response.ok) {
    const contentType = response.headers.get("content-type");
    const payload = contentType?.includes("application/json")
      ? await response.json()
      : await response.text();
    throw normalizeApiError({
      status: response.status,
      payload,
      fallbackMessage: "Failed to download file",
    });
  }
  return response.blob();
}

type RawDashboardResponse = Record<string, unknown> & {
  id: number;
  name?: string;
  description?: string | null;
  project?: number | Record<string, unknown> | null;
  organization?: number | Record<string, unknown> | null;
  cascade_organization?: boolean;
  created_by?: number | Record<string, unknown> | null;
  created_by_name?: string;
  created_at?: string;
  updated_at?: string;
  charts?: unknown[];
  charts_detail?: unknown[];
  indicator_charts?: unknown[];
  filters?: unknown[];
  parameters?: Record<string, unknown>;
  report_type?: string;
};

type RawReportDashboard = {
  id: number;
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
  organization?: number | null;
  organization_name?: string;
  is_public?: boolean;
  created_at?: string;
  updated_at?: string;
  created_by?: number | null;
  created_by_name?: string;
};

const LEGACY_CHART_FIELDS: Array<{ value: ChartFieldName; label: string }> = [
  { value: "age_range", label: "Age Range" },
  { value: "sex", label: "Sex" },
  { value: "kp_type", label: "Key Population Type" },
  { value: "disability_type", label: "Disability Type" },
  { value: "special_attribute", label: "Special Respondent Attribute" },
  { value: "district", label: "District" },
  { value: "citizenship", label: "Citizenship" },
  { value: "hiv_status", label: "HIV Status" },
  { value: "pregnancy", label: "Pregnancy" },
  { value: "coordinator", label: "Coordinator" },
  { value: "organization", label: "Organization" },
  { value: "option", label: "Option" },
  { value: "platform", label: "Platform" },
  { value: "metric", label: "Metric" },
];

type NamedEntity = {
  id: number;
  name?: string;
  display_name?: string;
  code?: string;
};

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "status" in error && (error as ApiError).status === 404;
}

function createUnavailableFeatureError(featureName: string): ApiError {
  return normalizeApiError({
    status: 404,
    payload: {
      detail: `${featureName} are not available on this backend yet.`,
    },
    fallbackMessage: `${featureName} are not available on this backend yet.`,
  });
}

const LEGACY_ANALYTICS_FEATURES = {
  dashboardMeta: ["/analysis/dashboards/meta"],
  dashboardBreakdowns: ["/analysis/dashboards/breakdowns"],
  dashboardSettings: ["/analysis/dashboards", "/analysis/reports"],
} as const;

type LegacyAnalyticsFeatureKey = keyof typeof LEGACY_ANALYTICS_FEATURES;
type EndpointRequest<T> = {
  endpoint: string;
  request: () => Promise<T>;
};

type EndpointVariantOptions = {
  cacheUnavailableOnNotFound?: boolean;
};

const LEGACY_ANALYTICS_CACHE_TTL_MS = 5 * 60 * 1000;
const featureStatusCache = new Map<LegacyAnalyticsFeatureKey, "available" | "unavailable">();
const featureVariantCache = new Map<LegacyAnalyticsFeatureKey, string>();

function getFeatureStorageKey(featureKey: LegacyAnalyticsFeatureKey, suffix: "status" | "variant") {
  return `bonaso.legacy-analytics.${featureKey}.${suffix}`;
}

function readCachedSessionValue(storageKey: string): string | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.sessionStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { value?: unknown; expiresAt?: unknown };
    if (typeof parsed.expiresAt !== "number" || parsed.expiresAt <= Date.now()) {
      window.sessionStorage.removeItem(storageKey);
      return null;
    }
    return typeof parsed.value === "string" ? parsed.value : null;
  } catch {
    return null;
  }
}

function writeCachedSessionValue(storageKey: string, value: string) {
  if (typeof window === "undefined") return;

  try {
    window.sessionStorage.setItem(
      storageKey,
      JSON.stringify({
        value,
        expiresAt: Date.now() + LEGACY_ANALYTICS_CACHE_TTL_MS,
      }),
    );
  } catch {
    // Ignore storage failures and fall back to in-memory caching.
  }
}

function getCachedFeatureStatus(featureKey: LegacyAnalyticsFeatureKey): "available" | "unavailable" | null {
  const cached = featureStatusCache.get(featureKey);
  if (cached) return cached;

  const stored = readCachedSessionValue(getFeatureStorageKey(featureKey, "status"));
  if (stored === "available" || stored === "unavailable") {
    featureStatusCache.set(featureKey, stored);
    return stored;
  }

  return null;
}

function setCachedFeatureStatus(featureKey: LegacyAnalyticsFeatureKey, status: "available" | "unavailable") {
  featureStatusCache.set(featureKey, status);
  writeCachedSessionValue(getFeatureStorageKey(featureKey, "status"), status);
}

function getCachedFeatureVariant(featureKey: LegacyAnalyticsFeatureKey): string | null {
  const cached = featureVariantCache.get(featureKey);
  if (cached) return cached;

  const stored = readCachedSessionValue(getFeatureStorageKey(featureKey, "variant"));
  if (!stored) return null;

  featureVariantCache.set(featureKey, stored);
  return stored;
}

function setCachedFeatureVariant(featureKey: LegacyAnalyticsFeatureKey, endpoint: string) {
  const variant = LEGACY_ANALYTICS_FEATURES[featureKey].find((candidate) => endpoint.includes(candidate));
  if (!variant) return;

  featureVariantCache.set(featureKey, variant);
  writeCachedSessionValue(getFeatureStorageKey(featureKey, "variant"), variant);
}

function sortEndpointRequests<T>(
  requests: Array<EndpointRequest<T>>,
  featureKey: LegacyAnalyticsFeatureKey,
): Array<EndpointRequest<T>> {
  const preferredVariant = getCachedFeatureVariant(featureKey);
  if (!preferredVariant) return requests;

  return [...requests].sort((left, right) => {
    const leftPreferred = left.endpoint.includes(preferredVariant);
    const rightPreferred = right.endpoint.includes(preferredVariant);
    if (leftPreferred === rightPreferred) return 0;
    return leftPreferred ? -1 : 1;
  });
}

async function tryEndpointVariants<T>(
  requests: Array<EndpointRequest<T>>,
  featureName: string,
  featureKey: LegacyAnalyticsFeatureKey,
  options?: EndpointVariantOptions,
): Promise<T> {
  const cacheUnavailableOnNotFound = options?.cacheUnavailableOnNotFound ?? false;

  if (getCachedFeatureStatus(featureKey) === "unavailable") {
    throw createUnavailableFeatureError(featureName);
  }

  let lastError: unknown = null;

  for (const entry of sortEndpointRequests(requests, featureKey)) {
    try {
      const result = await entry.request();
      setCachedFeatureStatus(featureKey, "available");
      setCachedFeatureVariant(featureKey, entry.endpoint);
      return result;
    } catch (error) {
      if (!isNotFound(error)) {
        throw error;
      }
      lastError = error;
    }
  }

  if (lastError && isNotFound(lastError)) {
    if (cacheUnavailableOnNotFound) {
      setCachedFeatureStatus(featureKey, "unavailable");
      throw createUnavailableFeatureError(featureName);
    }
    throw lastError;
  }

  throw lastError instanceof Error ? lastError : createUnavailableFeatureError(featureName);
}

function toNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (typeof entry === "number") return entry;
      if (typeof entry === "string") return Number(entry);
      if (typeof entry === "object" && entry !== null && "id" in entry) {
        return Number((entry as { id: unknown }).id);
      }
      return Number.NaN;
    })
    .filter((entry) => Number.isFinite(entry));
}

function toNumberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof value === "object" && value !== null && "id" in value) {
    return toNumberOrNull((value as { id?: unknown }).id);
  }
  return null;
}

function normalizeNamedEntity(value: unknown): NamedEntity | null {
  if (typeof value !== "object" || value === null) return null;
  const source = value as Record<string, unknown>;
  const id = toNumberOrNull(source.id);
  if (id === null) return null;
  return {
    id,
    name: typeof source.name === "string" ? source.name : undefined,
    display_name: typeof source.display_name === "string" ? source.display_name : undefined,
    code: typeof source.code === "string" ? source.code : undefined,
  };
}

function normalizeChartFilters(value: unknown): ChartFilter[] {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is ChartFilter => typeof entry === "object" && entry !== null) as ChartFilter[];
  }

  if (typeof value !== "object" || value === null) return [];

  return Object.entries(value as Record<string, unknown>).flatMap(([fieldName, values]) => {
    if (!Array.isArray(values)) return [];
    return values.map((item) => ({
      value: String(item ?? ""),
      field_detail: asChartFieldName(fieldName) ? { name: fieldName as ChartFieldName } : null,
    }));
  });
}

function serializeChartFilters(filters: Record<string, string[]>): ChartFilter[] {
  return Object.entries(filters).flatMap(([fieldName, values]) => {
    const normalizedField = asChartFieldName(fieldName);
    if (!normalizedField) return [];
    const fieldLabel = LEGACY_CHART_FIELDS.find((field) => field.value === normalizedField)?.label;
    const distinctValues = Array.from(new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean)));
    return distinctValues.map((value) => ({
      value,
      field_detail: {
        name: normalizedField,
        label: fieldLabel,
      },
    }));
  });
}

function asChartType(value: unknown): LegacyChartType {
  if (value === "pie" || value === "line" || value === "bar") return value;
  return "bar";
}

function asChartAxis(value: unknown): LegacyChartAxis | null {
  if (value === "month" || value === "quarter") return value;
  return null;
}

function asChartFieldName(value: unknown): ChartFieldName | null {
  return LEGACY_CHART_FIELDS.some((field) => field.value === value) ? (value as ChartFieldName) : null;
}

function normalizeChart(
  raw: unknown,
  options?: {
    chartLinkId?: number | null;
  },
): IndicatorChartSetting {
  const source = (raw || {}) as Record<string, unknown>;
  const chartsFromParams = Array.isArray(source.charts) ? source.charts : [];
  const nestedIndicators = toNumberArray(source.indicators);
  const indicatorDetails = Array.isArray(source.indicator_details)
    ? (source.indicator_details as IndicatorChartSetting["indicator_details"])
    : Array.isArray(source.indicators)
      ? (source.indicators
          .map((indicator) => {
            if (typeof indicator !== "object" || indicator === null) return null;
            const details = indicator as Record<string, unknown>;
            const id = toNumberOrNull(details.id);
            if (id === null) return null;
            return {
              id,
              name:
                typeof details.display_name === "string"
                  ? details.display_name
                  : typeof details.name === "string"
                    ? details.name
                    : undefined,
              code: typeof details.code === "string" ? details.code : undefined,
              type: typeof details.type === "string" ? details.type : undefined,
              category: typeof details.category === "string" ? details.category : undefined,
              options: Array.isArray(details.options)
                ? (details.options as Array<string | { label: string; value: string }>)
                : undefined,
            };
          })
          .filter((indicator): indicator is NonNullable<typeof indicator> => indicator !== null) as IndicatorChartSetting["indicator_details"])
      : undefined;

  return {
    id: options?.chartLinkId ?? (typeof source.id === "number" ? source.id : undefined),
    name: typeof source.name === "string" ? source.name : null,
    display_name: typeof source.display_name === "string" ? source.display_name : undefined,
    indicators: nestedIndicators,
    indicator_details: indicatorDetails,
    chart_type: asChartType(source.chart_type),
    tabular: Boolean(source.tabular),
    axis: asChartAxis(source.axis),
    legend: asChartFieldName(source.legend),
    stack: asChartFieldName(source.stack),
    use_target: Boolean(source.use_target ?? source.use_targets),
    filters: normalizeChartFilters(source.filters),
    average: Boolean(source.average),
    repeat_only: Boolean(source.repeat_only),
    repeat_n:
      typeof source.repeat_n === "number"
        ? source.repeat_n
        : typeof source.repeat_n === "string" && source.repeat_n.trim()
          ? Number(source.repeat_n)
          : null,
    start: typeof source.start === "string" ? source.start : null,
    end: typeof source.end === "string" ? source.end : null,
    chart_data:
      typeof source.chart_data === "object" && source.chart_data !== null
        ? (source.chart_data as Record<string, unknown> | Array<Record<string, unknown>>)
        : undefined,
    targets: Array.isArray(source.targets) ? (source.targets as Array<Record<string, number>>) : undefined,
    allow_targets: typeof source.allow_targets === "boolean" ? source.allow_targets : undefined,
    created_by: typeof source.created_by === "number" ? source.created_by : null,
    created_at: typeof source.created_at === "string" ? source.created_at : undefined,
    updated_at: typeof source.updated_at === "string" ? source.updated_at : undefined,
    ...(chartsFromParams.length ? normalizeChart(chartsFromParams[0], options) : {}),
  };
}

function normalizeDashboardChartLink(raw: unknown): DashboardIndicatorChart | null {
  if (typeof raw !== "object" || raw === null) return null;
  const source = raw as Record<string, unknown>;
  const id = toNumberOrNull(source.id);
  const chartSource =
    typeof source.chart === "object" && source.chart !== null
      ? source.chart
      : typeof source.chart_detail === "object" && source.chart_detail !== null
        ? source.chart_detail
        : source;

  const chartDetail = normalizeChart(chartSource, { chartLinkId: id });

  return {
    id: id ?? undefined,
    dashboard: toNumberOrNull(source.dashboard) ?? undefined,
    chart: chartDetail.id,
    chart_detail: chartDetail,
    order: toNumberOrNull(source.order) ?? undefined,
    width: typeof source.width === "string" ? source.width : null,
    height: typeof source.height === "string" ? source.height : null,
  };
}

function normalizeFallbackDashboard(report: RawReportDashboard): DashboardSetting {
  const parameters = report.parameters || {};
  const legacyIndicatorIds = toNumberArray(parameters.indicator_ids);
  const charts = Array.isArray(parameters.charts) && parameters.charts.length
    ? (parameters.charts as unknown[]).map((chart, index) =>
        normalizeChart(chart, {
          chartLinkId:
            toNumberOrNull(
              typeof chart === "object" && chart !== null ? (chart as { id?: unknown }).id : null,
            ) ?? Number(`${report.id}${String(index + 1).padStart(3, "0")}`),
        }),
      )
    : legacyIndicatorIds.length > 0
      ? [
        normalizeChart(
          {
            indicators: legacyIndicatorIds,
            chart_type: parameters.chart_type,
            axis: parameters.chart_axis,
            legend: parameters.chart_legend,
            stack: parameters.chart_stack,
            tabular: parameters.chart_tabular,
            use_target: parameters.use_target,
            average: parameters.average,
            repeat_only: parameters.repeat_only,
            repeat_n: parameters.repeat_n,
            start: parameters.date_from,
            end: parameters.date_to,
          },
          {
            chartLinkId: Number(`${report.id}001`),
          },
        ),
      ]
      : [];

  return {
    id: report.id,
    name: report.name,
    display_name: report.name,
    description: report.description ?? "",
    project:
      typeof parameters.project_id === "number"
        ? parameters.project_id
        : typeof parameters.project_id === "string"
          ? Number(parameters.project_id)
          : null,
    organization:
      typeof report.organization === "number"
        ? report.organization
        : typeof parameters.organization_id === "number"
          ? parameters.organization_id
          : typeof parameters.organization_id === "string"
            ? Number(parameters.organization_id)
            : null,
    organization_name: report.organization_name,
    cascade_organization: Boolean(parameters.cascade_organization),
    charts,
    created_by: report.created_by ?? null,
    created_by_name: report.created_by_name,
    created_at: report.created_at,
    updated_at: report.updated_at,
  };
}

function normalizeDashboard(dashboard: RawDashboardResponse): DashboardSetting {
  if (dashboard.report_type === "dashboard") {
    return normalizeFallbackDashboard(dashboard as unknown as RawReportDashboard);
  }

  const projectDetail = normalizeNamedEntity(dashboard.project);
  const organizationDetail = normalizeNamedEntity(dashboard.organization);
  const chartLinks = Array.isArray(dashboard.indicator_charts)
    ? dashboard.indicator_charts
        .map((entry) => normalizeDashboardChartLink(entry))
        .filter((entry): entry is DashboardIndicatorChart => entry !== null)
    : [];

  const chartSource = Array.isArray(dashboard.charts_detail)
    ? dashboard.charts_detail
    : Array.isArray(dashboard.charts)
      ? dashboard.charts
      : [];

  const charts = chartLinks.length
    ? chartLinks.map((chartLink) => chartLink.chart_detail).filter((chart): chart is IndicatorChartSetting => Boolean(chart))
    : chartSource.map((chart) => normalizeChart(chart));

  return {
    id: dashboard.id,
    name: dashboard.name || "Dashboard",
    display_name: dashboard.name || "Dashboard",
    description: dashboard.description ?? "",
    project: toNumberOrNull(dashboard.project),
    project_name: projectDetail?.display_name || projectDetail?.name,
    organization: toNumberOrNull(dashboard.organization),
    organization_name: organizationDetail?.display_name || organizationDetail?.name,
    cascade_organization: Boolean(dashboard.cascade_organization),
    charts,
    chart_links: chartLinks,
    created_by: toNumberOrNull(dashboard.created_by),
    created_by_name: dashboard.created_by_name,
    created_at: dashboard.created_at,
    updated_at: dashboard.updated_at,
  };
}

function toFallbackDashboardPayload(request: DashboardSettingRequest) {
  const firstChart = request.charts?.[0];

  return {
    name: request.name,
    description: request.description ?? "",
    report_type: "dashboard",
    organization: request.organization_id ?? null,
    is_public: false,
    parameters: {
      project_id: request.project_id ?? null,
      organization_id: request.organization_id ?? null,
      cascade_organization: request.cascade_organization ?? false,
      indicator_ids: firstChart?.indicators ?? [],
      chart_type: firstChart?.chart_type ?? null,
      chart_axis: firstChart?.axis ?? null,
      chart_legend: firstChart?.legend ?? null,
      chart_stack: firstChart?.stack ?? null,
      chart_tabular: firstChart ? Boolean(firstChart.tabular) : null,
      use_target: firstChart ? Boolean(firstChart.use_target) : null,
      average: firstChart ? Boolean(firstChart.average) : null,
      repeat_only: firstChart ? Boolean(firstChart.repeat_only) : null,
      repeat_n: firstChart?.repeat_n ?? null,
      date_from: firstChart?.start ?? null,
      date_to: firstChart?.end ?? null,
      charts: request.charts ?? [],
      legacy_dashboard: true,
    },
  };
}

function normalizePaginatedDashboards(response: PaginatedResponse<RawDashboardResponse>): PaginatedResponse<DashboardSetting> {
  return {
    ...response,
    results: (response.results || []).map((dashboard) => normalizeDashboard(dashboard)),
  };
}

function normalizeDashboardMeta(raw: unknown): DashboardMeta {
  const source = (raw || {}) as Record<string, unknown>;
  const chartTypes = Array.isArray(source.chart_types) ? source.chart_types : [];
  const axes = Array.isArray(source.axes) ? source.axes : [];
  const fields = Array.isArray(source.fields) ? source.fields : [];

  return {
    chart_types: chartTypes
      .filter((entry): entry is AnalyticsOption => typeof entry === "object" && entry !== null)
      .map((entry) => ({
        value: String((entry as { value?: unknown }).value ?? ""),
        label: String((entry as { label?: unknown }).label ?? ""),
      })),
    axes: axes
      .filter((entry): entry is AnalyticsOption => typeof entry === "object" && entry !== null)
      .map((entry) => ({
        value: String((entry as { value?: unknown }).value ?? ""),
        label: String((entry as { label?: unknown }).label ?? ""),
      })),
    fields: fields
      .filter((entry): entry is AnalyticsOption & { value: ChartFieldName } => typeof entry === "object" && entry !== null)
      .map((entry) => ({
        value: String((entry as { value?: unknown }).value ?? "") as ChartFieldName,
        label: String((entry as { label?: unknown }).label ?? ""),
      })),
  };
}

function normalizeMatrixRows(value: unknown): Array<Array<string | number | null>> {
  const coerceCell = (cell: unknown): string | number | null => {
    if (typeof cell === "string" || typeof cell === "number") return cell;
    if (cell === null || cell === undefined) return null;
    if (typeof cell === "boolean") return cell ? "Yes" : "No";
    return String(cell);
  };

  if (Array.isArray(value)) {
    if (value.every((row) => Array.isArray(row))) {
      return value.map((row) => (row as unknown[]).map((cell) => coerceCell(cell)));
    }

    if (value.every((row) => typeof row === "object" && row !== null && !Array.isArray(row))) {
      const rows = value as Array<Record<string, unknown>>;
      const headers = Array.from(
        rows.reduce((headerSet, row) => {
          Object.keys(row).forEach((key) => headerSet.add(key));
          return headerSet;
        }, new Set<string>()),
      );

      if (headers.length === 0) return [];

      return [
        headers,
        ...rows.map((row) => headers.map((header) => coerceCell(row[header]))),
      ];
    }
  }

  if (typeof value !== "object" || value === null) return [];

  const source = value as Record<string, unknown>;
  const explicitHeaders = Array.isArray(source.headers)
    ? source.headers.map((header) => coerceCell(header))
    : Array.isArray(source.columns)
      ? source.columns.map((header) => coerceCell(header))
      : [];
  const nestedRows = source.rows ?? source.data ?? source.results ?? source.cached_data ?? source.table ?? source.matrix;
  const normalizedNestedRows = normalizeMatrixRows(nestedRows);
  if (normalizedNestedRows.length === 0) return [];

  if (explicitHeaders.length === 0) return normalizedNestedRows;
  if (normalizedNestedRows.length > 0 && normalizedNestedRows[0]?.every((cell, index) => cell === explicitHeaders[index])) {
    return normalizedNestedRows;
  }

  return [explicitHeaders, ...normalizedNestedRows];
}

function isDashboardLikeResponse(value: unknown): value is RawDashboardResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    ("name" in value || "charts" in value || "charts_detail" in value || "indicator_charts" in value)
  );
}

// Saved dashboards are persisted as analysis Reports with report_type="dashboard".
// There is no separate /analysis/dashboards/ route on the backend, so every method
// targets /analysis/reports/ directly. (Chart metadata/breakdowns are client-side;
// see getMeta/getBreakdowns.) The previous implementation probed phantom
// /analysis/dashboards/* endpoints that always 404'd before falling back here.
export const dashboardSettingsService = {
  async list(filters?: DashboardSettingsFilters): Promise<PaginatedResponse<DashboardSetting>> {
    const params = {
      ...(filters || {}),
      report_type: "dashboard",
    } as Record<string, string | number | boolean | null | undefined>;
    const { data } = await api.get<PaginatedResponse<RawReportDashboard>>("/analysis/reports/", params);
    return {
      ...data,
      results: (data.results || []).map((dashboard) => normalizeFallbackDashboard(dashboard)),
    };
  },

  async get(id: number): Promise<DashboardSetting> {
    const { data } = await api.get<RawReportDashboard>(`/analysis/reports/${id}/`);
    return normalizeFallbackDashboard(data);
  },

  // The per-organization "home" dashboard. Get-or-created server-side; charts
  // shared from the Analysis Visualizer land here and render on /dashboard.
  async getHome(organizationId?: number | string | null): Promise<DashboardSetting> {
    const params: Record<string, string | number> = {};
    if (organizationId !== undefined && organizationId !== null && `${organizationId}`.trim()) {
      params.organization = organizationId;
    }
    const { data } = await api.get<RawReportDashboard>("/analysis/reports/home/", params);
    return normalizeFallbackDashboard(data);
  },

  async create(request: DashboardSettingRequest): Promise<DashboardSetting> {
    const { data } = await api.post<RawReportDashboard>("/analysis/reports/", toFallbackDashboardPayload(request));
    return normalizeFallbackDashboard(data);
  },

  async update(id: number, request: Partial<DashboardSettingRequest>): Promise<DashboardSetting> {
    const { data } = await api.patch<RawReportDashboard>(
      `/analysis/reports/${id}/`,
      toFallbackDashboardPayload({
        name: request.name || "Dashboard",
        description: request.description ?? "",
        project_id: request.project_id ?? null,
        organization_id: request.organization_id ?? null,
        cascade_organization: request.cascade_organization ?? false,
        charts: request.charts ?? [],
      }),
    );
    return normalizeFallbackDashboard(data);
  },

  async delete(id: number): Promise<void> {
    await api.delete(`/analysis/reports/${id}/`);
  },

  async getMeta(): Promise<DashboardMeta> {
    // Chart metadata is defined client-side; the backend has no meta endpoint.
    return {
      chart_types: [
        { value: "pie", label: "Pie Chart" },
        { value: "line", label: "Line Chart" },
        { value: "bar", label: "Bar Chart" },
      ],
      axes: [
        { value: "month", label: "Month" },
        { value: "quarter", label: "Quarter" },
      ],
      fields: LEGACY_CHART_FIELDS,
    };
  },

  async getBreakdowns(): Promise<Record<string, unknown>> {
    // No backend breakdowns endpoint; breakdowns are derived client-side.
    return {};
  },

  // Chart edits are persisted by reading the dashboard, mutating its charts, and
  // writing the whole dashboard back via update() (i.e. the reports record).
  async updateChartFilters(
    dashboardId: number,
    chartId: number,
    filters: Record<string, string[]>,
  ): Promise<DashboardSetting> {
    const dashboard = await this.get(dashboardId);
    const charts = [...(dashboard.charts || [])];
    const chartIndex = charts.findIndex((chart) => chart.id === chartId);
    if (chartIndex < 0) return dashboard;

    charts[chartIndex] = {
      ...charts[chartIndex],
      filters: serializeChartFilters(filters),
    };

    return this.update(dashboardId, {
      name: dashboard.name,
      description: dashboard.description ?? "",
      project_id: dashboard.project ?? null,
      organization_id: dashboard.organization ?? null,
      cascade_organization: dashboard.cascade_organization ?? false,
      charts,
    });
  },

  async saveChart(dashboardId: number, request: DashboardChartRequest): Promise<DashboardSetting> {
    const dashboard = await this.get(dashboardId);
    const charts = [...(dashboard.charts || [])];
    const index = charts.findIndex((chart) => chart.id === request.id);
    const nextChart: IndicatorChartSetting = {
      id: request.id ?? charts[index]?.id,
      name: request.name ?? null,
      indicators: request.indicators,
      chart_type: request.chart_type,
      tabular: Boolean(request.tabular),
      axis: request.axis ?? null,
      legend: request.legend ?? null,
      stack: request.stack ?? null,
      use_target: Boolean(request.use_target),
      filters: request.filters ?? [],
      average: Boolean(request.average),
      repeat_only: Boolean(request.repeat_only),
      repeat_n: request.repeat_n ?? null,
      start: request.start ?? null,
      end: request.end ?? null,
    };

    if (index >= 0) charts[index] = nextChart;
    else charts.push(nextChart);

    return this.update(dashboardId, {
      name: dashboard.name,
      description: dashboard.description ?? "",
      project_id: dashboard.project ?? null,
      organization_id: dashboard.organization ?? null,
      cascade_organization: dashboard.cascade_organization ?? false,
      charts,
    });
  },

  async removeChart(dashboardId: number, chartId: number): Promise<DashboardSetting> {
    const dashboard = await this.get(dashboardId);
    const charts = (dashboard.charts || []).filter((chart) => chart.id !== chartId);
    return this.update(dashboardId, {
      name: dashboard.name,
      description: dashboard.description ?? "",
      project_id: dashboard.project ?? null,
      organization_id: dashboard.organization ?? null,
      cascade_organization: dashboard.cascade_organization ?? false,
      charts,
    });
  },
};

export const requestLogsService = {
  async list(params?: { page?: string | number; page_size?: string | number }): Promise<PaginatedResponse<RequestLog>> {
    const query = params as Record<string, string | number | boolean | null | undefined> | undefined;
    const { data } = await api.get<PaginatedResponse<RequestLog>>("/analysis/request-logs/", query);
    return data;
  },
};
