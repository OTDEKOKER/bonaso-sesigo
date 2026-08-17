/**
 * Aggregates Service
 * 
 * CRUD operations for aggregate data (tabular data without respondent linking).
 * Django endpoint base: /api/aggregates/
 */

import { api, fetchWithAuth, normalizeApiError, type PaginatedResponse } from '../client';
import type { Aggregate } from '@/lib/types';
import { uploadsService, type ExportJob } from './uploads';
import {
  getCanonicalIndicatorLabelById,
  normalizeIndicatorDisplayName,
  resolveIndicatorIdString,
} from '@/lib/indicators/id-aliases';

// Reporting-workbook import is a synchronous, full-workbook parse + per-row
// validation, so it needs far more than the default 15s API timeout. Matches the
// backend gunicorn --timeout (120s) so a large valid upload isn't aborted client-side.
const WORKBOOK_IMPORT_TIMEOUT_MS = 120_000;

// ============================================================================
// Types
// ============================================================================

/**
 * Sesigo Training Mode: when the aggregates page is used under /training, write
 * + download endpoints must carry training_only=true so the backend keeps the
 * live/training boundary (a training session may only touch training projects).
 * fetchWithAuth (unlike the api.* helpers) does not append this automatically.
 */
function withTrainingQuery(endpoint: string): string {
  if (typeof window === 'undefined') return endpoint;
  const path = window.location.pathname || '';
  if (path !== '/training' && !path.startsWith('/training/')) return endpoint;
  if (/[?&]training_only=/.test(endpoint)) return endpoint;
  return `${endpoint}${endpoint.includes('?') ? '&' : '?'}training_only=true`;
}

export interface ReportingWorkbookImportSummary {
  project?: string;
  project_id?: number;
  organization?: string;
  organization_id?: number;
  quarter?: string | number;
  period_start?: string;
  period_end?: string;
  workbook_version?: string;
  indicators_found?: number;
  indicators_valid?: number;
  indicators_failed?: number;
  created?: number;
  updated?: number;
}

export interface ReportingWorkbookImportResult {
  dry_run?: boolean;
  error?: string;
  messages?: string[];
  summary?: ReportingWorkbookImportSummary;
  errors?: Array<{ indicator?: string | number; error?: string }>;
}

export interface AggregateFilters {
  search?: string;
  indicator?: string;
  project?: string;
  period?: string;
  date_from?: string;
  date_to?: string;
  organization?: string;
  coordinator?: string;
  include_org_descendants?: string;
  include_training?: string;
  status?: string;
  page?: string;
  page_size?: string;
  // Opt-in lightweight projection: drops notes + review/audit fields the
  // dashboard never reads, shrinking the bulk fetch payload. Do not use on
  // screens that show notes/review metadata (e.g. the Aggregates review page).
  light?: string;
}

export interface CreateAggregateRequest {
  indicator: number;
  project: number;
  organization: number;
  period_start: string;
  period_end: string;
  value: unknown;
  notes?: string;
}

export type UpdateAggregateRequest = Partial<CreateAggregateRequest>

export interface BulkAggregateRequest {
  project: number;
  organization: number;
  period_start: string;
  period_end: string;
  data: Array<{
    indicator: number;
    value: unknown;
    notes?: string;
  }>;
}

export interface AggregateTemplate {
  id: number;
  name: string;
  indicators: Array<{
    id: number;
    name: string;
    code: string;
    type: string;
    disaggregation_fields?: string[];
  }>;
}

export interface GenerateFromInteractionsRequest {
  output_indicator: number;
  source_indicator: number;
  operator?: 'equals' | 'not_equals' | 'contains';
  match_value?: unknown;
  count_distinct?: 'respondent' | 'interaction';
  project: number;
  organization: number;
  period_start: string;
  period_end: string;
  save_rule?: boolean;
  save_aggregate?: boolean;
}

export interface GenerateFromInteractionsResponse {
  computed: number;
  rule: unknown;
  aggregate?: Aggregate | null;
}

