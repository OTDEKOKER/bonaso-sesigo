/**
 * Workbook Layout Service
 *
 * Coordinator-level templates that define ONLY the indicator order (+ optional
 * section headings) used when generating reporting workbooks. A layout is
 * project/period independent: project and period are chosen at download time to
 * fetch the data, never to define the saved order.
 *
 * Django endpoint base: /api/manage/workbook-layouts/
 */

import { api, type PaginatedResponse } from '../client';

export interface WorkbookLayoutItem {
  id?: number;
  indicator: number | null;
  indicator_name?: string;
  indicator_code?: string;
  section_title: string;
  order_index: number;
  is_required?: boolean;
}

export interface WorkbookLayout {
  id: number;
  coordinator_organization: number;
  coordinator_name?: string;
  name: string;
  mode: 'live' | 'training';
  is_active: boolean;
  items: WorkbookLayoutItem[];
  created_by?: number | null;
  updated_by?: number | null;
  created_at?: string;
  updated_at?: string;
}

export interface WorkbookLayoutAvailableIndicator {
  id: number;
  code: string;
  name: string;
  category: string;
  category_display: string;
}

export interface SaveWorkbookLayoutRequest {
  coordinator_organization: number;
  name: string;
  is_active?: boolean;
  /** Optimistic concurrency: the updated_at the client last saw (echoed on save). */
  expected_updated_at?: string;
  items: Array<{
    indicator: number | null;
    section_title?: string;
    order_index: number;
    is_required?: boolean;
  }>;
}

const BASE = '/manage/workbook-layouts';

export const workbookLayoutsService = {
  async list(coordinatorId?: number): Promise<WorkbookLayout[]> {
    const { data } = await api.get<PaginatedResponse<WorkbookLayout> | WorkbookLayout[]>(
      `${BASE}/`,
      coordinatorId ? { coordinator: coordinatorId } : undefined,
    );
    return Array.isArray(data) ? data : data.results;
  },

  /** The active layout for a coordinator, or null if none exists yet. */
  async forCoordinator(coordinatorId: number): Promise<WorkbookLayout | null> {
    const rows = await workbookLayoutsService.list(coordinatorId);
    return rows.find((l) => l.is_active) ?? rows[0] ?? null;
  },

  async retrieve(id: number): Promise<WorkbookLayout> {
    const { data } = await api.get<WorkbookLayout>(`${BASE}/${id}/`);
    return data;
  },

  async create(payload: SaveWorkbookLayoutRequest): Promise<WorkbookLayout> {
    const { data } = await api.post<WorkbookLayout>(`${BASE}/`, payload);
    return data;
  },

  async update(id: number, payload: Partial<SaveWorkbookLayoutRequest>): Promise<WorkbookLayout> {
    const { data } = await api.patch<WorkbookLayout>(`${BASE}/${id}/`, payload);
    return data;
  },

  async remove(id: number): Promise<void> {
    await api.delete<void>(`${BASE}/${id}/`);
  },

  /** Upsert: PATCH the existing active layout for the coordinator, else POST. */
  async save(payload: SaveWorkbookLayoutRequest): Promise<WorkbookLayout> {
    const existing = await workbookLayoutsService.forCoordinator(payload.coordinator_organization);
    if (existing) return workbookLayoutsService.update(existing.id, payload);
    return workbookLayoutsService.create(payload);
  },

  async availableIndicators(coordinatorId: number): Promise<WorkbookLayoutAvailableIndicator[]> {
    const { data } = await api.get<WorkbookLayoutAvailableIndicator[]>(
      `${BASE}/available-indicators/`,
      { coordinator: coordinatorId },
    );
    return data;
  },
};

export default workbookLayoutsService;
