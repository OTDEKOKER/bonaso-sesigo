import { api, fetchWithAuth, normalizeApiError, type PaginatedResponse } from "../client";
import {
  getLegacySubLabelsFromPresetKeys,
  getPresetKeysFromConfig,
  normalizeAggregateDisaggregationConfig,
  type AggregateDisaggregationConfig,
  type DisaggregationPresetKey,
} from "@/lib/indicators/disaggregation-presets";

export type WorkbookImportStatus =
  | "uploaded"
  | "analyzing"
  | "ready_for_review"
  | "validated"
  | "imported"
  | "failed";

export type WorkbookIssueSeverity = "info" | "warning" | "error";

export type WorkbookExportScope =
  | "single_organization"
  | "coordinator"
  | "all_organizations"
  | "consolidated";

export type WorkbookSheetRole =
  | "indicator_matrix"
  | "organization_report"
  | "summary"
  | "unknown";

export type FinancialQuarterCode = "Q1" | "Q2" | "Q3" | "Q4";

export interface WorkbookTemplateSummary {
  id: number;
  name: string;
  workbook_family?: string | null;
  report_category?: string | null;
  version: number;
  is_active: boolean;
  expected_headers?: string[];
  row_labels?: string[];
  column_labels?: string[];
}

export interface WorkbookTemplateMatch {
  template_id?: number | null;
  template_name?: string | null;
  score: number;
  confidence_label: "high" | "medium" | "low";
  matched_on: string[];
}

export interface WorkbookTablePreview {
  title?: string | null;
  start_cell?: string | null;
  end_cell?: string | null;
  header_rows?: number[];
  row_label_columns?: string[];
  column_headers?: string[];
  row_labels?: string[];
  totals_rows?: string[];
  numeric_cells_detected?: number;
}

export interface WorkbookQuarterTargetMap {
  Q1?: number | null;
  Q2?: number | null;
  Q3?: number | null;
  Q4?: number | null;
}

export interface WorkbookIndicatorAssignmentPreview {
  organization_id?: number | null;
  organization_name: string;
  coordinator_id?: number | null;
  coordinator_name?: string | null;
  indicator_id?: number | null;
  indicator_name: string;
  financial_year_label?: string | null;
  targets_by_quarter: WorkbookQuarterTargetMap;
  annual_target?: number | null;
  source_sheet: string;
  source_row_ref?: string | null;
  assignment_confidence: number;
}

export interface WorkbookMissingIndicatorCandidate {
  temp_key: string;
  indicator_name: string;
  suggested_code?: string | null;
  category?: string | null;
  type?: string | null;
  unit?: string | null;
  sub_labels?: string[];
  aggregate_disaggregation_config?: AggregateDisaggregationConfig | null;
  disaggregation_preset_keys?: DisaggregationPresetKey[];
  source_sheet: string;
  source_row_ref?: string | null;
  assigned_organizations: Array<{
    organization_id?: number | null;
    organization_name: string;
    q1_target?: number | null;
    q2_target?: number | null;
    q3_target?: number | null;
    q4_target?: number | null;
  }>;
}

export interface WorkbookSheetAnalysis {
  id: number;
  sheet_name: string;
  sheet_index: number;
  sheet_role?: WorkbookSheetRole;
  detected_indicator?: string | null;
  detected_organization?: string | null;
  detected_project?: string | null;
  detected_reporting_period?: string | null;
  merged_ranges: string[];
  title_blocks: string[];
  metadata_cells: Record<string, string>;
  table_previews: WorkbookTablePreview[];
  assignment_previews?: WorkbookIndicatorAssignmentPreview[];
  template_match?: WorkbookTemplateMatch | null;
  issues: WorkbookValidationIssue[];
}

export interface WorkbookValidationIssue {
  id?: number;
  severity: WorkbookIssueSeverity;
  code: string;
  message: string;
  sheet_name?: string | null;
  cell_ref?: string | null;
  details?: Record<string, unknown> | null;
}

export interface WorkbookImportSummary {
  sheets_scanned: number;
  sheets_skipped: number;
  rows_imported: number;
  rows_skipped: number;
  assignments_detected?: number;
  target_cells_detected?: number;
  warnings: number;
  errors: number;
}

