/**
 * CSO Mapping & Capacity Assessment — authorised-staff API.
 *
 * Read/export of questionnaire submissions stored locally in Sesigo's database.
 * The backend restricts these endpoints to the admin role; the UI additionally
 * hides the page from non-admins. Django base: /api/cso-mapping/.
 */
import { api, fetchWithAuth, normalizeApiError, type PaginatedResponse } from "../client";
import type { FormSchema } from "@/components/cso-mapping/schema";

export interface CsoSubmission {
  id: number;
  submitted_at: string;
  consent: boolean;
  respondent_type: string;
  respondent_type_display: string;
  responding_entity: string;
  respondent_name: string;
  respondent_position: string;
  respondent_phone: string;
  respondent_email: string;
  primary_district: string;
  information_confirmed: boolean;
  additional_comments: string;
  answers: Record<string, string>;
  form_version: string;
}

export interface CsoSummary {
  total: number;
  by_respondent_type: Record<string, number>;
}

export interface CsoSubmissionFilters {
  respondent_type?: string;
  search?: string;
  ordering?: string;
  page?: number;
}

export const csoMappingService = {
  async list(filters?: CsoSubmissionFilters): Promise<PaginatedResponse<CsoSubmission>> {
    const { data } = await api.get<PaginatedResponse<CsoSubmission>>(
      "/cso-mapping/submissions/",
      filters as Record<string, string | number | undefined>,
    );
    return data;
  },

  async get(id: number): Promise<CsoSubmission> {
    const { data } = await api.get<CsoSubmission>(`/cso-mapping/submissions/${id}/`);
    return data;
  },

  async summary(): Promise<CsoSummary> {
    const { data } = await api.get<CsoSummary>("/cso-mapping/submissions/summary/");
    return data;
  },

  async schema(): Promise<FormSchema> {
    const { data } = await api.get<FormSchema>("/cso-mapping/schema/");
    return data;
  },

  /** Download the submissions CSV (honours the current respondent_type/search filters). */
  async exportCsv(filters?: CsoSubmissionFilters): Promise<Blob> {
    const params = new URLSearchParams();
    if (filters?.respondent_type) params.set("respondent_type", filters.respondent_type);
    if (filters?.search) params.set("search", filters.search);
    const qs = params.toString() ? `?${params.toString()}` : "";
    // fetchWithAuth returns the raw Response (with the bearer token attached) so
    // we can stream the CSV as a blob rather than parsing it as JSON.
    const response = await fetchWithAuth(`/cso-mapping/submissions/export/${qs}`);
    if (!response.ok) {
      throw normalizeApiError({
        status: response.status,
        payload: await response.text(),
        fallbackMessage: "Failed to export submissions",
      });
    }
    return response.blob();
  },
};
