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

export interface CoordinatorTargetChildContribution {
  organization_id: number;
  organization_name: string;
  actual_value: number;
  share_percent: number;
}

export interface CoordinatorTargetPerformanceRow {
  target_id: number;
  project_id: number;
  coordinator_id: number;
  indicator_id: number;
  year: number;
  quarter: CoordinatorTargetQuarter;
  target_value: number;
  actual_value: number;
  achievement_percent: number | null;
  variance: number;
  status: "met" | "on_track" | "behind" | "no_target";
  child_contributions: CoordinatorTargetChildContribution[];
}

const LIST_ALL_PAGE_SIZE = "500";
const DEFAULT_PAGE_SIZE = 20;
const LOCAL_STORAGE_KEY = "bonaso.coordinator-targets.v1";
const COORDINATOR_TARGET_ENDPOINT_CANDIDATES = [
  "/analysis/coordinator-targets/",
  "/coordinator-targets/",
  "/targets/coordinator-targets/",
] as const;

let resolvedCoordinatorTargetEndpoint: string | null | undefined;

function isBrowserEnvironment() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function isCoordinatorTargetsEndpointUnavailable(error: unknown) {
  if (
    typeof error !== "object" ||
    error === null ||
    !("status" in error) ||
    (error as { status?: unknown }).status !== 404
  ) {
    return false;
  }

  const message =
    "message" in error && typeof (error as { message?: unknown }).message === "string"
      ? (error as { message: string }).message.toLowerCase()
      : "";

  return (
    message.includes("not available on this backend") ||
    message.includes("page not found at") ||
    message.includes("/coordinator-targets/") ||
    message.includes("/analysis/coordinator-targets/") ||
    message.includes("the requested resource was not found") ||
    message.includes("<!doctype html>") ||
    message.includes("<html")
  );
}

function parseNumberValue(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readLocalTargets(): CoordinatorTarget[] {
  if (!isBrowserEnvironment()) return [];

  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as CoordinatorTarget[]) : [];
  } catch {
    return [];
  }
}

function writeLocalTargets(targets: CoordinatorTarget[]) {
  if (!isBrowserEnvironment()) return;
  window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(targets));
}

function getNextLocalTargetId(targets: CoordinatorTarget[]) {
  return (
    targets.reduce((maxId, target) => Math.max(maxId, parseNumberValue(target.id, 0)), 0) + 1
  );
}

function localNotFoundError(message: string) {
  const error = new Error(message) as Error & { status?: number };
  error.status = 404;
  return error;
}

function matchIdFilter(value: number, filter?: string) {
  if (!filter) return true;
  return String(value) === String(filter);
}

function normalizeQuarterFilter(quarter?: CoordinatorTargetQuarter | "all") {
  return quarter && quarter !== "all" ? quarter : undefined;
}

function applyLocalFilters(input: CoordinatorTarget[], filters?: CoordinatorTargetFilters) {
  const search = String(filters?.search || "")
    .trim()
    .toLowerCase();
  const quarter = normalizeQuarterFilter(filters?.quarter);

  return input
    .filter((target) => matchIdFilter(target.project_id, filters?.project_id))
    .filter((target) => matchIdFilter(target.coordinator_id, filters?.coordinator_id))
    .filter((target) => matchIdFilter(target.indicator_id, filters?.indicator_id))
    .filter((target) => (filters?.year ? String(target.year) === String(filters.year) : true))
    .filter((target) => (quarter ? target.quarter === quarter : true))
    .filter((target) =>
      filters?.is_active ? String(Boolean(target.is_active)) === String(filters.is_active === "true") : true,
    )
    .filter((target) => {
      if (!search) return true;
      const haystack = [
        target.project_name,
        target.coordinator_name,
        target.indicator_name,
        target.notes,
        target.year,
        target.quarter,
        target.project_id,
        target.coordinator_id,
        target.indicator_id,
      ]
        .map((value) => String(value || "").toLowerCase())
        .join(" ");
      return haystack.includes(search);
    })
    .sort((left, right) => String(right.updated_at || "").localeCompare(String(left.updated_at || "")));
}

