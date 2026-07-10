/**
 * Projects Service
 * 
 * CRUD operations for projects, tasks, targets, and deadlines.
 * Django endpoint base: /api/manage/
 */

import { api, type PaginatedResponse } from '../client';
import type { Project, Task, ProjectDeadline } from '@/lib/types';

// ============================================================================
// Types
// ============================================================================

export interface ProjectFilters {
  search?: string;
  status?: string;
  funder?: string;
  organization?: string;
  page?: string;
  page_size?: string;
}

export interface CreateProjectRequest {
  name: string;
  code: string;
  funder?: string;
  description?: string;
  start_date: string;
  end_date: string;
  is_training?: boolean;
  organizations?: number[];
  hierarchy_overrides?: Record<string, Array<string | number>>;
}

export interface UpdateProjectRequest extends Partial<CreateProjectRequest> {
  status?: 'draft' | 'active' | 'completed' | 'archived';
}

export interface TaskFilters {
  search?: string;
  status?: string;
  assigned_to?: string;
  project?: string;
  page?: string;
  page_size?: string;
}

export interface CreateTaskRequest {
  name: string;
  description?: string;
  project: number;
  assigned_to?: number;
  due_date?: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
}

export interface UpdateTaskRequest extends Partial<CreateTaskRequest> {
  status?: 'pending' | 'in_progress' | 'completed' | 'cancelled';
}

export interface DeadlineFilters {
  project?: string;
  indicator?: string;
  status?: string;
  upcoming?: string;
  coordinator?: string;
  organization?: string;
  date_from?: string;
  date_to?: string;
  page?: string;
  page_size?: string;
}

export interface CreateDeadlineRequest {
  project: number;
  name: string;
  description?: string;
  due_date: string;
  indicators?: number[];
}

export interface UpdateDeadlineRequest extends Partial<CreateDeadlineRequest> {
  status?: 'pending' | 'submitted' | 'approved' | 'overdue';
}

export interface TargetRequest {
  indicator_id: number;
  organization_id: number;
  q1_target: number;
  q2_target: number;
  q3_target: number;
  q4_target: number;
  baseline_value?: number;
}

export interface ProjectOrganizationRoleRequest {
  organization_id: number;
  role:
    | 'lead'
    | 'coordinator'
    | 'sub_grantee'
    | 'implementing_partner'
    | 'data_reviewer'
    | 'funder'
    | 'other';
  client_id?: number | null;
  parent_assignment_id?: number | null;
  cluster?: string;
  is_coordinator?: boolean;
  is_sub_grantee?: boolean;
  is_implementer?: boolean;
  can_report_indicators?: boolean;
  thematic_areas?: string[];
  districts?: string[];
  localities?: string[];
  contract_start_date?: string | null;
  contract_end_date?: string | null;
  source_sheet?: string;
  source_row?: number | null;
  is_training?: boolean;
  is_active?: boolean;
  implementation_scope?: Record<string, unknown>;
}

export interface ProjectDisaggregationRuleRequest {
  organization_id?: number | null;
  dimension_key: string;
  display_label?: string;
  is_required?: boolean;
  is_active?: boolean;
  sort_order?: number;
  config?: Record<string, unknown>;
}

export interface ProjectIndicatorAssignmentRequest {
  indicator_id: number;
  organization_ids: number[];
  disaggregation_rules?: ProjectDisaggregationRuleRequest[];
}

export interface ProjectHierarchyLinkRequest {
  parent_organization_id: number;
  child_organization_id: number;
}

// ============================================================================
// Projects Service
// ============================================================================

const LIST_ALL_PAGE_SIZE = '500';

