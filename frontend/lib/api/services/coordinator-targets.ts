import { api, fetchWithAuth, normalizeApiError, type PaginatedResponse } from "../client";

export type CoordinatorTargetQuarter = "Q1" | "Q2" | "Q3" | "Q4";

export interface CoordinatorTarget {
  id: number;
  project_id: number;
  coordinator_id: number;
  indicator_id: number;
  year: number;
  quarter: CoordinatorTargetQuarter;
  target_value: number;
  notes?: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  project_name?: string;
  coordinator_name?: string;
  indicator_name?: string;
  // Server-side rollup actuals (readiness R3). Authoritative when present —
  // the page prefers these over the client-side fallback computation.
  own_actual_value?: number;
  actual_value?: number;
  achievement_percent?: number | null;
  variance?: number | null;
  performance_status?: "no_target" | "met" | "on_track" | "behind" | "pending";
  child_contributions?: CoordinatorTargetChildContribution[];
  // Dynamic (derived) targets — resolved read metadata from the rollup engine.
  // resolved_target_value is the effective target (null when pending). target_source
  // describes how it was derived; target_pending is true when the source indicator
  // has not been reported yet.
  resolved_target_value?: number | null;
  target_source?: CoordinatorTargetSource | null;
  target_pending?: boolean;
}

export type TargetSourceType = "fixed" | "derived" | "percentage";

export interface CoordinatorTargetSource {
  type: TargetSourceType;
  source_indicator_id: number | null;
  source_indicator_name?: string | null;
  percentage?: number | null;
}

export interface CoordinatorTargetFilters {
  project_id?: string;
  coordinator_id?: string;
  indicator_id?: string;
  year?: string;
  quarter?: CoordinatorTargetQuarter | "all";
  is_active?: "true" | "false";
  search?: string;
  page?: string;
  page_size?: string;
}

export interface CreateCoordinatorTargetRequest {
  project_id: number;
  coordinator_id: number;
  indicator_id: number;
  year: number;
  quarter: CoordinatorTargetQuarter;
  target_value: number;
  notes?: string;
  is_active?: boolean;
  // Per-coordinator target-source override (write-through to the POT config).
  // null type clears the override (inherit the project-indicator default).
  target_source_type?: TargetSourceType | null;
  target_source_indicator?: number | null;
  target_source_percentage?: number | null;
}

export type UpdateCoordinatorTargetRequest = Partial<CreateCoordinatorTargetRequest>;

export interface CoordinatorTargetBulkAssignRequest {
  project_id: number;
  coordinator_ids: number[];
  indicator_ids: number[];
  year: number;
  quarter: CoordinatorTargetQuarter;
  target_value: number;
  notes?: string;
  is_active?: boolean;
}

// Shape of a child organization's contribution toward a coordinator target.
// Performance is computed server-side by the certified rollup engine
// (analysis.services.coordinator_rollups); the frontend is display-only.
export interface CoordinatorTargetChildContribution {
  organization_id: number;
  organization_name: string;
  actual_value: number;
  share_percent: number;
}

const LIST_ALL_PAGE_SIZE = "500";

// Backed by analysis.CoordinatorTargetViewSet (DefaultRouter under /api/analysis/).
// Single canonical endpoint — no path probing or local fabrication fallback:
// if the backend is unreachable or the route is missing, the error surfaces.
const ENDPOINT = "/analysis/coordinator-targets/";

