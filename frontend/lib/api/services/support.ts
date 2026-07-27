import { api, type PaginatedResponse } from "../client";

// ============================================================================
// Support / Help-desk Service
// ============================================================================

export type SupportStatus =
  | "new"
  | "acknowledged"
  | "investigating"
  | "awaiting_user"
  | "resolved"
  | "closed"
  | "reopened";

export type SupportSeverity = "low" | "medium" | "high" | "critical";
export type SupportPriority = "low" | "normal" | "high" | "urgent";

export interface SupportTicket {
  id: number;
  title: string;
  description: string;
  category: string;
  category_display: string;
  severity: SupportSeverity;
  severity_display: string;
  priority: SupportPriority;
  priority_display: string;
  status: SupportStatus;
  status_display: string;
  affected_organization: number | null;
  affected_organization_name: string | null;
  affected_project: number | null;
  affected_project_name: string | null;
  reporting_period: number | null;
  reporting_period_label: string;
  reporter: number | null;
  reporter_name: string | null;
  reporter_username: string;
  assigned_to: number | null;
  assigned_to_name: string | null;
  resolution_notes: string;
  resolved_at: string | null;
  related_reference: string;
  is_open: boolean;
  is_overdue: boolean;
  resolution_target_at: string | null;
  comments_count: number;
  created_at: string;
  updated_at: string;
}

export interface SupportComment {
  id: number;
  ticket: number;
  content: string;
  is_internal: boolean;
  created_by: number | null;
  created_by_name: string | null;
  created_by_username: string;
  created_at: string;
}

export interface SupportHistoryEvent {
  id: number;
  action: string;
  event: string;
  actor: string;
  description: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface SupportStats {
  total: number;
  open: number;
  unassigned_open: number;
  overdue: number;
  by_status: Array<{ status: string; count: number }>;
  by_category: Array<{ category: string; count: number }>;
  by_priority: Array<{ priority: string; count: number }>;
}

export interface SupportTicketFilters {
  status?: string;
  category?: string;
  severity?: string;
  priority?: string;
  assigned_to?: string;
  affected_organization?: string;
  affected_project?: string;
  open?: string;
  unassigned?: string;
  search?: string;
  ordering?: string;
  page?: string;
  page_size?: string;
}

export interface CreateSupportTicket {
  title: string;
  description: string;
  category?: string;
  severity?: SupportSeverity;
  priority?: SupportPriority;
  affected_organization?: number | null;
  affected_project?: number | null;
  reporting_period?: number | null;
  reporting_period_label?: string;
  related_reference?: string;
  related_aggregate?: number | null;
  related_upload?: number | null;
}

export const SUPPORT_CATEGORIES: Array<{ value: string; label: string }> = [
  { value: "login_access", label: "Login or access" },
  { value: "permission_role", label: "Permission or role" },
  { value: "org_hierarchy", label: "Organisation hierarchy" },
  { value: "indicator_target", label: "Indicator or target" },
  { value: "workbook_download", label: "Workbook download" },
  { value: "workbook_upload", label: "Workbook upload" },
  { value: "validation_error", label: "Validation error" },
  { value: "submission", label: "Submission" },
  { value: "review_approval", label: "Review or approval" },
  { value: "dashboard_analytics", label: "Dashboard or analytics" },
  { value: "funder_report", label: "Funder report" },
  { value: "performance", label: "Performance" },
  { value: "other", label: "Other" },
];

export const SUPPORT_STATUSES: Array<{ value: SupportStatus; label: string }> = [
  { value: "new", label: "New" },
  { value: "acknowledged", label: "Acknowledged" },
  { value: "investigating", label: "Investigating" },
  { value: "awaiting_user", label: "Awaiting user" },
  { value: "resolved", label: "Resolved" },
  { value: "closed", label: "Closed" },
  { value: "reopened", label: "Reopened" },
];

export const SUPPORT_SEVERITIES: Array<{ value: SupportSeverity; label: string }> = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "critical", label: "Critical" },
];

export const SUPPORT_PRIORITIES: Array<{ value: SupportPriority; label: string }> = [
  { value: "low", label: "Low" },
  { value: "normal", label: "Normal" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" },
];

function asRecord(filters?: SupportTicketFilters): Record<string, string> | undefined {
  if (!filters) return undefined;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null && value !== "") out[key] = String(value);
  }
  return out;
}

export const supportService = {
  async list(filters?: SupportTicketFilters): Promise<PaginatedResponse<SupportTicket>> {
    const { data } = await api.get<PaginatedResponse<SupportTicket>>(
      "/support/tickets/",
      asRecord(filters),
    );
    return data;
  },

  async get(id: number): Promise<SupportTicket> {
    const { data } = await api.get<SupportTicket>(`/support/tickets/${id}/`);
    return data;
  },

  async create(payload: CreateSupportTicket): Promise<SupportTicket> {
    const { data } = await api.post<SupportTicket>("/support/tickets/", payload);
    return data;
  },

  async update(id: number, payload: Partial<CreateSupportTicket>): Promise<SupportTicket> {
    const { data } = await api.patch<SupportTicket>(`/support/tickets/${id}/`, payload);
    return data;
  },

  async assign(id: number, assignedTo: number | null): Promise<SupportTicket> {
    const { data } = await api.post<SupportTicket>(`/support/tickets/${id}/assign/`, {
      assigned_to: assignedTo,
    });
    return data;
  },

  async setStatus(id: number, status: SupportStatus): Promise<SupportTicket> {
    const { data } = await api.post<SupportTicket>(`/support/tickets/${id}/set_status/`, {
      status,
    });
    return data;
  },

  async setPriority(
    id: number,
    payload: { priority?: SupportPriority; severity?: SupportSeverity },
  ): Promise<SupportTicket> {
    const { data } = await api.post<SupportTicket>(`/support/tickets/${id}/set_priority/`, payload);
    return data;
  },

  async resolve(id: number, resolutionNotes: string): Promise<SupportTicket> {
    const { data } = await api.post<SupportTicket>(`/support/tickets/${id}/resolve/`, {
      resolution_notes: resolutionNotes,
    });
    return data;
  },

  async reopen(id: number): Promise<SupportTicket> {
    const { data } = await api.post<SupportTicket>(`/support/tickets/${id}/reopen/`, {});
    return data;
  },

  async listComments(id: number): Promise<SupportComment[]> {
    const { data } = await api.get<SupportComment[]>(`/support/tickets/${id}/comments/`);
    return Array.isArray(data) ? data : [];
  },

  async addComment(id: number, content: string, isInternal = false): Promise<SupportComment> {
    const { data } = await api.post<SupportComment>(`/support/tickets/${id}/comments/`, {
      content,
      is_internal: isInternal,
    });
    return data;
  },

  async history(id: number): Promise<SupportHistoryEvent[]> {
    const { data } = await api.get<SupportHistoryEvent[]>(`/support/tickets/${id}/history/`);
    return Array.isArray(data) ? data : [];
  },

  async stats(): Promise<SupportStats> {
    const { data } = await api.get<SupportStats>("/support/tickets/stats/");
    return data;
  },
};
