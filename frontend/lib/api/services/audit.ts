import { api, fetchWithAuth, normalizeApiError, type PaginatedResponse } from "../client";

// ============================================================================
// Types
// ============================================================================

// One row of the unified, append-only audit stream (backend `audit.AuditEvent`).
export interface AuditEvent {
  id: number;
  actor: number | null;
  actor_username: string;
  actor_display: string;
  action: string;
  object_type: string;
  object_id: string;
  organization: number | null;
  organization_name: string;
  project: number | null;
  project_name: string;
  ip_address: string | null;
  description: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface AuditActionOption {
  value: string;
  label: string;
}

export interface AuditEventFilters {
  action?: string;
  actor?: string;
  object_type?: string;
  organization?: string;
  project?: string;
  date_from?: string;
  date_to?: string;
  ordering?: string;
  page?: string;
  page_size?: string;
}

// A single "active user" row (subset of the user record we surface on the
// activity page). Read from `/api/users/?ordering=-last_activity`.
export interface ActiveUser {
  id: number;
  username: string;
  full_name: string;
  role: string;
  organization_name: string | null;
  is_active: boolean;
  last_activity: string | null;
}

function triggerBrowserDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function toQueryString(filters?: AuditEventFilters): string {
  if (!filters) return "";
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      params.append(key, String(value));
    }
  });
  const query = params.toString();
  return query ? `?${query}` : "";
}

export const auditService = {
  // Paginated, filterable audit stream (admin-only on the backend).
  listEvents: (filters?: AuditEventFilters) =>
    api
      .get<PaginatedResponse<AuditEvent>>(
        "/audit/events/",
        filters as Record<string, string | undefined> | undefined,
      )
      .then((response) => response.data),

  // The distinct action vocabulary, for the filter dropdown.
  listActions: () =>
    api.get<AuditActionOption[]>("/audit/events/actions/").then((response) => response.data),

  // Download the currently-filtered audit stream as CSV (capped to 50k rows
  // server-side). Returns the saved filename.
  exportCsv: async (filters?: AuditEventFilters): Promise<string> => {
    const response = await fetchWithAuth(`/audit/events/export/${toQueryString(filters)}`);
    if (!response.ok) {
      const contentType = response.headers.get("content-type");
      const payload = contentType?.includes("application/json")
        ? await response.json()
        : await response.text();
      throw normalizeApiError({
        status: response.status,
        payload,
        fallbackMessage: "Failed to export audit log",
      });
    }
    const disposition = response.headers.get("content-disposition") || "";
    const match = /filename="?([^";]+)"?/i.exec(disposition);
    const filename = match?.[1] || "audit_log.csv";
    triggerBrowserDownload(await response.blob(), filename);
    return filename;
  },

  // Recently-active users, most-recent first. There is no live-session table
  // (auth is JWT); "active" is the user's last recorded activity timestamp.
  listActiveUsers: (pageSize = 50) =>
    api
      .get<PaginatedResponse<ActiveUser>>("/users/", {
        ordering: "-last_activity",
        page_size: String(pageSize),
      })
      .then((response) => response.data.results),
};