export interface AggregateReviewRequest {
  notes?: string;
}

export interface BulkApproveResponse {
  approved: number;
  skipped: number;
  results: Aggregate[];
}

export interface BulkDeleteResponse {
  deleted: number;
  skipped: number;
}

export interface AggregateFlagRequest {
  reason: 'duplicate' | 'incorrect_data' | 'suspicious' | 'incomplete' | 'other';
  description?: string;
  severity?: 'low' | 'medium' | 'high';
}

export interface DetectCopyPasteResult {
  groups_detected?: number;
  flags_created?: number;
  aggregates_flagged?: number;
  total_groups?: number;
  total_aggregates?: number;
  groups?: Array<{
    org: string;
    period: string;
    median: number;
    count: number;
    indicators: string[];
  }>;
}

export interface DerivationRule {
  id: number;
  output_indicator: number;
  output_indicator_code?: string;
  output_indicator_name?: string;
  source_indicator: number;
  source_indicator_code?: string;
  source_indicator_name?: string;
  operator: 'equals' | 'not_equals' | 'contains';
  match_value?: unknown;
  count_distinct: 'respondent' | 'interaction';
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// Drop undefined/empty filters so we do not send project=undefined.
const cleanParams = (filters?: Record<string, string | undefined | null>) => {
  if (!filters) return undefined;
  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === "") continue;
    params[key] = String(value);
  }
  return Object.keys(params).length ? params : undefined;
};

const normalizeAggregate = (aggregate: Aggregate): Aggregate => {
  const resolvedIndicatorId = resolveIndicatorIdString(aggregate.indicator);
  const canonicalLabel = getCanonicalIndicatorLabelById(aggregate.indicator);
  const rawIndicatorName = String(aggregate.indicator_name || "").trim();
  const normalizedName = normalizeIndicatorDisplayName(
    canonicalLabel || rawIndicatorName || null,
  );

  return {
    ...aggregate,
    indicator: resolvedIndicatorId,
    indicator_name: normalizedName || aggregate.indicator_name,
    status: aggregate.status ?? 'approved',
  };
};

const normalizeAggregateList = (aggregates?: Aggregate[] | null): Aggregate[] =>
  (aggregates || []).map(normalizeAggregate);

// ============================================================================
// Aggregates Service
// ============================================================================

// Matches the backend AggregatePagination.max_page_size (5000). The all-pages
// fetch reassembles the full scoped set client-side, so the only thing page
// size controls is how many round trips it takes. A larger page means far fewer
// pages (~19k approved rows → 4 pages instead of ~38), and each aggregates list
// request forces a full result-set sort + COUNT on the DB, so cutting the page
// count is the dominant win for the Aggregates page load. Must never exceed
// max_page_size or DRF clamps the response while the client keeps paging by the
// requested size — which would silently drop rows.
const LIST_ALL_PAGE_SIZE = '5000';
const LIST_ALL_MAX_PAGES = 500;
const LIST_ALL_REQUEST_TIMEOUT_MS = 45_000;
const LIST_ALL_MAX_RETRIES = 2;
const LIST_ALL_RETRY_DELAY_MS = 700;

type ListAllPageParams = Record<string, string>;

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchListAllPage(
  params: ListAllPageParams,
  page: string,
): Promise<PaginatedResponse<Aggregate>> {
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= LIST_ALL_MAX_RETRIES; attempt += 1) {
    try {
      const { data } = await api.get<PaginatedResponse<Aggregate>>(
        '/aggregates/',
        { ...params, page },
        { timeoutMs: LIST_ALL_REQUEST_TIMEOUT_MS },
      );
      return data;
    } catch (error) {
      lastError = error;
      const isLastAttempt = attempt >= LIST_ALL_MAX_RETRIES;
      if (isLastAttempt) break;
      await delay(LIST_ALL_RETRY_DELAY_MS * (attempt + 1));
    }
  }

  throw normalizeApiError({
    status: (lastError as { status?: number } | null)?.status || 0,
    payload: lastError,
    fallbackMessage: `Failed to load aggregates page ${page}.`,
  });
}

