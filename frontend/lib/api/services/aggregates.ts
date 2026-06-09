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

// ============================================================================
// Types
// ============================================================================

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

const LIST_ALL_PAGE_SIZE = '500';
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
