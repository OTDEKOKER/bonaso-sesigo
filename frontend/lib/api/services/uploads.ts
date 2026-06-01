import api, { fetchWithAuth, normalizeApiError, type PaginatedResponse } from '../client';

export interface UploadFilters {
  file_type?: string;
  organization?: string;
  content_type?: string;
  search?: string;
  page?: string;
  page_size?: string;
  ordering?: string;
}

export interface CreateUploadRequest {
  name: string;
  file: File;
  description?: string;
  organization?: number;
  content_type?: string;
  object_id?: number;
}

export interface UpdateUploadRequest {
  name?: string;
  description?: string;
  organization?: number;
  content_type?: string;
  object_id?: number;
}

export interface StartImportRequest {
  queue_aggregate_review?: boolean;
  project_id?: number;
  reporting_period?: string;
  period_start?: string;
  period_end?: string;
  sheet_names?: string[];
  dry_run?: boolean;
  indicator_overrides?: Record<string, number | string>;
  sheet_org_overrides?: Record<string, number | string>;
}

export interface UploadRecord {
  id: number;
  name: string;
  file: string;
  file_url?: string | null;
  file_type: 'document' | 'image' | 'spreadsheet' | 'other';
  file_size: number;
  mime_type?: string;
  description?: string;
  organization?: number | null;
  organization_name?: string | null;
  content_type?: string;
  object_id?: number | null;
  created_at: string;
  created_by?: number | null;
  created_by_name?: string | null;
}

export interface ImportJob {
  id: number;
  upload: number;
  upload_name?: string;
  job_type?: string;
  status:
    | 'pending'
    | 'uploaded'
    | 'analyzing'
    | 'ready_for_review'
    | 'processing'
    | 'validated'
    | 'completed'
    | 'imported'
    | 'failed';
  total_rows: number;
  processed_rows: number;
  successful_rows: number;
  failed_rows: number;
  progress: number;
  errors?: unknown[];
  parameters?: Record<string, unknown>;
  result?: Record<string, unknown>;
  output_file?: string;
  started_at?: string | null;
  completed_at?: string | null;
  created_at: string;
  created_by?: number | null;
  aggregate_review_queued?: boolean;
  dry_run?: boolean;
  aggregate_import_summary?: {
    matched_rows?: number;
    unknown_rows?: number;
    unique_unknown_titles?: number;
    updated_indicator_count?: number;
    project_assignments_created?: number;
    aggregate_upserts?: number;
    unknown_titles?: Record<string, number>;
    indicator_override_count?: number;
    sheet_org_override_count?: number;
    [key: string]: unknown;
  };
  aggregate_import_report?: Record<string, unknown>;
  background_job_started?: boolean;
  log_path?: string;
}

export interface ExportJob {
  id: number;
  job_type: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  parameters?: Record<string, unknown>;
  result?: Record<string, unknown>;
  output_file?: string;
  file_name?: string;
  content_type?: string;
  errors?: unknown[];
  download_url?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  created_at: string;
  created_by?: number | null;
  created_by_name?: string | null;
  background_job_started?: boolean;
  log_path?: string;
}

export const uploadsService = {
  list: (filters?: UploadFilters) =>
    api.get<PaginatedResponse<UploadRecord>>('/uploads/', filters as Record<string, string> | undefined),

  listAll: (filters?: UploadFilters) =>
    api.get<PaginatedResponse<UploadRecord>>('/uploads/', {
      page_size: '200',
      ...filters,
    }),

  get: (id: number) => api.get<UploadRecord>(`/uploads/${id}/`),

  create: async (data: CreateUploadRequest) => {
    const form = new FormData();
    form.append('name', data.name);
    form.append('file', data.file);
    if (data.description) form.append('description', data.description);
    if (data.organization) form.append('organization', String(data.organization));
    if (data.content_type) form.append('content_type', data.content_type);
    if (data.object_id) form.append('object_id', String(data.object_id));

    const response = await fetchWithAuth('/uploads/', {
      method: 'POST',
      body: form,
    });

    const contentType = response.headers.get('content-type');
    if (!response.ok) {
      const errorBody = contentType?.includes('application/json')
        ? await response.json()
        : await response.text();
      throw normalizeApiError({
        status: response.status,
        payload: errorBody,
        fallbackMessage: 'Failed to upload file',
      });
    }

    return contentType?.includes('application/json') ? response.json() : {};
  },

  update: (id: number, data: UpdateUploadRequest) =>
    api.patch<UploadRecord>(`/uploads/${id}/`, data),

  delete: (id: number) => api.delete(`/uploads/${id}/`),

  startImport: async (id: number, request?: StartImportRequest) => {
    const response = await api.post<ImportJob>(`/uploads/${id}/start_import/`, request || {});
    return response.data;
  },

  retryImportJob: async (id: number) => {
    const response = await api.post<ImportJob>(`/uploads/imports/${id}/retry/`, {});
    return response.data;
  },

  listImports: (filters?: { status?: string; upload?: string }) =>
    api.get<PaginatedResponse<ImportJob>>('/uploads/imports/', filters),

  listAllImports: async (filters?: { status?: string; upload?: string }) => {
    const results: ImportJob[] = [];
    let page = '1';

    while (true) {
      const response = await api.get<PaginatedResponse<ImportJob>>('/uploads/imports/', {
        ...(filters || {}),
        page,
      });

      results.push(...(response.data.results || []));

      if (!response.data.next) break;

      try {
        const nextUrl = new URL(response.data.next);
        const nextPage = nextUrl.searchParams.get('page');
        if (!nextPage) break;
        page = nextPage;
      } catch {
        break;
      }
    }

    return results;
  },

  createExportJob: async (request: { job_type?: string; parameters?: Record<string, string | number | boolean | null | undefined> }) => {
    const response = await api.post<ExportJob>('/uploads/exports/', request);
    return response.data;
  },

  getExportJob: async (id: number) => {
    const response = await api.get<ExportJob>(`/uploads/exports/${id}/`);
    return response.data;
  },

  retryExportJob: async (id: number) => {
    const response = await api.post<ExportJob>(`/uploads/exports/${id}/retry/`, {});
    return response.data;
  },

  downloadExportJob: async (id: number): Promise<Blob> => {
    const response = await fetchWithAuth(`/uploads/exports/${id}/download/`);
    if (!response.ok) {
      const contentType = response.headers.get('content-type');
      const payload = contentType?.includes('application/json')
        ? await response.json()
        : await response.text();
      throw normalizeApiError({
        status: response.status,
        payload,
        fallbackMessage: 'Failed to download export',
      });
    }
    return response.blob();
  },

  listExports: (filters?: { status?: string; job_type?: string }) =>
    api.get<PaginatedResponse<ExportJob>>('/uploads/exports/', filters),

  listAllExports: async (filters?: { status?: string; job_type?: string }) => {
    const results: ExportJob[] = [];
    let page = '1';

    while (true) {
      const response = await api.get<PaginatedResponse<ExportJob>>('/uploads/exports/', {
        ...(filters || {}),
        page,
      });

      results.push(...(response.data.results || []));

      if (!response.data.next) break;

      try {
        const nextUrl = new URL(response.data.next);
        const nextPage = nextUrl.searchParams.get('page');
        if (!nextPage) break;
        page = nextPage;
      } catch {
        break;
      }
    }

    return results;
  },
};

export default uploadsService;
