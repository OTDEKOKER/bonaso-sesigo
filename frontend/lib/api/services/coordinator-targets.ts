import { api, type PaginatedResponse } from "../client";

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
  variance?: number;
  performance_status?: "no_target" | "met" | "on_track" | "behind";
  child_contributions?: CoordinatorTargetChildContribution[];
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
// Performance rows are computed client-side from already-fetched data
// (see components/targets/coordinator-targets-page.tsx); there is no
// dedicated backend performance endpoint.
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
};
