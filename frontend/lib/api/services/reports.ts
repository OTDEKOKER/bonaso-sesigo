/**
 * Reports & Analysis Service
 * 
 * Operations for generating reports, data analysis, and flags.
 * Django endpoint base: /api/analysis/reports/ and /api/analysis/
 */

import { api, fetchWithAuth, normalizeApiError, type PaginatedResponse } from '../client';
import type { Flag } from '@/lib/types';

// ============================================================================
// Types
// ============================================================================

export interface Report {
  id: number;
  name: string;
  type: 'indicator_summary' | 'project_progress' | 'respondent_demographics' | 'custom';
  status: 'pending' | 'processing' | 'completed' | 'failed';
  parameters: Record<string, unknown>;
  created_at: string;
  created_by?: number | null;

  // Backend fields from analysis.ReportSerializer
  description?: string;
  report_type?: 'dashboard' | 'indicator' | 'project' | 'custom';
  cached_data?: unknown;
  last_generated?: string | null;
  organization?: number | null;
  organization_name?: string;
  is_public?: boolean;
  updated_at?: string;
  created_by_name?: string;
}

export interface DashboardChart {
  id: number;
  name: string;
  description?: string;
  report_type: 'dashboard' | 'indicator' | 'project' | 'custom';
  parameters: Record<string, unknown>;
  organization?: number | null;
  organization_name?: string;
  is_public: boolean;
  created_at: string;
  updated_at: string;
  created_by: number | null;
  created_by_name?: string;
}

export interface ReportFilters {
  search?: string;
  type?: string;
  status?: string;
  date_from?: string;
  date_to?: string;
  page?: string;
  page_size?: string;
}

export interface CreateReportRequest {
  name: string;
  type: Report['type'];
  parameters: {
    project_id?: number;
    indicator_ids?: number[];
    date_from?: string;
    date_to?: string;
    organization_id?: number;
    cascade_organization?: boolean;
    include_disaggregation?: boolean;
    include_targets?: boolean;
    comparison_mode?: 'indicator' | 'organization';
    organization_scope?: 'organization_only' | 'organization_with_subgrantees' | 'all_organizations';
    format?: 'pdf' | 'excel' | 'csv';
  };
}

type ReportDownloadFormat = 'pdf' | 'excel' | 'csv';

type RawReport = Partial<Report> & {
  report_type?: string;
  type?: Report['type'];
  status?: Report['status'];
  last_generated?: string | null;
};

const normalizeReportType = (reportType?: string): Report['type'] => {
  switch (reportType) {
    case 'dashboard':
      return 'custom';
    case 'indicator':
      return 'indicator_summary';
    case 'project':
      return 'project_progress';
    case 'custom':
    default:
      return 'custom';
  }
};

const normalizeReportStatus = (report: RawReport): Report['status'] => {
  if (report?.status) return report.status;
  if (report?.last_generated) return 'completed';
  return 'pending';
};

const normalizeReport = (report: RawReport): Report => ({
  ...report,
  type: normalizeReportType(report.report_type || report.type),
  status: normalizeReportStatus(report),
}) as Report;

export interface ScheduledReport {
  id: number;
  report_name: string;
  report_type: Report['type'];
  parameters: Record<string, unknown>;
  frequency: 'daily' | 'weekly' | 'monthly' | 'quarterly';
  recipients: string[];
  is_active: boolean;
  next_run: string;
  last_run?: string;
}

export interface CreateScheduledReportRequest {
  report_name: string;
  report_type: Report['type'];
  parameters: Record<string, unknown>;
  frequency: ScheduledReport['frequency'];
  recipients: string[];
}

export interface AnalysisQuery {
  indicators: number[];
  projects?: number[];
  date_from?: string;
  date_to?: string;
  group_by?: 'day' | 'week' | 'month' | 'quarter' | 'year';
  disaggregate_by?: string[];
}

export interface AnalysisResult {
  indicator_id: number;
  indicator_name: string;
  data: Array<{
    period: string;
    value: number;
    target?: number;
    disaggregation?: Record<string, number>;
  }>;
  summary: {
    total: number;
    average: number;
    min: number;
    max: number;
    trend: 'up' | 'down' | 'stable';
    percent_change: number;
  };
}

