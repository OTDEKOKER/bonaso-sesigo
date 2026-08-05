/**
 * CSO Mapping & Capacity Assessment — authorised-staff API.
 *
 * Read/export of questionnaire submissions stored locally in Sesigo's database.
 * The backend restricts these endpoints to the admin role; the UI additionally
 * hides the page from non-admins. Django base: /api/cso-mapping/.
 */
import { api, fetchWithAuth, normalizeApiError, type PaginatedResponse } from "../client";
import type { FormSchema } from "@/components/cso-mapping/schema";

/** A saved version of the questionnaire form (admin form-editor history). */
export interface SchemaVersion {
  id: number;
  version_label: string;
  note: string;
  is_active: boolean;
  created_at: string;
  created_by: string | null;
}

/** Validation problems returned by the editor's save endpoint (HTTP 400). */
export interface SchemaSaveError {
  errors: string[];
}

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

  // --- Admin form editor (admin role only) -------------------------------
  /** The current editable schema (seeds from the bundled form on first call). */
  async adminSchema(): Promise<FormSchema> {
    const { data } = await api.get<FormSchema>("/cso-mapping/admin/schema/");
    return data;
  },

  /**
   * Save an edited schema as the new active version. Throws with a `.errors`
   * string[] (from the 400 body) when the schema is rejected by validation.
   */
  async saveSchema(schema: FormSchema, note?: string): Promise<FormSchema> {
    try {
      const { data } = await api.put<FormSchema>("/cso-mapping/admin/schema/", {
        schema,
        note: note ?? "",
      });
      return data;
    } catch (err: unknown) {
      const errors = (err as { response?: { data?: SchemaSaveError } })?.response?.data?.errors;
      if (Array.isArray(errors)) {
        const e = new Error("Schema validation failed") as Error & { errors: string[] };
        e.errors = errors;
        throw e;
      }
      throw err;
    }
  },

  async schemaHistory(): Promise<SchemaVersion[]> {
    const { data } = await api.get<SchemaVersion[]>("/cso-mapping/admin/schema/history/");
    return data;
  },

  async activateSchema(id: number): Promise<FormSchema> {
    const { data } = await api.post<FormSchema>(
      `/cso-mapping/admin/schema/history/${id}/activate/`,
      {},
    );
    return data;
  },

  /**
   * Download the submissions as an Excel workbook — one sheet per respondent
   * category. Honours the `search` term; the respondent-type split is inherent.
   */
  async exportWorkbook(filters?: CsoSubmissionFilters): Promise<Blob> {
    const params = new URLSearchParams();
    if (filters?.search) params.set("search", filters.search);
    const qs = params.toString() ? `?${params.toString()}` : "";
    // fetchWithAuth returns the raw Response (with the bearer token attached) so
    // we can stream the .xlsx as a blob rather than parsing it as JSON.
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
