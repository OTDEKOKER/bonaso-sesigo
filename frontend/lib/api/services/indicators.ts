/**
 * Indicators & Assessments Service
 * 
 * CRUD operations for indicators and assessments.
 * Django endpoint base: /api/indicators/
 */

import { api, type PaginatedResponse } from '../client';
import type { Indicator, Assessment, IndicatorType } from '@/lib/types';
import type { AggregateDisaggregationConfig } from "@/lib/indicators/disaggregation-presets";

// ============================================================================
// Types
// ============================================================================

export interface IndicatorFilters {
  search?: string;
  type?: IndicatorType;
  category?: string;
  is_active?: string;
  is_deprecated?: string;
  organizations?: string;
  page?: string;
  page_size?: string;
}

export interface DuplicateCandidatePair {
  indicator_a: { id: string; name: string; code: string; category: string; type: string };
  indicator_b: { id: string; name: string; code: string; category: string; type: string };
  similarity: number;
}

export interface DuplicateCandidatesResponse {
  count: number;
  results: DuplicateCandidatePair[];
}

export interface MergeIndicatorRequest {
  canonical_id: string | number;
  target_group?: string;
  notes?: string;
}

export interface CreateIndicatorRequest {
  name: string;
  short_name?: string;
  code: string;
  description?: string;
  type: IndicatorType;
  category?: string;
  unit?: string;
  options?: Array<string | { label: string; value: string }>;
  sub_labels?: string[];
  aggregate_disaggregation_config?: AggregateDisaggregationConfig;
  denominator_indicator?: number | null;
  aggregation_method?: 'sum' | 'average' | 'count' | 'latest';
  is_active?: boolean;
  organizations?: number[];
}

export interface UpdateIndicatorRequest extends Partial<CreateIndicatorRequest> {
  is_active?: boolean;
}

export interface AssessmentFilters {
  is_active?: string;
  organizations?: string;
  page?: string;
  page_size?: string;
}

export interface CreateAssessmentRequest {
  name: string;
  description?: string;
  indicators?: number[];
  logic_rules?: Record<string, unknown>;
  is_active?: boolean;
  organizations?: number[];
}

export type UpdateAssessmentRequest = Partial<CreateAssessmentRequest>
export interface BulkAssessmentRequest {
  assessments: CreateAssessmentRequest[];
}

export interface SaveAssessmentQuestionRequest {
  question_id?: number | string;
  indicator_id: number | string;
  question_text?: string;
  help_text?: string;
  response_type?: IndicatorType | "";
  response_options?: Array<string | { label: string; value: string }>;
  response_sub_labels?: string[];
  aggregate_mode?: "none" | "count_all" | "count_selected" | "sum_numeric";
  aggregate_match_values?: unknown[];
  order?: number;
  is_required?: boolean;
}

// ============================================================================
// Indicators Service
// ============================================================================

const LIST_ALL_PAGE_SIZE = '100';

