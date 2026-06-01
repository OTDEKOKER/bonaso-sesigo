/**
 * Respondents & Interactions Service
 * 
 * CRUD operations for respondents and their interactions.
 * Django endpoint base: /api/record/
 */

import { api, fetchWithAuth, normalizeApiError, type PaginatedResponse } from '../client';
import type { Respondent, Interaction, Response as InteractionResponse } from '@/lib/types';

// ============================================================================
// Types
// ============================================================================

export interface RespondentFilters {
  search?: string;
  gender?: string;
  age_min?: string;
  age_max?: string;
  location?: string;
  organization?: string;
  project?: string;
  is_active?: string;
  page?: string;
  page_size?: string;
}

export interface CreateRespondentRequest {
  unique_id: string;
  first_name: string;
  last_name: string;
  gender?: 'male' | 'female' | 'other';
  date_of_birth?: string;
  phone?: string;
  email?: string;
  address?: string;
  demographics?: Record<string, unknown>;
  organization: number;
}

export interface UpdateRespondentRequest extends Partial<CreateRespondentRequest> {
  is_active?: boolean;
}

export interface InteractionFilters {
  respondent?: string;
  type?: string;
  date_from?: string;
  date_to?: string;
  recorded_by?: string;
  page?: string;
  page_size?: string;
}

export interface ResponseFilters {
  interaction?: string;
  indicator?: string;
  page?: string;
  page_size?: string;
}

export interface CreateInteractionRequest {
  respondent: number;
  assessment?: number | null;
  project?: number | null;
  event?: number | null;
  date: string;
  notes?: string;
  responses?: Array<{
    indicator: number;
    value: unknown;
  }>;
}

export type UpdateInteractionRequest = Partial<CreateInteractionRequest>

export interface CreateResponseRequest {
  interaction: number;
  indicator: number;
  value: unknown;
}

export type UpdateResponseRequest = Partial<CreateResponseRequest>

export interface RespondentImportRequest {
  file: File;
  organization_id: number;
  project_id?: number;
}

export interface RespondentExportRequest {
  format: 'csv' | 'excel';
  filters?: RespondentFilters;
}

// ============================================================================
// Respondents Service
// ============================================================================

export const respondentsService = {
  /**
   * List all respondents with optional filters
   * Django endpoint: GET /api/record/respondents/
   */
  async list(filters?: RespondentFilters): Promise<PaginatedResponse<Respondent>> {
    const params = filters as Record<string, string> | undefined;
    const { data } = await api.get<PaginatedResponse<Respondent>>('/record/respondents/', params);
    return data;
  },

  /**
   * Get a single respondent by ID
   * Django endpoint: GET /api/record/respondents/:id/
   */
  async get(id: number): Promise<Respondent> {
    const { data } = await api.get<Respondent>(`/record/respondents/${id}/`);
    return data;
  },

  /**
   * Create a new respondent
   * Django endpoint: POST /api/record/respondents/
   */
  async create(request: CreateRespondentRequest): Promise<Respondent> {
    const { data } = await api.post<Respondent>('/record/respondents/', request);
    return data;
  },

  /**
   * Update a respondent
   * Django endpoint: PATCH /api/record/respondents/:id/
   */
  async update(id: number, request: UpdateRespondentRequest): Promise<Respondent> {
    const { data } = await api.patch<Respondent>(`/record/respondents/${id}/`, request);
    return data;
  },

  /**
   * Delete a respondent
   * Django endpoint: DELETE /api/record/respondents/:id/
   */
  async delete(id: number): Promise<void> {
    await api.delete(`/record/respondents/${id}/`);
  },

  /**
   * Get respondent with full profile and history
   * Django endpoint: GET /api/record/respondents/:id/profile/
   */
  async getProfile(id: number): Promise<Respondent & { interactions?: Interaction[] }> {
    const { data } = await api.get<Respondent & { interactions?: Interaction[] }>(
      `/record/respondents/${id}/profile/`
    );
    return data;
  },

  /**
   * Search respondents by unique ID
   * Django endpoint: GET /api/record/respondents/search/
   */
  async search(query: string): Promise<Respondent[]> {
    const { data } = await api.get<Respondent[]>('/record/respondents/search/', { q: query });
    return data;
  },

  /**
   * Import respondents from file
   * Django endpoint: POST /api/respondents/import/
   */
  async import(request: RespondentImportRequest): Promise<{
    imported: number;
    skipped: number;
    errors: Array<{ row: number; message: string }>;
  }> {
    const formData = new FormData();
    formData.append('file', request.file);
    formData.append('organization_id', request.organization_id.toString());
    if (request.project_id) {
      formData.append('project_id', request.project_id.toString());
    }

    const response = await fetchWithAuth('/record/respondents/import/', {
      method: 'POST',
      body: formData,
    });

    const contentType = response.headers.get('content-type');
    if (!response.ok) {
      const payload = contentType?.includes('application/json')
        ? await response.json()
        : await response.text();
      throw normalizeApiError({
        status: response.status,
        payload,
        fallbackMessage: 'Failed to import respondents',
      });
    }

    return contentType?.includes('application/json')
      ? response.json()
      : { imported: 0, skipped: 0, errors: [] };
  },

  /**
   * Export respondents to file
   * Django endpoint: GET /api/respondents/export/
   */
  async export(request: RespondentExportRequest): Promise<Blob> {
    const params = {
      format: request.format,
      ...(request.filters as Record<string, string>),
    };

    const response = await fetchWithAuth(
      `/record/respondents/export/?${new URLSearchParams(params)}`,
    );
    if (!response.ok) {
      const contentType = response.headers.get('content-type');
      const payload = contentType?.includes('application/json')
        ? await response.json()
        : await response.text();
      throw normalizeApiError({
        status: response.status,
        payload,
        fallbackMessage: 'Failed to export respondents',
      });
    }

    return response.blob();
  },

  /**
   * Get respondent statistics
   * Django endpoint: GET /api/record/respondents/stats/
   */
  async getStats(): Promise<{
    total: number;
    active: number;
    by_gender: Record<string, number>;
    by_location: Record<string, number>;
    new_this_month: number;
  }> {
    const { data } = await api.get<{
      total: number;
      active: number;
      by_gender: Record<string, number>;
      by_location: Record<string, number>;
      new_this_month: number;
    }>('/record/respondents/stats/');
    return data;
  },
};