export const coordinatorTargetsService = {
  async list(filters?: CoordinatorTargetFilters): Promise<PaginatedResponse<CoordinatorTarget>> {
    const params = filters as Record<string, string> | undefined;
    const { data } = await api.get<PaginatedResponse<CoordinatorTarget>>(ENDPOINT, params);
    return data;
  },

  async listAll(filters?: CoordinatorTargetFilters): Promise<CoordinatorTarget[]> {
    const results: CoordinatorTarget[] = [];
    let page = filters?.page ? String(filters.page) : "1";
    const baseFilters = { ...(filters || {}) } as Record<string, string>;
    delete baseFilters.page;
    if (!baseFilters.page_size) {
      baseFilters.page_size = LIST_ALL_PAGE_SIZE;
    }

    while (true) {
      const { data } = await api.get<PaginatedResponse<CoordinatorTarget>>(ENDPOINT, {
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

  async get(id: number): Promise<CoordinatorTarget> {
    const { data } = await api.get<CoordinatorTarget>(`${ENDPOINT}${id}/`);
    return data;
  },

  // Project-hierarchy coordinators (ProjectOrganization.is_coordinator) for a
  // single project — used to populate the coordinator filter with only the
  // project's actual coordinators, not every org that has a target.
  async coordinators(projectId: string | number): Promise<Array<{ id: string; name: string }>> {
    const { data } = await api.get<Array<{ id: string; name: string }>>(`${ENDPOINT}coordinators/`, {
      project_id: String(projectId),
    });
    return data;
  },

  // Lightweight dropdown options (distinct indicators + coordinators that have
  // a target) for a project (+ optional year). Cheap: no rollup actuals — this
  // replaces the slow page_size=1000 list fetch the filters used to make.
  async options(
    projectId: string | number,
    year?: string | number,
  ): Promise<{ indicators: Array<{ id: string; name: string }>; coordinators: Array<{ id: string; name: string }> }> {
    const params: Record<string, string> = { project_id: String(projectId) };
    if (year !== undefined && year !== "" && String(year) !== "all") params.year = String(year);
    const { data } = await api.get<{
      indicators: Array<{ id: string; name: string }>;
      coordinators: Array<{ id: string; name: string }>;
    }>(`${ENDPOINT}options/`, params);
    return data;
  },

  // "All coordinators" rollup: one row per indicator (per year/quarter) summing
  // the configured targets and the certified server-side actuals across the
  // project's coordinators. Backend is the single source of truth (readiness
  // R3); each coordinator appears as a contribution on the rolled-up row.
  async rollup(filters?: CoordinatorTargetFilters): Promise<PaginatedResponse<CoordinatorTarget>> {
    const params = filters as Record<string, string> | undefined;
    const { data } = await api.get<PaginatedResponse<CoordinatorTarget>>(`${ENDPOINT}rollup/`, params);
    return data;
  },

  async create(request: CreateCoordinatorTargetRequest): Promise<CoordinatorTarget> {
    const { data } = await api.post<CoordinatorTarget>(ENDPOINT, request);
    return data;
  },

  async update(id: number, request: UpdateCoordinatorTargetRequest): Promise<CoordinatorTarget> {
    const { data } = await api.patch<CoordinatorTarget>(`${ENDPOINT}${id}/`, request);
    return data;
  },

  async delete(id: number): Promise<void> {
    await api.delete(`${ENDPOINT}${id}/`);
  },

  async bulkAssign(request: CoordinatorTargetBulkAssignRequest): Promise<{
    created: number;
    updated: number;
    skipped: number;
  }> {
    const { data } = await api.post<{
      created: number;
      updated: number;
      skipped: number;
    }>(`${ENDPOINT}bulk-assign/`, request);
    return data;
  },

  // Server-rendered CSV export. Uses the SAME rollup engine and the SAME scoped
  // queryset as the list endpoint, so the file always matches the dashboard.
  async exportCsv(filters?: CoordinatorTargetFilters): Promise<Blob> {
    const params = filters as Record<string, string> | undefined;
    const qs = params
      ? `?${new URLSearchParams(
          Object.fromEntries(
            Object.entries(params).filter(([, value]) => value !== undefined && value !== ""),
          ) as Record<string, string>,
        ).toString()}`
      : "";
    const response = await fetchWithAuth(`/analysis/coordinator-targets/export/${qs}`);
    if (!response.ok) {
      const contentType = response.headers.get("content-type");
      const payload = contentType?.includes("application/json")
        ? await response.json()
        : await response.text();
      throw normalizeApiError({
        status: response.status,
        payload,
        fallbackMessage: "Failed to export coordinator targets",
      });
    }
    return response.blob();
  },

  // Pivoted CSV: one row per assigned indicator, columns Q1..Q4 (plus a
  // coordinator/year column when that filter isn't pinned). Respects the same filters.
  async exportAssignedTargetsCsv(filters?: CoordinatorTargetFilters): Promise<Blob> {
    const params = filters as Record<string, string> | undefined;
    const qs = params
      ? `?${new URLSearchParams(
          Object.fromEntries(
            Object.entries(params).filter(([, value]) => value !== undefined && value !== ""),
          ) as Record<string, string>,
        ).toString()}`
      : "";
    const response = await fetchWithAuth(`/analysis/coordinator-targets/export-targets/${qs}`);
    if (!response.ok) {
      const contentType = response.headers.get("content-type");
      const payload = contentType?.includes("application/json")
        ? await response.json()
        : await response.text();
      throw normalizeApiError({
        status: response.status,
        payload,
        fallbackMessage: "Failed to export assigned indicator targets",
      });
    }
    return response.blob();
  },

  // Pivoted xlsx: one row per assigned indicator, pairing each quarter's target
  // with its achieved (actual) value from the certified rollup engine, plus year
  // totals and achievement %. Respects the same filters.
  async exportTargetsWithAchieved(filters?: CoordinatorTargetFilters): Promise<Blob> {
    const params = filters as Record<string, string> | undefined;
    const qs = params
      ? `?${new URLSearchParams(
          Object.fromEntries(
            Object.entries(params).filter(([, value]) => value !== undefined && value !== ""),
          ) as Record<string, string>,
        ).toString()}`
      : "";
    const response = await fetchWithAuth(`/analysis/coordinator-targets/export-targets-achieved/${qs}`);
    if (!response.ok) {
      const contentType = response.headers.get("content-type");
      const payload = contentType?.includes("application/json")
        ? await response.json()
        : await response.text();
      throw normalizeApiError({
        status: response.status,
        payload,
        fallbackMessage: "Failed to export targets with achieved",
      });
    }
    return response.blob();
  },
};
