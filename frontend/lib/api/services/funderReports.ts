/**
 * Funder Report Builder service.
 *
 * Config CRUD (templates/sections/figures/mappings/filters) + generation
 * (preview a figure, generate a whole dashboard) reading EXISTING approved
 * aggregate data. Django base: /api/reports/.
 */
import { api, fetchWithAuth, normalizeApiError, type PaginatedResponse } from '../client';

export type ChartType =
  | 'achieved_vs_target' | 'grouped_bar' | 'stacked_bar' | 'horizontal_bar'
  | 'line' | 'pie' | 'heatmap' | 'cascade' | 'table' | 'compliance';

export type ComplianceStatus = 'submitted' | 'late' | 'not_submitted' | 'not_opened' | 'na';
export interface ComplianceMatrix {
  quarters: string[];
  fiscal_year: number;
  rows: Array<{ coordinator: string; cells: Array<{ quarter: string; status: ComplianceStatus }> }>;
}

export type Visibility = 'private' | 'organization' | 'network' | 'project' | 'funder' | 'public';

export interface ReportTemplate {
  id: number;
  name: string;
  funder: string;
  project: number;
  project_name?: string;
  reporting_year: string;
  description: string;
  is_active: boolean;
  section_count?: number;
  owner?: number | null;
  owner_name?: string;
  visibility?: Visibility;
  shared_with_users?: number[];
  created_by_name?: string;
  created_at?: string;
  updated_at?: string;
}

export interface FigureMapping {
  id: number;
  report_figure: number;
  indicator: number;
  indicator_name?: string;
  indicator_code?: string;
  role: string;
  label_override: string;
  display_order: number;
  include_in_total: boolean;
  calculation_role: string;
}

export interface ReportFigure {
  id: number;
  report_section: number;
  figure_number: string;
  title: string;
  description: string;
  chart_type: ChartType;
  display_order: number;
  aggregation_method: string;
  grouping_dimension: string;
  secondary_grouping_dimension: string;
  target_mode: string;
  calculation_mode: string;
  narrative_template: string;
  is_active: boolean;
  mappings: FigureMapping[];
  filters: unknown[];
}

export interface ReportSection {
  id: number;
  report_template: number;
  title: string;
  objective_label: string;
  description: string;
  display_order: number;
  figures: ReportFigure[];
}

export interface ReportTemplateDetail extends ReportTemplate {
  sections: ReportSection[];
}

/** Normalized, chart-ready output of the generation service. */
export interface GeneratedFigure {
  figure_id: number;
  figure_number: string;
  title: string;
  description: string;
  chart_type: ChartType;
  grouping_dimension: string;
  secondary_grouping_dimension: string;
  categories: string[];
  series: Array<{ name: string; data: number[] }>;
  target?: number[];
  achievement_percent?: (number | null)[];
  ratio_percent?: number | null;
  compliance?: ComplianceMatrix;
  totals: { total: number; target?: number; achievement_percent?: number | null };
  completeness: { expected: number; reporting: number; missing: number; missing_organization_ids: number[] };
  warnings: string[];
  narrative: string;
  period_label?: string;
}

export interface GeneratedDashboard {
  template: { id: number; name: string };
  project: number;
  period_start: string;
  period_end: string;
  period_label: string;
  sections: Array<{ id: number; title: string; objective_label: string; figures: GeneratedFigure[] }>;
}

export interface PeriodQuery {
  project: number;
  quarter?: number | string;
  fiscal_year?: number | string;
  period_start?: string;
  period_end?: string;
  period_type?: 'quarter' | 'year';
  include_unapproved?: boolean;
  // Scope-safe dashboard filters (backend intersects org/coordinator with the
  // caller's allowed scope, so these can never widen access).
  organization?: (number | string)[];
  coordinator?: (number | string)[];
  district?: string[];
  sex?: string[];
  age?: string[];
  key_population?: string[];
  message_type?: (number | string)[];
  service_category?: (number | string)[];
  indicator_group?: (number | string)[];
}

const B = '/reports';