// ============================================================================
// Interactions Service
// ============================================================================

export const interactionsService = {
  /**
   * List all interactions with optional filters
   * Django endpoint: GET /api/record/interactions/
   */
  async list(filters?: InteractionFilters): Promise<PaginatedResponse<Interaction>> {
    const params = filters as Record<string, string> | undefined;
    const { data } = await api.get<PaginatedResponse<Interaction>>('/record/interactions/', params);
    return data;
  },

  /**
   * Get a single interaction by ID
   * Django endpoint: GET /api/record/interactions/:id/
   */
  async get(id: number): Promise<Interaction> {
    const { data } = await api.get<Interaction>(`/record/interactions/${id}/`);
    return data;
  },

  /**
   * Create a new interaction
   * Django endpoint: POST /api/record/interactions/
   */
  async create(request: CreateInteractionRequest): Promise<Interaction> {
    const { data } = await api.post<Interaction>('/record/interactions/', request);
    return data;
  },

  /**
   * Update an interaction
   * Django endpoint: PATCH /api/record/interactions/:id/
   */
  async update(id: number | string, request: UpdateInteractionRequest): Promise<Interaction> {
    const { data } = await api.patch<Interaction>(`/record/interactions/${id}/`, request);
    return data;
  },

  /**
   * Delete an interaction
   * Django endpoint: DELETE /api/record/interactions/:id/
   */
  async delete(id: number | string): Promise<void> {
    await api.delete(`/record/interactions/${id}/`);
  },

  /**
   * Get interaction types for filtering
   * Django endpoint: Not implemented in backend (placeholder)
   */
  async getTypes(): Promise<string[]> {
    return [];
  },
};

// ============================================================================
// Responses Service
// ============================================================================

export const responsesService = {
  /**
   * List responses with optional filters
   * Django endpoint: GET /api/record/responses/
   */
  async list(filters?: ResponseFilters): Promise<PaginatedResponse<InteractionResponse>> {
    const params = filters as Record<string, string> | undefined;
    const { data } = await api.get<PaginatedResponse<InteractionResponse>>('/record/responses/', params);
    return data;
  },

  /**
   * Update a response value
   * Django endpoint: PATCH /api/record/responses/:id/
   */
  async update(id: number | string, request: UpdateResponseRequest): Promise<InteractionResponse> {
    const { data } = await api.patch<InteractionResponse>(`/record/responses/${id}/`, request);
    return data;
  },

  /**
   * Create a response
   * Django endpoint: POST /api/record/responses/
   */
  async create(request: CreateResponseRequest): Promise<InteractionResponse> {
    const { data } = await api.post<InteractionResponse>('/record/responses/', request);
    return data;
  },

  /**
   * Delete a response
   * Django endpoint: DELETE /api/record/responses/:id/
   */
  async delete(id: number | string): Promise<void> {
    await api.delete(`/record/responses/${id}/`);
  },
};

export default respondentsService;