export const projectsService = {
  /**
   * List all projects with optional filters
   * Django endpoint: GET /api/manage/projects/
   */
  async list(filters?: ProjectFilters): Promise<PaginatedResponse<Project>> {
    const params = filters as Record<string, string> | undefined;
    const { data } = await api.get<PaginatedResponse<Project>>('/manage/projects/', params);
    return data;
  },
  /**
   * List all projects across all pages
   */
  async listAll(filters?: ProjectFilters): Promise<Project[]> {
    const results: Project[] = [];
    let page = filters?.page ? String(filters.page) : "1";
    const baseFilters = { ...(filters || {}) } as Record<string, string>;
    delete baseFilters.page;
    if (!baseFilters.page_size) {
      baseFilters.page_size = LIST_ALL_PAGE_SIZE;
    }

    while (true) {
      const { data } = await api.get<PaginatedResponse<Project>>('/manage/projects/', {
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

  /**
   * Get a single project by ID
   * Django endpoint: GET /api/manage/projects/:id/
   */
  async get(
    id: number,
    options?: { light?: boolean; timeoutMs?: number },
  ): Promise<Project> {
    // ?light=1 skips the heavy per-org indicator-assignment matrix + disaggregation
    // rules + project-org role rows on the backend.
    const params = options?.light ? { light: '1' } : undefined;

    // Full project responses can be several megabytes on large projects.
    const timeoutMs = options?.timeoutMs ?? (options?.light ? 30_000 : 60_000);

    const { data } = await api.get<Project>(
      `/manage/projects/${id}/`,
      params,
      { timeoutMs },
    );
    return data;
  },

  /**
   * Create a new project
   * Django endpoint: POST /api/manage/projects/
   */
  async create(request: CreateProjectRequest): Promise<Project> {
    const { data } = await api.post<Project>('/manage/projects/', request);
    return data;
  },

  /**
   * Update a project
   * Django endpoint: PATCH /api/manage/projects/:id/
   */
  async update(id: number, request: UpdateProjectRequest): Promise<Project> {
    const { data } = await api.patch<Project>(`/manage/projects/${id}/`, request);
    return data;
  },

  /**
   * Delete a project
   * Django endpoint: DELETE /api/manage/projects/:id/
   */
  async delete(id: number): Promise<void> {
    await api.delete(`/manage/projects/${id}/`);
  },

  /**
   * Get project dashboard stats
   * Django endpoint: GET /api/manage/projects/:id/stats/
   */
  async getStats(id: number): Promise<{
    total_indicators: number;
    completed_targets: number;
    pending_deadlines: number;
    progress_percentage: number;
  }> {
    const { data } = await api.get<{
      total_indicators: number;
      completed_targets: number;
      pending_deadlines: number;
      progress_percentage: number;
    }>(`/manage/projects/${id}/stats/`);
    return data;
  },

  /**
   * Assign indicators to project
   * Django endpoint: POST /api/manage/projects/:id/assign-indicators/
   */
  async assignIndicators(id: number, indicatorIds: number[]): Promise<void> {
    await api.post(`/manage/projects/${id}/assign_indicators/`, { indicator_ids: indicatorIds });
  },

  /**
   * Set target for indicator in project
   * Django endpoint: POST /api/manage/projects/:id/targets/
   */
  async setTarget(id: number, request: TargetRequest): Promise<void> {
    await api.post(`/manage/projects/${id}/set_target/`, request);
  },

  /**
   * Get project setup payload (roles, hierarchy, assignments, disaggregation rules)
   * Django endpoint: GET /api/manage/projects/:id/setup/
   */
  async getSetup(id: number): Promise<Project> {
    const { data } = await api.get<Project>(`/manage/projects/${id}/setup/`);
    return data;
  },

  /**
   * Set project organization roles.
   * Django endpoint: POST /api/manage/projects/:id/set_organization_roles/
   */
  async setOrganizationRoles(
    id: number,
    roles: ProjectOrganizationRoleRequest[],
  ): Promise<{ detail: string; updated: number }> {
    const { data } = await api.post<{ detail: string; updated: number }>(
      `/manage/projects/${id}/set_organization_roles/`,
      { roles },
    );
    return data;
  },

  /**
   * Set project organization hierarchy links directly (normalized table).
   * Dual-writes to hierarchy_overrides JSON for backward compat.
   * Django endpoint: POST /api/manage/projects/:id/set_hierarchy_links/
   */
  async setHierarchyLinks(
    id: number,
    links: ProjectHierarchyLinkRequest[],
    replace: boolean = true,
  ): Promise<{ detail: string; links_updated: number }> {
    const { data } = await api.post<{ detail: string; links_updated: number }>(
      `/manage/projects/${id}/set_hierarchy_links/`,
      { links, replace },
    );
    return data;
  },

  /**
   * Set project indicator assignments and disaggregation rules.
   * Django endpoint: POST /api/manage/projects/:id/set_indicator_assignments/
   */
  async setIndicatorAssignments(
    id: number,
    assignments: ProjectIndicatorAssignmentRequest[],
    replace: boolean = true,
  ): Promise<{
    detail: string;
    assignments_updated: number;
    disaggregation_rules_updated: number;
  }> {
    const { data } = await api.post<{
      detail: string;
      assignments_updated: number;
      disaggregation_rules_updated: number;
    }>(`/manage/projects/${id}/set_indicator_assignments/`, { assignments, replace });
    return data;
  },

  /**
   * Admin-only: clear all training data for a training project.
   * Django endpoint: POST /api/manage/projects/:id/training_reset/
   */
  async trainingReset(id: string | number): Promise<{
    detail: string;
    project: string;
    aggregates_deleted: number;
    narrative_reports_deleted: number;
    tasks_deleted: number;
    deadlines_deleted: number;
    activities_deleted: number;
    production_records_touched: number;
  }> {
    const { data } = await api.post<{
      detail: string;
      project: string;
      aggregates_deleted: number;
      narrative_reports_deleted: number;
      tasks_deleted: number;
      deadlines_deleted: number;
      activities_deleted: number;
      production_records_touched: number;
    }>(`/manage/projects/${id}/training_reset/`, { confirm: true });
    return data;
  },
};

// ============================================================================
// Tasks Service
// ============================================================================

export const tasksService = {
  /**
   * List all tasks with optional filters
   * Django endpoint: GET /api/manage/tasks/
   */
  async list(filters?: TaskFilters): Promise<PaginatedResponse<Task>> {
    const params = filters as Record<string, string> | undefined;
    const { data } = await api.get<PaginatedResponse<Task>>('/manage/tasks/', params);
    return data;
  },

  /**
   * Get a single task by ID
   * Django endpoint: GET /api/manage/tasks/:id/
   */
  async get(id: number): Promise<Task> {
    const { data } = await api.get<Task>(`/manage/tasks/${id}/`);
    return data;
  },

  /**
   * Create a new task
   * Django endpoint: POST /api/manage/tasks/
   */
  async create(request: CreateTaskRequest): Promise<Task> {
    const { data } = await api.post<Task>('/manage/tasks/', request);
    return data;
  },

  /**
   * Update a task
   * Django endpoint: PATCH /api/manage/tasks/:id/
   */
  async update(id: number, request: UpdateTaskRequest): Promise<Task> {
    const { data } = await api.patch<Task>(`/manage/tasks/${id}/`, request);
    return data;
  },

  /**
   * Delete a task
   * Django endpoint: DELETE /api/manage/tasks/:id/
   */
  async delete(id: number): Promise<void> {
    await api.delete(`/manage/tasks/${id}/`);
  },

  /**
   * Mark task as complete
   * Django endpoint: POST /api/manage/tasks/:id/complete/
   */
  async complete(id: number): Promise<Task> {
    const { data } = await api.post<Task>(`/manage/tasks/${id}/complete/`);
    return data;
  },
};

// ============================================================================
// Deadlines Service
// ============================================================================

export const deadlinesService = {
  /**
   * List all deadlines with optional filters
   * Django endpoint: GET /api/manage/deadlines/
   */
  async list(filters?: DeadlineFilters): Promise<PaginatedResponse<ProjectDeadline>> {
    const params = filters as Record<string, string> | undefined;
    const { data } = await api.get<PaginatedResponse<ProjectDeadline>>('/manage/deadlines/', params);
    return data;
  },

  /**
   * Get a single deadline by ID
   * Django endpoint: GET /api/manage/deadlines/:id/
   */
  async get(id: number): Promise<ProjectDeadline> {
    const { data } = await api.get<ProjectDeadline>(`/manage/deadlines/${id}/`);
    return data;
  },

  /**
   * Create a new deadline
   * Django endpoint: POST /api/manage/deadlines/
   */
  async create(request: CreateDeadlineRequest): Promise<ProjectDeadline> {
    const { data } = await api.post<ProjectDeadline>('/manage/deadlines/', request);
    return data;
  },

  /**
   * Update a deadline
   * Django endpoint: PATCH /api/manage/deadlines/:id/
   */
  async update(id: number, request: UpdateDeadlineRequest): Promise<ProjectDeadline> {
    const { data } = await api.patch<ProjectDeadline>(`/manage/deadlines/${id}/`, request);
    return data;
  },

  /**
   * Delete a deadline
   * Django endpoint: DELETE /api/manage/deadlines/:id/
   */
  async delete(id: number): Promise<void> {
    await api.delete(`/manage/deadlines/${id}/`);
  },

  /**
   * Get upcoming deadlines
   * Django endpoint: GET /api/manage/deadlines/upcoming/
   */
  async getUpcoming(days: number = 7): Promise<ProjectDeadline[]> {
    const { data } = await api.get<ProjectDeadline[]>('/manage/deadlines/upcoming/', { days: days.toString() });
    return data;
  },

  /**
   * Submit deadline
   * Django endpoint: POST /api/manage/deadlines/:id/submit/
   */
  async submit(id: number): Promise<ProjectDeadline> {
    const { data } = await api.post<ProjectDeadline>(`/manage/deadlines/${id}/submit/`);
    return data;
  },
};

// ============================================================================
// Project Activities
// ============================================================================

export interface ProjectActivity {
  id: string;
  project: string;
  project_name?: string;
  title: string;
  description?: string;
  status: 'planned' | 'ongoing' | 'completed' | 'cancelled';
  start_date?: string | null;
  end_date?: string | null;
  visible_to_all: boolean;
  organization?: string | null;
  organization_name?: string;
  created_by?: string | null;
  created_by_name?: string;
  created_at: string;
  updated_at: string;
}

export interface ProjectActivityFilters {
  project?: string;
  status?: string;
  organization?: string;
  page?: string;
  page_size?: string;
}

export interface CreateProjectActivityRequest {
  project: number;
  title: string;
  description?: string;
  status?: ProjectActivity['status'];
  start_date?: string;
  end_date?: string;
  visible_to_all?: boolean;
  organization?: number;
}

export type UpdateProjectActivityRequest = Partial<CreateProjectActivityRequest>;

// ============================================================================
// Client Organizations
// ============================================================================

export interface ClientOrganization {
  id: string;
  name: string;
  description?: string;
  contact_name?: string;
  contact_email?: string;
  contact_phone?: string;
  website?: string;
  is_active: boolean;
  projects?: string[];
  project_count?: number;
  created_at: string;
  updated_at: string;
}

export interface ClientOrganizationFilters {
  is_active?: string;
  search?: string;
  page?: string;
  page_size?: string;
}

export interface CreateClientOrganizationRequest {
  name: string;
  description?: string;
  contact_name?: string;
  contact_email?: string;
  contact_phone?: string;
  website?: string;
  is_active?: boolean;
  projects?: number[];
}

export const clientOrganizationsService = {
  async list(filters?: ClientOrganizationFilters): Promise<PaginatedResponse<ClientOrganization>> {
    const params = filters as Record<string, string> | undefined;
    const { data } = await api.get<PaginatedResponse<ClientOrganization>>('/manage/clients/', params);
    return data;
  },

  async get(id: number): Promise<ClientOrganization> {
    const { data } = await api.get<ClientOrganization>(`/manage/clients/${id}/`);
    return data;
  },

  async create(request: CreateClientOrganizationRequest): Promise<ClientOrganization> {
    const { data } = await api.post<ClientOrganization>('/manage/clients/', request);
    return data;
  },

  async update(id: number, request: Partial<CreateClientOrganizationRequest>): Promise<ClientOrganization> {
    const { data } = await api.patch<ClientOrganization>(`/manage/clients/${id}/`, request);
    return data;
  },

  async delete(id: number): Promise<void> {
    await api.delete(`/manage/clients/${id}/`);
  },
};

export const projectActivitiesService = {
  async list(filters?: ProjectActivityFilters): Promise<PaginatedResponse<ProjectActivity>> {
    const params = filters as Record<string, string> | undefined;
    const { data } = await api.get<PaginatedResponse<ProjectActivity>>('/manage/project-activities/', params);
    return data;
  },

  async create(request: CreateProjectActivityRequest): Promise<ProjectActivity> {
    const { data } = await api.post<ProjectActivity>('/manage/project-activities/', request);
    return data;
  },

  async update(id: number, request: UpdateProjectActivityRequest): Promise<ProjectActivity> {
    const { data } = await api.patch<ProjectActivity>(`/manage/project-activities/${id}/`, request);
    return data;
  },

  async delete(id: number): Promise<void> {
    await api.delete(`/manage/project-activities/${id}/`);
  },
};

// ============================================================================
// Narrative Reports
// ============================================================================

export interface NarrativeReport {
  id: string;
  project: string;
  project_name?: string;
  organization: string;
  organization_name?: string;
  title: string;
  description?: string;
  file?: string;
  file_url?: string | null;
  file_name?: string;
  uploaded_by?: string | null;
  uploaded_by_name?: string;
  created_at: string;
  updated_at: string;
}

export interface NarrativeReportFilters {
  project?: string;
  organization?: string;
  page?: string;
  page_size?: string;
}

export const narrativeReportsService = {
  async list(filters?: NarrativeReportFilters): Promise<PaginatedResponse<NarrativeReport>> {
    const params = filters as Record<string, string> | undefined;
    const { data } = await api.get<PaginatedResponse<NarrativeReport>>('/manage/narrative-reports/', params);
    return data;
  },

  async create(formData: FormData): Promise<NarrativeReport> {
    const { data } = await api.postForm<NarrativeReport>('/manage/narrative-reports/', formData);
    return data;
  },

  async update(id: string, formData: FormData): Promise<NarrativeReport> {
    const { data } = await api.patchForm<NarrativeReport>(`/manage/narrative-reports/${id}/`, formData);
    return data;
  },

  async delete(id: string): Promise<void> {
    await api.delete(`/manage/narrative-reports/${id}/`);
  },
};