export const indicatorsService = {
  /**
   * List all indicators with optional filters
   * Django endpoint: GET /api/indicators/
   */
  async list(filters?: IndicatorFilters): Promise<PaginatedResponse<Indicator>> {
    const params = filters as Record<string, string> | undefined;
    const { data } = await api.get<PaginatedResponse<Indicator>>('/indicators/', params);
    return data;
  },
  /**
   * List all indicators across all pages
   */
  async listAll(filters?: IndicatorFilters): Promise<Indicator[]> {
    const results: Indicator[] = [];
    let page = filters?.page ? String(filters.page) : "1";
    const baseFilters = { ...(filters || {}) } as Record<string, string>;
    delete baseFilters.page;
    if (!baseFilters.page_size) {
      baseFilters.page_size = LIST_ALL_PAGE_SIZE;
    }

    while (true) {
      const { data } = await api.get<PaginatedResponse<Indicator>>('/indicators/', {
        ...baseFilters,
        page,
      });
      results.push(...(data.results || []));
      if (!data.next) break;
      try {
        const nextUrl = new URL(data.next);
        const nextPage = nextUrl.searchParams.get("page");
        if (!nextPage) break;
        page = nextPage;
      } catch {
        break;
      }
    }
    return results;
  },

  /**
   * Get a single indicator by ID
   * Django endpoint: GET /api/indicators/:id/
   */
  async get(id: number): Promise<Indicator> {
    const { data } = await api.get<Indicator>(`/indicators/${id}/`);
    return data;
  },

  /**
   * Create a new indicator
   * Django endpoint: POST /api/indicators/
   */
  async create(request: CreateIndicatorRequest): Promise<Indicator> {
    const { data } = await api.post<Indicator>('/indicators/', request);
    return data;
  },

  /**
   * Update an indicator
   * Django endpoint: PATCH /api/indicators/:id/
   */
  async update(id: number, request: UpdateIndicatorRequest): Promise<Indicator> {
    const { data } = await api.patch<Indicator>(`/indicators/${id}/`, request);
    return data;
  },

  /**
   * Delete an indicator
   * Django endpoint: DELETE /api/indicators/:id/
   */
  async delete(id: number): Promise<void> {
    await api.delete(`/indicators/${id}/`);
  },

  /**
   * Get indicator categories for filtering
   * Django endpoint: GET /api/indicators/categories/
   */
  async getCategories(): Promise<Array<{ value: string; label: string }>> {
    const { data } = await api.get<Array<{ value: string; label: string }>>('/indicators/categories/');
    return data;
  },

  /**
   * Get indicators for dropdown select
   * Django endpoint: GET /api/indicators/choices/
   */
  async getChoices(): Promise<Array<{ id: number; name: string; code: string }>> {
    const { data } = await api.get<Array<{ id: number; name: string; code: string }>>('/indicators/simple/');
    return data;
  },

  /**
   * Find structurally similar indicator pairs that may be duplicates.
   * Django endpoint: GET /api/indicators/duplicate_candidates/
   */
  async detectDuplicates(params?: { threshold?: number; category?: string }): Promise<DuplicateCandidatesResponse> {
    const query: Record<string, string> = {};
    if (params?.threshold != null) query.threshold = String(params.threshold);
    if (params?.category) query.category = params.category;
    const { data } = await api.get<DuplicateCandidatesResponse>('/indicators/duplicate_candidates/', query);
    return data;
  },

  /**
   * Merge a duplicate indicator into a canonical one.
   * Django endpoint: POST /api/indicators/:id/merge_into/
   */
  async mergeInto(duplicateId: number | string, request: MergeIndicatorRequest): Promise<Indicator> {
    const { data } = await api.post<Indicator>(`/indicators/${duplicateId}/merge_into/`, request);
    return data;
  },

  /**
   * Restore a deprecated indicator (undo merge).
   * Django endpoint: POST /api/indicators/:id/restore/
   */
  async restore(id: number | string): Promise<Indicator> {
    const { data } = await api.post<Indicator>(`/indicators/${id}/restore/`, {});
    return data;
  },

  /**
   * Get indicator statistics
   * Django endpoint: GET /api/indicators/:id/stats/
   */
  async getStats(id: number): Promise<{
    total_assessments: number;
    unique_respondents: number;
    average_value: number | null;
    completion_rate: number;
  }> {
    const { data } = await api.get<{
      total_assessments: number;
      unique_respondents: number;
      average_value: number | null;
      completion_rate: number;
    }>(`/indicators/${id}/stats/`);
    return data;
  },

  /** List the aliases (alternate import/display names) for an indicator. */
  async listAliases(indicatorId: number): Promise<IndicatorAlias[]> {
    const { data } = await api.get<PaginatedResponse<IndicatorAlias> | IndicatorAlias[]>(
      '/indicators/aliases/',
      { indicator: indicatorId, is_active: true, ordering: 'name' },
    );
    return Array.isArray(data) ? data : data.results ?? [];
  },

  /** Add an alias that future imports will resolve to this indicator. */
  async createAlias(request: { indicator: number; name: string; notes?: string }): Promise<IndicatorAlias> {
    const { data } = await api.post<IndicatorAlias>('/indicators/aliases/', request);
    return data;
  },

  /** Remove an alias. */
  async deleteAlias(aliasId: number): Promise<void> {
    await api.delete(`/indicators/aliases/${aliasId}/`);
  },
};

export interface IndicatorAlias {
  id: number;
  indicator: number;
  indicator_name?: string;
  indicator_code?: string;
  name: string;
  normalized_name?: string;
  is_active: boolean;
  notes?: string;
  created_by_name?: string;
  created_at?: string;
}

// ============================================================================
// Assessments Service
// ============================================================================

export const assessmentsService = {
  /**
   * List all assessments with optional filters
   * Django endpoint: GET /api/indicators/assessments/
   */
  async list(filters?: AssessmentFilters): Promise<PaginatedResponse<Assessment>> {
    const params = filters as Record<string, string> | undefined;
    const { data } = await api.get<PaginatedResponse<Assessment>>('/indicators/assessments/', params);
    return data;
  },

  /**
   * Get a single assessment by ID
   * Django endpoint: GET /api/indicators/assessments/:id/
   */
  async get(id: number | string): Promise<Assessment> {
    const { data } = await api.get<Assessment>(`/indicators/assessments/${id}/`);
    return data;
  },

  /**
   * Create a new assessment
   * Django endpoint: POST /api/indicators/assessments/
   */
  async create(request: CreateAssessmentRequest): Promise<Assessment> {
    const { data } = await api.post<Assessment>('/indicators/assessments/', request);
    return data;
  },

  /**
   * Update an assessment
   * Django endpoint: PATCH /api/indicators/assessments/:id/
   */
  async update(id: number | string, request: UpdateAssessmentRequest): Promise<Assessment> {
    const { data } = await api.patch<Assessment>(`/indicators/assessments/${id}/`, request);
    return data;
  },

  /**
   * Delete an assessment
   * Django endpoint: DELETE /api/indicators/assessments/:id/
   */
  async delete(id: number | string): Promise<void> {
    await api.delete(`/indicators/assessments/${id}/`);
  },
  async addIndicator(
    assessmentId: number | string,
    indicatorId: number | string,
    order: number = 0,
    isRequired: boolean = true,
  ): Promise<void> {
    await api.post(`/indicators/assessments/${assessmentId}/add_indicator/`, {
      indicator_id: indicatorId,
      order,
      is_required: isRequired,
    });
  },

  async saveQuestion(
    assessmentId: number | string,
    request: SaveAssessmentQuestionRequest,
  ): Promise<void> {
    await api.post(`/indicators/assessments/${assessmentId}/add_indicator/`, request);
  },

  async removeIndicator(
    assessmentId: number | string,
    indicatorId: number | string,
  ): Promise<void> {
    await api.post(`/indicators/assessments/${assessmentId}/remove_indicator/`, {
      indicator_id: indicatorId,
    });
  },

  async removeQuestion(
    assessmentId: number | string,
    questionId: number | string,
  ): Promise<void> {
    await api.post(`/indicators/assessments/${assessmentId}/remove_indicator/`, {
      question_id: questionId,
    });
  },
};

export default indicatorsService;