export interface WorkbookImportSession {
  id: number;
  file_name: string;
  status: WorkbookImportStatus;
  project?: number | null;
  project_name?: string | null;
  organization?: number | null;
  organization_name?: string | null;
  reporting_period?: string | null;
  template_id?: number | null;
  template_name?: string | null;
  created_at: string;
  updated_at?: string;
  financial_year_start_month?: number | null;
  summary?: WorkbookImportSummary | null;
  assignments?: WorkbookIndicatorAssignmentPreview[];
  missing_indicators?: WorkbookMissingIndicatorCandidate[];
  sheets?: WorkbookSheetAnalysis[];
  issues?: WorkbookValidationIssue[];
}

export interface WorkbookImportFilters {
  status?: WorkbookImportStatus | "all";
  project?: string;
  organization?: string;
  reporting_period?: string;
  search?: string;
  page?: string;
  page_size?: string;
}

export interface CreateWorkbookImportRequest {
  file: File;
  project?: number;
  organization?: number;
  reporting_period?: string;
  template_id?: number;
  notes?: string;
}

export interface ConfirmWorkbookImportRequest {
  import_mode?: "append" | "replace_period";
  overwrite_existing?: boolean;
  apply_indicator_assignments?: boolean;
  sync_project_indicator_links?: boolean;
  create_missing_indicators?: boolean;
  selected_sheet_ids?: number[];
  template_overrides?: Array<{
    sheet_id: number;
    template_id: number;
  }>;
}

export interface CreateMissingIndicatorsRequest {
  indicators: Array<{
    temp_key: string;
    name: string;
    code: string;
    type: string;
    category?: string;
    unit?: string;
    sub_labels?: string[];
    aggregate_disaggregation_config?: AggregateDisaggregationConfig;
    disaggregation_preset_keys?: DisaggregationPresetKey[];
    organizations?: number[];
  }>;
  assign_to_project?: boolean;
  create_targets?: boolean;
}

export function buildMissingIndicatorPayload(
  candidate: WorkbookMissingIndicatorCandidate,
): CreateMissingIndicatorsRequest["indicators"][number] {
  const normalizedConfig = normalizeAggregateDisaggregationConfig(
    candidate.aggregate_disaggregation_config,
    candidate.sub_labels,
  );
  const presetKeys = candidate.disaggregation_preset_keys?.length
    ? candidate.disaggregation_preset_keys
    : getPresetKeysFromConfig(normalizedConfig, candidate.sub_labels);
  const subLabels = presetKeys.length
    ? getLegacySubLabelsFromPresetKeys(presetKeys)
    : candidate.sub_labels || [];

  return {
    temp_key: candidate.temp_key,
    name: candidate.indicator_name,
    code: candidate.suggested_code || candidate.temp_key,
    type: candidate.type || (normalizedConfig.enabled ? "multi_int" : "number"),
    category: candidate.category || undefined,
    unit: candidate.unit || undefined,
    sub_labels: subLabels,
    aggregate_disaggregation_config: normalizedConfig.enabled ? normalizedConfig : undefined,
    disaggregation_preset_keys: presetKeys,
    organizations: candidate.assigned_organizations
      .map((item) => item.organization_id)
      .filter((value): value is number => typeof value === "number"),
  };
}

export function buildCreateMissingIndicatorsRequest(input: {
  candidates: WorkbookMissingIndicatorCandidate[];
  assign_to_project?: boolean;
  create_targets?: boolean;
}): CreateMissingIndicatorsRequest {
  const { candidates, assign_to_project = true, create_targets = true } = input;

  return {
    indicators: candidates.map(buildMissingIndicatorPayload),
    assign_to_project,
    create_targets,
  };
}

export interface WorkbookExportRequest {
  project: number;
  reporting_period: string;
  scope: WorkbookExportScope;
  financial_year_start_month?: number;
  organization_ids?: number[];
  coordinator_id?: number;
  template_id?: number;
  preserve_formatting?: boolean;
  include_validation_summary?: boolean;
}

export interface WorkbookExportJob {
  id: number;
  status: "pending" | "processing" | "completed" | "failed";
  file_name?: string | null;
  download_url?: string | null;
  scope: WorkbookExportScope;
  reporting_period: string;
  project: number;
  created_at: string;
  completed_at?: string | null;
  errors?: WorkbookValidationIssue[];
}