export const funderReportsService = {
  async listTemplates(params?: { project?: number; funder?: string; reporting_year?: string; is_active?: boolean }): Promise<ReportTemplate[]> {
    const { data } = await api.get<PaginatedResponse<ReportTemplate> | ReportTemplate[]>(
      `${B}/templates/`, params as Record<string, string | number | boolean | undefined>);
    return Array.isArray(data) ? data : (data.results ?? []);
  },
  async getTemplate(id: number): Promise<ReportTemplateDetail> {
    const { data } = await api.get<ReportTemplateDetail>(`${B}/templates/${id}/`);
    return data;
  },
  async createTemplate(payload: Partial<ReportTemplate>): Promise<ReportTemplate> {
    const { data } = await api.post<ReportTemplate>(`${B}/templates/`, payload);
    return data;
  },
  async generate(templateId: number, query: PeriodQuery): Promise<GeneratedDashboard> {
    const { data } = await api.post<GeneratedDashboard>(`${B}/templates/${templateId}/generate/`, query);
    return data;
  },
  async previewFigure(figureId: number, query: PeriodQuery): Promise<GeneratedFigure> {
    const { data } = await api.post<GeneratedFigure>(`${B}/figures/${figureId}/preview/`, query);
    return data;
  },
  async addMapping(figureId: number, payload: { indicator: number; role: string; label_override?: string }): Promise<FigureMapping> {
    const { data } = await api.post<FigureMapping>(`${B}/figures/${figureId}/mappings/`, payload);
    return data;
  },
  async deleteMapping(mappingId: number): Promise<void> {
    await api.delete(`${B}/figure-mappings/${mappingId}/`);
  },
  async updateFigure(figureId: number, payload: Partial<ReportFigure>): Promise<ReportFigure> {
    const { data } = await api.patch<ReportFigure>(`${B}/figures/${figureId}/`, payload);
    return data;
  },
  async duplicateFigure(figureId: number): Promise<ReportFigure> {
    const { data } = await api.post<ReportFigure>(`${B}/figures/${figureId}/duplicate/`, {});
    return data;
  },
  async setFigureActive(figureId: number, isActive: boolean): Promise<ReportFigure> {
    const { data } = await api.post<ReportFigure>(`${B}/figures/${figureId}/set-active/`, { is_active: isActive });
    return data;
  },
  async createFilter(payload: { report_figure: number; dimension_name: string; allowed_values?: string[]; exclude_values?: string[]; filter_mode?: string }): Promise<{ id: number }> {
    const { data } = await api.post<{ id: number }>(`${B}/figure-filters/`, payload);
    return data;
  },
  async deleteFilter(filterId: number): Promise<void> {
    await api.delete(`${B}/figure-filters/${filterId}/`);
  },
  async saveSnapshot(figureId: number, query: PeriodQuery): Promise<unknown> {
    const { data } = await api.post(`${B}/figures/${figureId}/save-snapshot/`, query);
    return data;
  },
  /** Export one figure to .xlsx with the same filters/scope as the preview. */
  async exportFigureXlsx(figureId: number, query: PeriodQuery): Promise<Blob> {
    return postBlob(`${B}/figures/${figureId}/export/`, query);
  },
  /** Export the WHOLE report to a Word .docx (same filters/scope). */
  async exportReportWord(templateId: number, query: PeriodQuery): Promise<Blob> {
    return postBlob(`${B}/templates/${templateId}/export-word/`, query);
  },
  /** Update visibility / sharing on a template the user owns. */
  async updateTemplate(id: number, payload: Partial<ReportTemplate> & { shared_with_users?: number[] }): Promise<ReportTemplate> {
    const { data } = await api.patch<ReportTemplate>(`${B}/templates/${id}/`, payload);
    return data;
  },
};

async function postBlob(endpoint: string, body: unknown): Promise<Blob> {
  const response = await fetchWithAuth(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    timeoutMs: 120_000,
  });
  if (!response.ok) {
    const ct = response.headers.get('content-type');
    throw normalizeApiError({
      status: response.status,
      payload: ct?.includes('application/json') ? await response.json() : await response.text(),
    });
  }
  return response.blob();
}

/** Trigger a browser download of a Blob. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