export interface DashboardOverviewFilters {
  projectId?: number;
  coordinatorId?: number;
  organizationId?: number;
  dateFrom?: string;
  dateTo?: string;
}

export interface DashboardMessageAnalyticsResponse {
  rows: Array<Record<string, number | string>>;
  series: Array<{
    color: string;
    key: string;
    label: string;
  }>;
}

export interface FlagFilters {
  search?: string;
  flag_type?: string;
  status?: string;
  priority?: string;
  organization?: string;
  assigned_to?: string;
  content_type?: string;
  // Cross-system filters resolved server-side (project/indicator via the linked
  // aggregate, coordinator via the project org hierarchy, category from metadata).
  project?: string;
  coordinator?: string;
  indicator?: string;
  category?: string;
  date_from?: string;
  date_to?: string;
  page?: string;
  page_size?: string;
}

export interface CreateFlagRequest {
  flag_type: 'data_quality' | 'follow_up' | 'urgent' | 'review' | 'other';
  priority: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  description: string;
  content_type: string;
  object_id: number;
  organization: number;
  assigned_to?: number;
}

export interface UpdateFlagRequest {
  status?: 'open' | 'in_progress' | 'resolved' | 'dismissed';
  resolution_notes?: string;
  assigned_to?: number;
}

// ============================================================================
// Reports Service
// ============================================================================