export const aggregatesService = {
  /**
   * List all aggregates with optional filters
   * Django endpoint: GET /api/aggregates/
   */
  async list(filters?: AggregateFilters): Promise<PaginatedResponse<Aggregate>> {
    const params = cleanParams(filters as Record<string, string | undefined>);
    const { data } = await api.get<PaginatedResponse<Aggregate>>('/aggregates/', params);
    return {
      ...data,
      results: normalizeAggregateList(data.results),
    };
  },
  /**
   * List all aggregates across all pages
   */
  async listAll(filters?: AggregateFilters): Promise<Aggregate[]> {
    const results: Aggregate[] = [];
    const startPage = Math.max(1, Number(filters?.page || 1));
    const baseFilters =
      cleanParams({ ...(filters || {}) } as Record<string, string | undefined>) || {};
    delete baseFilters.page;
    if (!baseFilters.page_size) {
      baseFilters.page_size = LIST_ALL_PAGE_SIZE;
    }

    const firstPage = await fetchListAllPage(baseFilters, String(startPage));

    const firstPageResults = normalizeAggregateList(firstPage.results);
    results.push(...firstPageResults);

    if (!firstPage.next || firstPageResults.length === 0) {
      return results;
    }

    // The first page tells us the total count, so we can resolve the remaining
    // page numbers up front and fetch them in PARALLEL (bounded concurrency)
    // instead of one-at-a-time. On slow links this turns a chain of blocking
    // round trips into a single fan-out — the dominant win for the aggregates
    // page and the dashboard analytics pull. If the count is unavailable we fall
    // back to walking `next` links sequentially.
    const pageSize = Math.max(1, Number(baseFilters.page_size) || Number(LIST_ALL_PAGE_SIZE));
    const totalCount = Number(firstPage.count);

    if (Number.isFinite(totalCount) && totalCount > firstPageResults.length) {
      const totalPages = Math.ceil(totalCount / pageSize);
      const lastPage = Math.min(startPage + LIST_ALL_MAX_PAGES - 1, totalPages);
      const remainingPages: number[] = [];
      for (let page = startPage + 1; page <= lastPage; page += 1) {
        remainingPages.push(page);
      }

      // Cap simultaneous in-flight requests so we don't overwhelm the single
      // backend host; pages within a batch run concurrently.
      const CONCURRENCY = 4;
      for (let i = 0; i < remainingPages.length; i += CONCURRENCY) {
        const batch = remainingPages.slice(i, i + CONCURRENCY);
        const pages = await Promise.all(
          batch.map((page) => fetchListAllPage(baseFilters, String(page))),
        );
        for (const data of pages) {
          results.push(...normalizeAggregateList(data.results));
        }
      }

      return results;
    }

    // Fallback: no usable count — walk the `next` links sequentially.
    let nextUrl: string | null = firstPage.next;
    let pagesFetched = 1;

    while (nextUrl && pagesFetched < LIST_ALL_MAX_PAGES) {
      let nextPage: string | null = null;

      try {
        const parsedNextUrl = new URL(nextUrl, 'https://sesigo.org.bw');
        nextPage = parsedNextUrl.searchParams.get('page');
      } catch {
        nextPage = null;
      }

      if (!nextPage) {
        break;
      }

      const data = await fetchListAllPage(baseFilters, nextPage);

      results.push(...normalizeAggregateList(data.results));
      nextUrl = data.next;
      pagesFetched += 1;
    }

    return results;
  },

  /**
   * Get a single aggregate by ID
   * Django endpoint: GET /api/aggregates/:id/
   */
  async get(id: number): Promise<Aggregate> {
    const { data } = await api.get<Aggregate>(`/aggregates/${id}/`);
    return normalizeAggregate(data);
  },

  /**
   * Create a new aggregate
   * Django endpoint: POST /api/aggregates/
   */
  async create(request: CreateAggregateRequest): Promise<Aggregate> {
    const { data } = await api.post<Aggregate>('/aggregates/', request);
    return normalizeAggregate(data);
  },

  /**
   * Update an aggregate
   * Django endpoint: PATCH /api/aggregates/:id/
   */
  async update(id: number, request: UpdateAggregateRequest): Promise<Aggregate> {
    const { data } = await api.patch<Aggregate>(`/aggregates/${id}/`, request);
    return normalizeAggregate(data);
  },

  /**
   * Delete an aggregate
   * Django endpoint: DELETE /api/aggregates/:id/
   */
  async delete(id: number): Promise<void> {
    await api.delete(`/aggregates/${id}/`);
  },

  /**
   * Bulk create aggregates
   * Django endpoint: POST /api/aggregates/bulk_create/
   */
  async bulkCreate(request: BulkAggregateRequest): Promise<Aggregate[]> {
    const { data } = await api.post<{ results: Aggregate[] }>('/aggregates/bulk_create/', request);
    return normalizeAggregateList(data.results);
  },

  async review(id: number, request?: AggregateReviewRequest): Promise<Aggregate> {
    const { data } = await api.post<Aggregate>(`/aggregates/${id}/review/`, request || {});
    return normalizeAggregate(data);
  },

  async approve(id: number, request?: AggregateReviewRequest): Promise<Aggregate> {
    const { data } = await api.post<Aggregate>(`/aggregates/${id}/approve/`, request || {});
    return normalizeAggregate(data);
  },

  async bulkApprove(ids: number[]): Promise<BulkApproveResponse> {
    const { data } = await api.post<BulkApproveResponse>(
      '/aggregates/bulk_approve/',
      { ids },
      { timeoutMs: 120_000 },
    );
    return {
      ...data,
      results: normalizeAggregateList(data.results),
    };
  },

  async bulkDelete(ids: number[]): Promise<BulkDeleteResponse> {
    const { data } = await api.post<BulkDeleteResponse>(
      '/aggregates/bulk_delete/',
      { ids },
      { timeoutMs: 120_000 },
    );
    return data;
  },

  async flag(id: number, request: AggregateFlagRequest): Promise<Aggregate> {
    const { data } = await api.post<Aggregate>(`/aggregates/${id}/flag/`, request);
    return normalizeAggregate(data);
  },

  async reject(id: number, request?: AggregateFlagRequest): Promise<Aggregate> {
    const { data } = await api.post<Aggregate>(`/aggregates/${id}/reject/`, request || {});
    return normalizeAggregate(data);
  },

  async unflag(id: number, notes?: string): Promise<Aggregate> {
    const { data } = await api.post<Aggregate>(`/aggregates/${id}/unflag/`, { notes: notes || '' });
    return normalizeAggregate(data);
  },

  async detectCopyPaste(params?: {
    min_count?: number;
    tolerance?: number;
    project_id?: number;
    dry_run?: boolean;
  }): Promise<DetectCopyPasteResult> {
    const { data } = await api.post<DetectCopyPasteResult>('/aggregates/detect_copy_paste/', params || {});
    return data;
  },

  /**
   * Get aggregate templates (predefined indicator sets)
   * Django endpoint: GET /api/aggregates/templates/
   */
  async getTemplates(filters?: { project?: string; organization?: string }): Promise<AggregateTemplate[]> {
    const params = cleanParams(filters as Record<string, string | undefined>);
    const { data } = await api.get<AggregateTemplate[]>('/aggregates/templates/', params);
    return data;
  },

  /**
   * List the distinct reporting periods available for the scoped (approved)
   * aggregates, so the browse fetch can be scoped by the chosen period instead
   * of downloading every row up front to derive the quarter dropdown.
   * Django endpoint: GET /api/aggregates/periods/
   */
  async getPeriods(filters?: {
    project?: string;
    organization?: string;
    coordinator?: string;
    include_org_descendants?: string;
    include_training?: string;
  }): Promise<Array<{ period_start: string; period_end: string }>> {
    const params = cleanParams(filters as Record<string, string | undefined>);
    const { data } = await api.get<{
      results: Array<{ period_start: string; period_end: string }>;
    }>('/aggregates/periods/', params);
    return Array.isArray(data?.results) ? data.results : [];
  },

  /**
   * Get aggregate summary by indicator
   * Django endpoint: GET /api/aggregates/summary/
   */
  async getSummary(filters?: {
    project?: string;
    period?: string;
    date_from?: string;
    date_to?: string;
  }): Promise<Array<{
    indicator_id: number;
    indicator_name: string;
    total_value: number;
    period_count: number;
    trend: 'up' | 'down' | 'stable';
  }>> {
    const params = cleanParams(filters as Record<string, string | undefined>);
    const { data } = await api.get('/aggregates/summary/', params);
    return data as Array<{
      indicator_id: number;
      indicator_name: string;
      total_value: number;
      period_count: number;
      trend: 'up' | 'down' | 'stable';
    }>;
  },

  /**
   * Export aggregates to file
   * Django endpoint: GET /api/aggregates/export/
   */
  async export(
    filters?: AggregateFilters & {
      format?: 'csv' | 'excel';
      sheet_layout?: 'single' | 'organization' | 'organization_template' | 'template';
    },
  ): Promise<Blob> {
    const { format, sheet_layout, ...rest } = filters ?? {};
    const params = cleanParams({
      ...(rest as Record<string, string | undefined>),
      file_format: format,
      sheet_layout,
    });
    const qs = params ? `?${new URLSearchParams(params).toString()}` : '';
    const response = await fetchWithAuth(`/aggregates/export/${qs}`);
    if (!response.ok) {
      const contentType = response.headers.get('content-type');
      const payload = contentType?.includes('application/json')
        ? await response.json()
        : await response.text();
      throw normalizeApiError({
        status: response.status,
        payload,
        fallbackMessage: 'Failed to export aggregates',
      });
    }
    return response.blob();
  },

  /**
   * Download a reporting workbook (NAHPA/CBO-style) for a project/org/quarter.
   * Django endpoint: GET /api/aggregates/reporting-workbook/
   * Pass withData=true to pre-fill current submissions (round-trip editing).
   */
  async downloadReportingWorkbook(params: {
    project: string | number;
    organization: string | number;
    quarter: string; // e.g. "Q3"
    fiscal_year: string | number;
    withData?: boolean;
    periodType?: 'quarter' | 'year' | 'month';
    month?: string | number; // 1-12, required when periodType === 'month'
  }): Promise<Blob> {
    const search = new URLSearchParams({
      project: String(params.project),
      organization: String(params.organization),
      quarter: params.quarter,
      fiscal_year: String(params.fiscal_year),
    });
    if (params.periodType) search.set('period_type', params.periodType);
    if (params.periodType === 'month' && params.month != null) search.set('month', String(params.month));
    if (params.withData) search.set('with_data', 'true');
    const response = await fetchWithAuth(
      withTrainingQuery(`/aggregates/reporting-workbook/?${search.toString()}`),
      { timeoutMs: 180_000 }, // workbook generation can take a while; never use the short default
    );
    if (!response.ok) {
      const contentType = response.headers.get('content-type');
      const payload = contentType?.includes('application/json')
        ? await response.json()
        : await response.text();
      throw normalizeApiError({
        status: response.status,
        payload,
        fallbackMessage: 'Failed to download reporting workbook',
      });
    }
    return response.blob();
  },

  /**
   * Download a coordinator rollup workbook: one reporting-form sheet per
   * sub-organisation (and the coordinator's own) plus a TOTAL sheet that sums
   * them. Django endpoint: GET /api/aggregates/coordinator-workbook/
   */
  async downloadCoordinatorWorkbook(params: {
    project: string | number;
    coordinator: string | number;
    quarter: string; // e.g. "Q1"
    fiscal_year: string | number;
    periodType?: 'quarter' | 'year' | 'month';
    month?: string | number;
  }): Promise<Blob> {
    const search = new URLSearchParams({
      project: String(params.project),
      coordinator: String(params.coordinator),
      quarter: params.quarter,
      fiscal_year: String(params.fiscal_year),
    });
    if (params.periodType) search.set('period_type', params.periodType);
    if (params.periodType === 'month' && params.month != null) search.set('month', String(params.month));
    const response = await fetchWithAuth(
      withTrainingQuery(`/aggregates/coordinator-workbook/?${search.toString()}`),
      // never serve a stale cached workbook — the saved layout may have just changed
      { timeoutMs: 180_000, cache: 'no-store' }, // many sheets + cross-sheet rollup formulas — allow several minutes
    );
    if (!response.ok) {
      const contentType = response.headers.get('content-type');
      const payload = contentType?.includes('application/json')
        ? await response.json()
        : await response.text();
      throw normalizeApiError({
        status: response.status,
        payload,
        fallbackMessage: 'Failed to download coordinator workbook',
      });
    }
    return response.blob();
  },

  /**
   * Upload a completed reporting workbook. The backend reads project/org/quarter
   * from the embedded metadata — no technical ID columns required.
   * Django endpoint: POST /api/aggregates/import-reporting-workbook/
   */
  async importReportingWorkbook(
    file: File,
    options?: { dryRun?: boolean },
  ): Promise<ReportingWorkbookImportResult> {
    const form = new FormData();
    form.append('file', file);
    if (options?.dryRun) form.append('dry_run', 'true');
    const response = await fetchWithAuth(withTrainingQuery(`/aggregates/import-reporting-workbook/`), {
      method: 'POST',
      body: form,
      // The import parses the whole workbook and validates every indicator row
      // (incl. the per-row period-overlap check) synchronously, which can take
      // well over the default 15s API timeout for a full workbook. Match the
      // backend gunicorn --timeout (120s) so a large-but-valid upload completes
      // instead of the client aborting and surfacing a false "timeout".
      timeoutMs: WORKBOOK_IMPORT_TIMEOUT_MS,
    });
    const payload = (await response.json().catch(() => ({}))) as ReportingWorkbookImportResult;
    if (!response.ok) {
      // Surface the friendly validation payload (error + messages) to the caller.
      const err = normalizeApiError({
        status: response.status,
        payload,
        fallbackMessage: 'Workbook import failed',
      }) as Error & { payload?: ReportingWorkbookImportResult };
      err.payload = payload;
      throw err;
    }
    return payload;
  },

  async startExportJob(
    filters?: AggregateFilters & {
      format?: 'csv' | 'excel';
      sheet_layout?: 'single' | 'organization' | 'organization_template' | 'template';
    },
  ): Promise<ExportJob> {
    const { format, sheet_layout, ...rest } = filters ?? {};
    const parameters = cleanParams({
      ...(rest as Record<string, string | undefined>),
      file_format: format,
      sheet_layout,
    }) || {};
    return uploadsService.createExportJob({
      job_type: 'aggregate_export',
      parameters,
    });
  },

  /**
   * Generate an aggregate value from interaction responses (and optionally save rule + aggregate)
   * Django endpoint: POST /api/aggregates/generate_from_interactions/
   */
  async generateFromInteractions(
    request: GenerateFromInteractionsRequest,
  ): Promise<GenerateFromInteractionsResponse> {
    const { data } = await api.post<GenerateFromInteractionsResponse>(
      '/aggregates/generate_from_interactions/',
      request,
    );
    return data;
  },

  /**
   * List derivation rules
   * Django endpoint: GET /api/aggregates/derivation-rules/
   */
  async listDerivationRules(filters?: {
    output_indicator?: string;
    source_indicator?: string;
    is_active?: string;
    page?: string;
    page_size?: string;
  }): Promise<PaginatedResponse<DerivationRule>> {
    const params = cleanParams(filters as Record<string, string | undefined>);
    const { data } = await api.get<PaginatedResponse<DerivationRule>>(
      '/aggregates/derivation-rules/',
      params,
    );
    return data;
  },
};

export default aggregatesService;
