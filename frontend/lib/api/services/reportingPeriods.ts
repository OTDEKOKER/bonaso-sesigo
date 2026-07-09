/**
 * Reporting Periods Service — Quarterly Reporting Control Framework.
 *
 * Admin CRUD + lifecycle for reporting windows, plus the read-only reporting
 * status used by organisation dashboards. The backend is the sole source of
 * truth for whether reporting is permitted; the status endpoint only drives
 * display (enabling/disabling buttons). Every actual write is independently
 * gated server-side, so nothing here can bypass a closed window.
 *
 * Django base: /api/aggregates/reporting-periods/ and /api/aggregates/reporting-status/
 */
import { api, type PaginatedResponse } from '../client';

export type ReportingPeriodStatus =
  | 'draft' | 'scheduled' | 'open' | 'closed' | 'archived';

export type ReportingWindowState =
  | 'open_default' | 'not_elapsed' | 'draft' | 'scheduled'
  | 'open' | 'late' | 'closed' | 'archived';

export interface ReportingPeriod {
  id: number;
  project: number;
  project_name?: string;
  project_code?: string;
  fiscal_year: number;
  quarter: number;
  quarter_label?: string;
  coverage_start: string;
  coverage_end: string;
  earliest_open_date: string;
  submission_opens: string | null;
  submission_closes: string | null;
  status: ReportingPeriodStatus;
  allow_late_reporting: boolean;
  late_reporting_opens: string | null;
  late_reporting_closes: string | null;
  notes: string;
  created_by?: number | null;
  created_by_name?: string;
  created_at?: string;
  updated_at?: string;
}

export interface ReportingPeriodProgress {
  reporting_period_id: number;
  project: number;
  quarter: number;
  fiscal_year: number;
  status: ReportingPeriodStatus;
  eligible_organizations: number;
  submitted_organizations: number;
  approved_organizations: number;
  rejected_organizations: number;
  outstanding_organizations: number;
  completion_percentage: number;
  outstanding_organization_ids: number[];
  approved_organization_ids: number[];
  rejected_organization_ids: number[];
}

export interface ReportingStatus {
  project: number;
  period_start: string;
  period_end: string;
  period_label: string;
  quarter: number | null;
  fiscal_year: number | null;
  state: ReportingWindowState;
  can_submit: boolean;
  message: string;
  reporting_period_id: number | null;
  submission_opens: string | null;
  submission_closes: string | null;
  allow_late_reporting: boolean;
  late_reporting_opens: string | null;
  late_reporting_closes: string | null;
  earliest_open_date: string | null;
  days_remaining: number | null;
  is_late: boolean;
  submission?: {
    organization: number;
    has_submitted: boolean;
    statuses: string[];
    row_count: number;
  };
}

export interface ReportingPeriodFilters {
  project?: number | string;
  fiscal_year?: number | string;
  quarter?: number | string;
  status?: ReportingPeriodStatus;
}

const BASE = '/aggregates/reporting-periods/';

export interface ReportingStatusQuery {
  project: number | string;
  quarter?: number | string;
  fiscal_year?: number | string;
  period_start?: string;
  period_end?: string;
  organization?: number | string;
}

export const reportingPeriodsService = {
  async list(filters?: ReportingPeriodFilters): Promise<ReportingPeriod[]> {
    const { data } = await api.get<PaginatedResponse<ReportingPeriod> | ReportingPeriod[]>(
      BASE, filters as Record<string, string | number | undefined>,
    );
    return Array.isArray(data) ? data : (data.results ?? []);
  },

  async get(id: number): Promise<ReportingPeriod> {
    const { data } = await api.get<ReportingPeriod>(`${BASE}${id}/`);
    return data;
  },

  async create(payload: {
    project: number; fiscal_year: number; quarter: number;
    submission_opens?: string | null; submission_closes?: string | null;
    notes?: string;
  }): Promise<ReportingPeriod> {
    const { data } = await api.post<ReportingPeriod>(BASE, payload);
    return data;
  },

  async update(id: number, payload: Partial<ReportingPeriod>): Promise<ReportingPeriod> {
    const { data } = await api.patch<ReportingPeriod>(`${BASE}${id}/`, payload);
    return data;
  },

  async remove(id: number): Promise<void> {
    await api.delete(`${BASE}${id}/`);
  },

  // ── Lifecycle transitions (all audited server-side) ──────────────────────
  async schedule(id: number, body?: Record<string, unknown>): Promise<ReportingPeriod> {
    const { data } = await api.post<ReportingPeriod>(`${BASE}${id}/schedule/`, body ?? {});
    return data;
  },
  async open(id: number, body: { submission_opens?: string; submission_closes?: string; reason?: string; allow_early_reporting?: boolean }): Promise<ReportingPeriod> {
    const { data } = await api.post<ReportingPeriod>(`${BASE}${id}/open/`, body);
    return data;
  },
  async close(id: number, reason?: string): Promise<ReportingPeriod> {
    const { data } = await api.post<ReportingPeriod>(`${BASE}${id}/close/`, { reason });
    return data;
  },
  async reopen(id: number, reason?: string): Promise<ReportingPeriod> {
    const { data } = await api.post<ReportingPeriod>(`${BASE}${id}/reopen/`, { reason });
    return data;
  },
  async archive(id: number, reason?: string): Promise<ReportingPeriod> {
    const { data } = await api.post<ReportingPeriod>(`${BASE}${id}/archive/`, { reason });
    return data;
  },
  async enableLate(id: number, body: { late_reporting_opens?: string; late_reporting_closes?: string; reason?: string }): Promise<ReportingPeriod> {
    const { data } = await api.post<ReportingPeriod>(`${BASE}${id}/enable-late/`, body);
    return data;
  },
  async disableLate(id: number, reason?: string): Promise<ReportingPeriod> {
    const { data } = await api.post<ReportingPeriod>(`${BASE}${id}/disable-late/`, { reason });
    return data;
  },
  async duplicate(id: number): Promise<ReportingPeriod> {
    const { data } = await api.post<ReportingPeriod>(`${BASE}${id}/duplicate/`, {});
    return data;
  },
  async progress(id: number): Promise<ReportingPeriodProgress> {
    const { data } = await api.get<ReportingPeriodProgress>(`${BASE}${id}/progress/`);
    return data;
  },

  // ── Org-facing status (display only) ─────────────────────────────────────
  async status(query: ReportingStatusQuery): Promise<ReportingStatus> {
    const { data } = await api.get<ReportingStatus>(
      '/aggregates/reporting-status/',
      query as unknown as Record<string, string | number | undefined>,
    );
    return data;
  },
};