const cleanParams = (
  filters?: Record<string, string | undefined | null>,
): Record<string, string> | undefined => {
  if (!filters) return undefined;
  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === "" || value === "all") continue;
    params[key] = String(value);
  }
  return Object.keys(params).length ? params : undefined;
};

export const reportWorkbooksService = {
  async createImportSession(request: CreateWorkbookImportRequest): Promise<WorkbookImportSession> {
    const form = new FormData();
    form.append("file", request.file);
    if (request.project) form.append("project", String(request.project));
    if (request.organization) form.append("organization", String(request.organization));
    if (request.reporting_period) form.append("reporting_period", request.reporting_period);
    if (request.template_id) form.append("template_id", String(request.template_id));
    if (request.notes) form.append("notes", request.notes);

    const response = await fetchWithAuth("/report-workbooks/imports/", {
      method: "POST",
      body: form,
    });

    const contentType = response.headers.get("content-type");
    if (!response.ok) {
      const payload = contentType?.includes("application/json")
        ? await response.json()
        : await response.text();
      throw normalizeApiError({
        status: response.status,
        payload,
        fallbackMessage: "Failed to create workbook import session",
      });
    }

    return contentType?.includes("application/json")
      ? ((await response.json()) as WorkbookImportSession)
      : ({} as WorkbookImportSession);
  },

  listImportSessions(filters?: WorkbookImportFilters) {
    return api.get<PaginatedResponse<WorkbookImportSession>>(
      "/report-workbooks/imports/",
      cleanParams(filters as Record<string, string | undefined>),
    );
  },

  async getImportSession(id: number): Promise<WorkbookImportSession> {
    const { data } = await api.get<WorkbookImportSession>(`/report-workbooks/imports/${id}/`);
    return data;
  },

  async analyzeImportSession(id: number): Promise<WorkbookImportSession> {
    const { data } = await api.post<WorkbookImportSession>(
      `/report-workbooks/imports/${id}/analyze/`,
      {},
    );
    return data;
  },

  async confirmImportSession(
    id: number,
    request: ConfirmWorkbookImportRequest,
  ): Promise<WorkbookImportSession> {
    const { data } = await api.post<WorkbookImportSession>(
      `/report-workbooks/imports/${id}/confirm/`,
      request,
    );
    return data;
  },

  async createMissingIndicators(
    id: number,
    request: CreateMissingIndicatorsRequest,
  ): Promise<WorkbookImportSession> {
    const { data } = await api.post<WorkbookImportSession>(
      `/report-workbooks/imports/${id}/create-missing-indicators/`,
      request,
    );
    return data;
  },

  async listTemplates(filters?: {
    search?: string;
    workbook_family?: string;
    report_category?: string;
    page?: string;
    page_size?: string;
  }): Promise<PaginatedResponse<WorkbookTemplateSummary>> {
    const { data } = await api.get<PaginatedResponse<WorkbookTemplateSummary>>(
      "/report-workbooks/templates/",
      cleanParams(filters),
    );
    return data;
  },

  async getTemplate(id: number): Promise<WorkbookTemplateSummary> {
    const { data } = await api.get<WorkbookTemplateSummary>(`/report-workbooks/templates/${id}/`);
    return data;
  },

  async createExportJob(request: WorkbookExportRequest): Promise<WorkbookExportJob> {
    const { data } = await api.post<WorkbookExportJob>("/report-workbooks/exports/", request);
    return data;
  },

  async getExportJob(id: number): Promise<WorkbookExportJob> {
    const { data } = await api.get<WorkbookExportJob>(`/report-workbooks/exports/${id}/`);
    return data;
  },

  async downloadExportJob(id: number): Promise<Blob> {
    const response = await fetchWithAuth(`/report-workbooks/exports/${id}/download/`);
    if (!response.ok) {
      const contentType = response.headers.get("content-type");
      const payload = contentType?.includes("application/json")
        ? await response.json()
        : await response.text();
      throw normalizeApiError({
        status: response.status,
        payload,
        fallbackMessage: "Failed to download workbook export",
      });
    }
    return response.blob();
  },
};

export default reportWorkbooksService;