export const reportsService = {
  /**
   * List all reports with optional filters
   * Django endpoint: GET /api/analysis/reports/
   */
  async list(filters?: ReportFilters): Promise<PaginatedResponse<Report>> {
    const params = filters as Record<string, string> | undefined;
    const { data } = await api.get<PaginatedResponse<Report>>('/analysis/reports/', params);
    return {
      ...data,
      results: (data.results || []).map(normalizeReport),
    };
  },

  /**
   * Get a single report by ID
   * Django endpoint: GET /api/analysis/reports/:id/
   */
  async get(id: number): Promise<Report> {
    const { data } = await api.get<Report>(`/analysis/reports/${id}/`);
    return normalizeReport(data);
  },

  /**
   * Generate a new report
   * Django endpoint: POST /api/analysis/reports/
   */
  async create(request: CreateReportRequest): Promise<Report> {
    const typeMap: Record<CreateReportRequest['type'], string> = {
      indicator_summary: 'indicator',
      project_progress: 'project',
      respondent_demographics: 'custom',
      custom: 'custom',
    };
    const payload = {
      name: request.name,
      report_type: typeMap[request.type] || 'custom',
      parameters: request.parameters,
    };
    const { data } = await api.post<Report>('/analysis/reports/', payload);
    return normalizeReport(data);
  },

  /**
   * Generate/refresh cached report data
   * Django endpoint: POST /api/analysis/reports/:id/generate/
   */
  async generate(id: number): Promise<Report> {
    const { data } = await api.post<Report>(`/analysis/reports/${id}/generate/`, {});
    return normalizeReport(data);
  },

  /**
   * Delete a report
   * Django endpoint: DELETE /api/analysis/reports/:id/
   */
  async delete(id: number): Promise<void> {
    await api.delete(`/analysis/reports/${id}/`);
  },

  /**
   * Download report file
   * Django endpoint: GET /api/analysis/reports/:id/download/
   */
  async download(id: number, format?: ReportDownloadFormat): Promise<Blob> {
    const endpointCandidates = [
      `/analysis/reports/${id}/download/`,
      `/analysis/reports/${id}/download`,
      `/analysis/reports/${id}/export/`,
      `/analysis/reports/${id}/export`,
    ];
    const formatCandidates: Array<ReportDownloadFormat | 'xlsx' | null> =
      format === 'excel'
        ? ['excel', 'xlsx']
        : format
          ? [format]
          : [null];

    const attemptedUrls = new Set<string>();
    let lastNotFoundError: Error | null = null;

    for (const endpoint of endpointCandidates) {
      for (const candidate of formatCandidates) {
        const url = candidate
          ? `${endpoint}?format=${encodeURIComponent(candidate)}`
          : endpoint;

        if (attemptedUrls.has(url)) continue;
        attemptedUrls.add(url);

        const response = await fetchWithAuth(url);
        if (response.ok) {
          return response.blob();
        }

        const contentType = response.headers.get('content-type');
        const payload = contentType?.includes('application/json')
          ? await response.json()
          : await response.text();
        const apiError = normalizeApiError({
          status: response.status,
          payload,
          fallbackMessage: 'Failed to download report',
        });

        if (response.status !== 404) {
          throw apiError;
        }
        lastNotFoundError = apiError;
      }
    }

    if (lastNotFoundError) {
      throw lastNotFoundError;
    }

    throw normalizeApiError({
      status: 404,
      payload: { detail: 'Report download endpoint not found.' },
      fallbackMessage: 'Failed to download report',
    });
  },

  /**
   * List scheduled reports
   * Django endpoint: GET /api/analysis/scheduled-reports/
   */
  async listScheduled(): Promise<ScheduledReport[]> {
    const { data } = await api.get<PaginatedResponse<ScheduledReport>>('/analysis/scheduled-reports/');
    return data.results || [];
  },

  /**
   * Create a scheduled report
   * Django endpoint: POST /api/analysis/scheduled-reports/
   */
  async createScheduled(request: CreateScheduledReportRequest): Promise<ScheduledReport> {
    const typeMap: Record<CreateScheduledReportRequest['report_type'], string> = {
      indicator_summary: 'indicator',
      project_progress: 'project',
      respondent_demographics: 'custom',
      custom: 'custom',
    };
    const payload = {
      report_name: request.report_name,
      report_type: typeMap[request.report_type] || 'custom',
      parameters: request.parameters,
      frequency: request.frequency,
      recipients: request.recipients,
    };
    const { data } = await api.post<ScheduledReport>('/analysis/scheduled-reports/', payload);
    return data;
  },

  /**
   * Update a scheduled report
   * Django endpoint: PATCH /api/analysis/scheduled-reports/:id/
   */
  async updateScheduled(
    id: number, 
    request: Partial<CreateScheduledReportRequest> & { is_active?: boolean }
  ): Promise<ScheduledReport> {
    const typeMap: Record<string, string> = {
      indicator_summary: 'indicator',
      project_progress: 'project',
      respondent_demographics: 'custom',
      custom: 'custom',
    };
    const payload: Record<string, unknown> = { ...request };
    if (payload.report_type && typeof payload.report_type === 'string') {
      payload.report_type = typeMap[payload.report_type] || 'custom';
    }
    const { data } = await api.patch<ScheduledReport>(`/analysis/scheduled-reports/${id}/`, payload);
    return data;
  },

  /**
   * Delete a scheduled report
   * Django endpoint: DELETE /api/analysis/scheduled-reports/:id/
   */
  async deleteScheduled(id: number): Promise<void> {
    await api.delete(`/analysis/scheduled-reports/${id}/`);
  },

  /**
   * Get available report types
   * Django endpoint: Not implemented in backend (placeholder)
   */
  async getTypes(): Promise<Array<{ value: string; label: string; description: string }>> {
    return [
      { value: 'indicator_summary', label: 'Indicator Summary', description: 'Summary by indicator' },
      { value: 'project_progress', label: 'Project Progress', description: 'Progress by project' },
      { value: 'respondent_demographics', label: 'Respondent Demographics', description: 'Demographics overview' },
      { value: 'custom', label: 'Custom', description: 'Custom report' },
    ];
  },
};

export const dashboardChartsService = {
  async list(): Promise<PaginatedResponse<DashboardChart>> {
    const { data } = await api.get<PaginatedResponse<DashboardChart>>('/analysis/reports/', {
      report_type: 'dashboard',
    });
    return data;
  },

  async create(request: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
    organization?: number | null;
    is_public?: boolean;
  }): Promise<DashboardChart> {
    const payload = {
      name: request.name,
      description: request.description ?? '',
      report_type: 'dashboard',
      parameters: request.parameters,
      organization: request.organization ?? null,
      is_public: request.is_public ?? false,
    };
    const { data } = await api.post<DashboardChart>('/analysis/reports/', payload);
    return data;
  },

  async update(
    id: number,
    request: Partial<{
      name: string;
      description: string;
      parameters: Record<string, unknown>;
      organization: number | null;
      is_public: boolean;
    }>,
  ): Promise<DashboardChart> {
    const { data } = await api.patch<DashboardChart>(`/analysis/reports/${id}/`, request);
    return data;
  },

  async delete(id: number): Promise<void> {
    await api.delete(`/analysis/reports/${id}/`);
  },
};