function buildLocalPaginationLinks(page: number, pageSize: number, count: number) {
  const hasPrevious = page > 1;
  const hasNext = page * pageSize < count;
  return {
    previous: hasPrevious ? `http://local/coordinator-targets/?page=${page - 1}&page_size=${pageSize}` : null,
    next: hasNext ? `http://local/coordinator-targets/?page=${page + 1}&page_size=${pageSize}` : null,
  };
}

function listLocalTargets(filters?: CoordinatorTargetFilters): PaginatedResponse<CoordinatorTarget> {
  const filtered = applyLocalFilters(readLocalTargets(), filters);
  const page = Math.max(1, parseNumberValue(filters?.page, 1));
  const pageSize = Math.max(1, parseNumberValue(filters?.page_size, DEFAULT_PAGE_SIZE));
  const startIndex = (page - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  const links = buildLocalPaginationLinks(page, pageSize, filtered.length);

  return {
    count: filtered.length,
    next: links.next,
    previous: links.previous,
    results: filtered.slice(startIndex, endIndex),
  };
}

function buildLocalTargetFromRequest(
  id: number,
  request: CreateCoordinatorTargetRequest,
  existing?: CoordinatorTarget,
): CoordinatorTarget {
  const now = new Date().toISOString();
  return {
    id,
    project_id: Number(request.project_id),
    coordinator_id: Number(request.coordinator_id),
    indicator_id: Number(request.indicator_id),
    year: Number(request.year),
    quarter: request.quarter,
    target_value: Number(request.target_value),
    notes: request.notes ?? null,
    is_active: request.is_active ?? existing?.is_active ?? true,
    created_at: existing?.created_at || now,
    updated_at: now,
    project_name: existing?.project_name,
    coordinator_name: existing?.coordinator_name,
    indicator_name: existing?.indicator_name,
  };
}

function hasDuplicateLocalTarget(
  targets: CoordinatorTarget[],
  candidate: {
    project_id: number;
    coordinator_id: number;
    indicator_id: number;
    year: number;
    quarter: CoordinatorTargetQuarter;
  },
  excludeId?: number,
) {
  return targets.some((target) => {
    if (excludeId && Number(target.id) === Number(excludeId)) return false;
    return (
      Number(target.project_id) === Number(candidate.project_id) &&
      Number(target.coordinator_id) === Number(candidate.coordinator_id) &&
      Number(target.indicator_id) === Number(candidate.indicator_id) &&
      Number(target.year) === Number(candidate.year) &&
      target.quarter === candidate.quarter
    );
  });
}

async function resolveCoordinatorTargetsEndpoint(): Promise<string | null> {
  if (resolvedCoordinatorTargetEndpoint !== undefined) {
    return resolvedCoordinatorTargetEndpoint;
  }

  for (const endpoint of COORDINATOR_TARGET_ENDPOINT_CANDIDATES) {
    try {
      await api.get<PaginatedResponse<CoordinatorTarget>>(endpoint, { page: "1", page_size: "1" });
      resolvedCoordinatorTargetEndpoint = endpoint;
      return endpoint;
    } catch (error) {
      if (isCoordinatorTargetsEndpointUnavailable(error)) {
        continue;
      }
      throw error;
    }
  }

  resolvedCoordinatorTargetEndpoint = null;
  return null;
}

async function withCoordinatorTargetsBackendFallback<T>(params: {
  remote: (endpoint: string) => Promise<T>;
  local: () => Promise<T> | T;
}): Promise<T> {
  const endpoint = await resolveCoordinatorTargetsEndpoint();
  if (!endpoint) {
    return params.local();
  }

  try {
    return await params.remote(endpoint);
  } catch (error) {
    if (isCoordinatorTargetsEndpointUnavailable(error)) {
      resolvedCoordinatorTargetEndpoint = null;
      return params.local();
    }
    throw error;
  }
}

export const coordinatorTargetsService = {
  async list(filters?: CoordinatorTargetFilters): Promise<PaginatedResponse<CoordinatorTarget>> {
    return withCoordinatorTargetsBackendFallback({
      remote: async (endpoint) => {
        const params = filters as Record<string, string> | undefined;
        const { data } = await api.get<PaginatedResponse<CoordinatorTarget>>(endpoint, params);
        return data;
      },
      local: async () => listLocalTargets(filters),
    });
  },

  async listAll(filters?: CoordinatorTargetFilters): Promise<CoordinatorTarget[]> {
    return withCoordinatorTargetsBackendFallback({
      remote: async (endpoint) => {
        const results: CoordinatorTarget[] = [];
        let page = filters?.page ? String(filters.page) : "1";
        const baseFilters = { ...(filters || {}) } as Record<string, string>;
        delete baseFilters.page;
        if (!baseFilters.page_size) {
          baseFilters.page_size = LIST_ALL_PAGE_SIZE;
        }

        while (true) {
          const { data } = await api.get<PaginatedResponse<CoordinatorTarget>>(endpoint, {
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
      local: async () => {
        const filtered = applyLocalFilters(readLocalTargets(), filters);
        return filtered;
      },
    });
  },

  async get(id: number): Promise<CoordinatorTarget> {
    return withCoordinatorTargetsBackendFallback({
      remote: async (endpoint) => {
        const { data } = await api.get<CoordinatorTarget>(`${endpoint}${id}/`);
        return data;
      },
      local: async () => {
        const match = readLocalTargets().find((target) => Number(target.id) === Number(id));
        if (!match) {
          throw localNotFoundError(`Coordinator target ${id} was not found.`);
        }
        return match;
      },
    });
  },

  async create(request: CreateCoordinatorTargetRequest): Promise<CoordinatorTarget> {
    return withCoordinatorTargetsBackendFallback({
      remote: async (endpoint) => {
        const { data } = await api.post<CoordinatorTarget>(endpoint, request);
        return data;
      },
      local: async () => {
        const current = readLocalTargets();
        if (
          hasDuplicateLocalTarget(current, {
            project_id: request.project_id,
            coordinator_id: request.coordinator_id,
            indicator_id: request.indicator_id,
            year: request.year,
            quarter: request.quarter,
          })
        ) {
          throw new Error(
            "A coordinator target already exists for this project, coordinator, indicator, year, and quarter.",
          );
        }

        const created = buildLocalTargetFromRequest(getNextLocalTargetId(current), request);
        const next = [...current, created];
        writeLocalTargets(next);
        return created;
      },
    });
  },

  async update(id: number, request: UpdateCoordinatorTargetRequest): Promise<CoordinatorTarget> {
    return withCoordinatorTargetsBackendFallback({
      remote: async (endpoint) => {
        const { data } = await api.patch<CoordinatorTarget>(`${endpoint}${id}/`, request);
        return data;
      },
      local: async () => {
        const current = readLocalTargets();
        const index = current.findIndex((target) => Number(target.id) === Number(id));
        if (index === -1) {
          throw localNotFoundError(`Coordinator target ${id} was not found.`);
        }

        const existing = current[index];
        const merged: CreateCoordinatorTargetRequest = {
          project_id: Number(request.project_id ?? existing.project_id),
          coordinator_id: Number(request.coordinator_id ?? existing.coordinator_id),
          indicator_id: Number(request.indicator_id ?? existing.indicator_id),
          year: Number(request.year ?? existing.year),
          quarter: (request.quarter ?? existing.quarter) as CoordinatorTargetQuarter,
          target_value: Number(request.target_value ?? existing.target_value),
          notes: request.notes ?? existing.notes ?? undefined,
          is_active: request.is_active ?? existing.is_active,
        };

        if (
          hasDuplicateLocalTarget(
            current,
            {
              project_id: merged.project_id,
              coordinator_id: merged.coordinator_id,
              indicator_id: merged.indicator_id,
              year: merged.year,
              quarter: merged.quarter,
            },
            Number(id),
          )
        ) {
          throw new Error(
            "A coordinator target already exists for this project, coordinator, indicator, year, and quarter.",
          );
        }

        const updated = buildLocalTargetFromRequest(Number(id), merged, existing);
        const next = [...current];
        next[index] = updated;
        writeLocalTargets(next);
        return updated;
      },
    });
  },

  async delete(id: number): Promise<void> {
    await withCoordinatorTargetsBackendFallback({
      remote: async (endpoint) => {
        await api.delete(`${endpoint}${id}/`);
      },
      local: async () => {
        const next = readLocalTargets().filter((target) => Number(target.id) !== Number(id));
        writeLocalTargets(next);
      },
    });
  },

  async bulkAssign(request: CoordinatorTargetBulkAssignRequest): Promise<{
    created: number;
    updated: number;
    skipped: number;
  }> {
    return withCoordinatorTargetsBackendFallback({
      remote: async (endpoint) => {
        const { data } = await api.post<{
          created: number;
          updated: number;
          skipped: number;
        }>(`${endpoint}bulk-assign/`, request);
        return data;
      },
      local: async () => {
        const current = readLocalTargets();
        const next = [...current];
        let created = 0;
        let updated = 0;
        let skipped = 0;

        for (const coordinatorId of request.coordinator_ids) {
          for (const indicatorId of request.indicator_ids) {
            const existingIndex = next.findIndex((target) => {
              return (
                Number(target.project_id) === Number(request.project_id) &&
                Number(target.coordinator_id) === Number(coordinatorId) &&
                Number(target.indicator_id) === Number(indicatorId) &&
                Number(target.year) === Number(request.year) &&
                target.quarter === request.quarter
              );
            });

            if (existingIndex === -1) {
              const createdTarget = buildLocalTargetFromRequest(getNextLocalTargetId(next), {
                project_id: request.project_id,
                coordinator_id: coordinatorId,
                indicator_id: indicatorId,
                year: request.year,
                quarter: request.quarter,
                target_value: request.target_value,
                notes: request.notes,
                is_active: request.is_active,
              });
              next.push(createdTarget);
              created += 1;
              continue;
            }

            const existing = next[existingIndex];
            const willChange =
              Number(existing.target_value) !== Number(request.target_value) ||
              String(existing.notes || "") !== String(request.notes || "") ||
              Boolean(existing.is_active) !== Boolean(request.is_active ?? existing.is_active);

            if (!willChange) {
              skipped += 1;
              continue;
            }

            next[existingIndex] = {
              ...existing,
              target_value: Number(request.target_value),
              notes: request.notes ?? null,
              is_active: request.is_active ?? existing.is_active,
              updated_at: new Date().toISOString(),
            };
            updated += 1;
          }
        }

        writeLocalTargets(next);
        return { created, updated, skipped };
      },
    });
  },

  async getPerformance(filters?: CoordinatorTargetFilters): Promise<CoordinatorTargetPerformanceRow[]> {
    return withCoordinatorTargetsBackendFallback({
      remote: async (endpoint) => {
        const params = filters as Record<string, string> | undefined;
        const { data } = await api.get<CoordinatorTargetPerformanceRow[]>(`${endpoint}performance/`, params);
        return data;
      },
      local: async () => {
        const filtered = applyLocalFilters(readLocalTargets(), filters);
        return filtered.map((target) => {
          const targetValue = Number(target.target_value || 0);
          const actualValue = 0;
          const achievementPercent = targetValue > 0 ? (actualValue / targetValue) * 100 : null;
          return {
            target_id: Number(target.id),
            project_id: Number(target.project_id),
            coordinator_id: Number(target.coordinator_id),
            indicator_id: Number(target.indicator_id),
            year: Number(target.year),
            quarter: target.quarter,
            target_value: targetValue,
            actual_value: actualValue,
            achievement_percent: achievementPercent,
            variance: actualValue - targetValue,
            status:
              achievementPercent === null
                ? "no_target"
                : achievementPercent >= 100
                  ? "met"
                  : achievementPercent >= 75
                    ? "on_track"
                    : "behind",
            child_contributions: [],
          };
        });
      },
    });
  },
};