// ============================================================================
// Analysis Service
// ============================================================================

export const analysisService = {
  /**
   * Run analysis query
   * Django endpoint: POST /api/analysis/query/
   */
  async query(request: AnalysisQuery): Promise<AnalysisResult[]> {
    const { data } = await api.post<AnalysisResult[]>('/analysis/query/', request);
    return data;
  },

  /**
   * Get dashboard stats
   * Django endpoint: GET /api/analysis/dashboard/overview/
   */
  async getDashboard(projectOrFilters?: number | DashboardOverviewFilters): Promise<{
    total_respondents: number;
    total_assessments: number;
    active_projects: number;
    total_indicators: number;
    indicators_behind: number;
    recent_activity: Array<{
      type: string;
      description: string;
      timestamp: string;
    }>;
  }> {
    const filters: DashboardOverviewFilters =
      typeof projectOrFilters === 'number'
        ? { projectId: projectOrFilters }
        : (projectOrFilters || {});
    const params: Record<string, string> = {};
    if (filters.projectId) params.project = String(filters.projectId);
    if (filters.coordinatorId) params.coordinator = String(filters.coordinatorId);
    if (filters.organizationId) params.organization = String(filters.organizationId);
    if (filters.dateFrom) params.date_from = filters.dateFrom;
    if (filters.dateTo) params.date_to = filters.dateTo;
    const { data } = await api.get<{
      total_respondents: number;
      total_assessments: number;
      active_projects: number;
      total_indicators: number;
      indicators_behind: number;
      recent_activity: Array<{
        type: string;
        description: string;
        timestamp: string;
      }>;
    }>('/analysis/dashboard/overview/', Object.keys(params).length ? params : undefined);
    return data;
  },

  async getDashboardMessageAnalytics(
    projectOrFilters?: number | DashboardOverviewFilters,
  ): Promise<DashboardMessageAnalyticsResponse> {
    const filters: DashboardOverviewFilters =
      typeof projectOrFilters === 'number'
        ? { projectId: projectOrFilters }
        : (projectOrFilters || {});
    const params: Record<string, string> = {};
    if (filters.projectId) params.project = String(filters.projectId);
    if (filters.coordinatorId) params.coordinator = String(filters.coordinatorId);
    if (filters.organizationId) params.organization = String(filters.organizationId);
    if (filters.dateFrom) params.date_from = filters.dateFrom;
    if (filters.dateTo) params.date_to = filters.dateTo;

    const { data } = await api.get<DashboardMessageAnalyticsResponse>(
      '/analysis/dashboard/message_analytics/',
      Object.keys(params).length ? params : undefined,
    );
    return data;
  },

  /**
   * Get indicator trends
   * Django endpoint: GET /api/analysis/trends/:indicatorId/
   */
  async getIndicatorTrends(
    indicatorId: number,
    params?: {
      months?: number;
      projectId?: number | null;
      coordinatorId?: number | null;
      organizationId?: number | null;
      dateFrom?: string;
      dateTo?: string;
    },
  ): Promise<{
    data: Array<{ month: string; value: number; target: number }>;
    trend: 'up' | 'down' | 'stable';
    forecast: number;
  }> {
    const query: Record<string, string> = {};
    const months = params?.months ?? 12;
    if (months) query.months = months.toString();
    if (params?.projectId) query.project = String(params.projectId);
    if (params?.coordinatorId) query.coordinator = String(params.coordinatorId);
    if (params?.organizationId) query.organization = String(params.organizationId);
    if (params?.dateFrom) query.date_from = params.dateFrom;
    if (params?.dateTo) query.date_to = params.dateTo;
    const { data } = await api.get<{
      data: Array<{ month: string; value: number; target: number }>;
      trend: 'up' | 'down' | 'stable';
      forecast: number;
    }>(`/analysis/trends/${indicatorId}/`, query);
    return data;
  },

  async getIndicatorTrendsBulk(
    indicatorIds: number[],
    params?: {
      months?: number;
      projectId?: number | null;
      coordinatorId?: number | null;
      organizationId?: number | null;
      dateFrom?: string;
      dateTo?: string;
    },
  ): Promise<{
    series: Array<{
      indicator_id: number;
      indicator_name: string;
      data: Array<{ month: string; value: number; target: number }>;
    }>;
  }> {
    const query: Record<string, string> = {};
    const months = params?.months ?? 12;
    if (months) query.months = months.toString();
    if (params?.projectId) query.project = String(params.projectId);
    if (params?.coordinatorId) query.coordinator = String(params.coordinatorId);
    if (params?.organizationId) query.organization = String(params.organizationId);
    if (params?.dateFrom) query.date_from = params.dateFrom;
    if (params?.dateTo) query.date_to = params.dateTo;
    query.indicator_ids = indicatorIds.join(',');
    const { data } = await api.get<{
      series: Array<{
        indicator_id: number;
        indicator_name: string;
        data: Array<{ month: string; value: number; target: number }>;
      }>;
    }>('/analysis/trends/', query);
    return data;
  },

  /**
   * Compare indicators across projects
   * Django endpoint: POST /api/analysis/compare/
   */
  async compareIndicators(request: {
    indicator_id: number;
    project_ids: number[];
    date_from?: string;
    date_to?: string;
  }): Promise<Array<{
    project_id: number;
    project_name: string;
    value: number;
    target: number;
    progress: number;
  }>> {
    const { data } = await api.post<Array<{
      project_id: number;
      project_name: string;
      value: number;
      target: number;
      progress: number;
    }>>('/analysis/compare/', request);
    return data;
  },
};

// ============================================================================
// Flags Service
// ============================================================================

export const flagsService = {
  /**
   * List all flags with optional filters
   * Django endpoint: GET /api/flags/
   */
  async list(filters?: FlagFilters): Promise<PaginatedResponse<Flag>> {
    const params = filters as Record<string, string> | undefined;
    const { data } = await api.get<PaginatedResponse<Flag>>('/flags/', params);
    return data;
  },

  /**
   * Get a single flag by ID
   * Django endpoint: GET /api/flags/:id/
   */
  async get(id: number): Promise<Flag> {
    const { data } = await api.get<Flag>(`/flags/${id}/`);
    return data;
  },

  /**
   * Create a new flag
   * Django endpoint: POST /api/flags/
   */
  async create(request: CreateFlagRequest): Promise<Flag> {
    const { data } = await api.post<Flag>('/flags/', request);
    return data;
  },

  /**
   * Update a flag
   * Django endpoint: PATCH /api/flags/:id/
   */
  async update(id: number, request: UpdateFlagRequest): Promise<Flag> {
    const { data } = await api.patch<Flag>(`/flags/${id}/`, request);
    return data;
  },

  /**
   * Delete a flag
   * Django endpoint: DELETE /api/flags/:id/
   */
  async delete(id: number): Promise<void> {
    await api.delete(`/flags/${id}/`);
  },

  /**
   * Get flag statistics
   * Django endpoint: GET /api/flags/stats/
   */
  async getStats(): Promise<{
    total: number;
    open: number;
    in_progress: number;
    resolved: number;
    by_type: Array<{ flag_type: string; count: number }>;
    by_priority: Array<{ priority: string; count: number }>;
  }> {
    const { data } = await api.get<{
      total: number;
      open: number;
      in_progress: number;
      resolved: number;
      by_type: Array<{ flag_type: string; count: number }>;
      by_priority: Array<{ priority: string; count: number }>;
    }>('/flags/stats/');
    return data;
  },

  /**
   * Run automated data quality checks
   * Django endpoint: POST /api/flags/run-checks/
   */
  async runChecks(projectId?: number): Promise<{
    flags_created: number;
    checks_run: string[];
  }> {
    const { data } = await api.post<{
      flags_created: number;
      checks_run: string[];
    }>('/flags/run-checks/', { project_id: projectId });
    return data;
  },
};

export default reportsService;
