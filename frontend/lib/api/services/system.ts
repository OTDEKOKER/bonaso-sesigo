import { api, fetchWithAuth, normalizeApiError } from "../client";

export type SystemHealthStatus = "ok" | "warning" | "error" | "missing";

export interface SystemStatusResponse {
  status: SystemHealthStatus;
  checked_at: string;
  database: {
    status: SystemHealthStatus;
    engine: string;
    name: string;
  };
  backup: {
    status: SystemHealthStatus;
    age_hours: number | null;
    manifest: {
      created_at_utc?: string;
      backup_file?: string;
      size_bytes?: number;
      sha256?: string;
      verify_status?: string;
      retention_days?: number;
      error?: string;
    } | null;
  };
  parity: {
    status: SystemHealthStatus;
    age_hours: number | null;
    report_file: string | null;
    summary: Record<string, number | string | null> | null;
  };
  disk: {
    path: string;
    total_bytes: number;
    used_bytes: number;
    free_bytes: number;
    used_percent: number;
    status: SystemHealthStatus;
  };
  counts: Record<string, number | null>;
  import_jobs: Record<string, number>;
  warnings: string[];
}

export type BackupReminderLevel = "green" | "amber" | "red";

export interface BackupManagementStatus {
  warning_text: string;
  latest: {
    created_at_utc?: string | null;
    size_bytes?: number | null;
    sha256?: string | null;
    verify_status?: string | null;
    offsite_status?: string | null;
    available: boolean;
  };
  download: {
    last_downloaded_at: string | null;
    last_downloaded_by: string | null;
    days_since_download: number | null;
    level: BackupReminderLevel;
    due: boolean;
    message: string | null;
  };
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

export interface RestoreValidationResult {
  valid: boolean;
  errors: string[];
  archive_ok: boolean;
  checksum_ok: boolean | null;
  source_environment: string;
  target_environment: string;
  environment_conflict: boolean;
  created_at: string | null;
  size_bytes: number | null;
  filename: string | null;
  staged_path: string;
  apply_command: string;
  note: string;
}

export interface RestoreHistoryEntry {
  id: number;
  created_at: string;
  restored_by: string;
  backup_name: string;
  source_environment: string;
  target_environment: string;
  environment_override: boolean;
  result: string;
  notes: string;
}

export const systemService = {
  getStatus: () => api.get<SystemStatusResponse>("/system/status/").then((response) => response.data),

  validateRestore: async (file: File): Promise<RestoreValidationResult> => {
    const form = new FormData();
    form.append("file", file);
    const response = await fetchWithAuth("/system/restore/validate/", { method: "POST", body: form });
    const contentType = response.headers.get("content-type");
    const payload = contentType?.includes("application/json") ? await response.json() : await response.text();
    if (!response.ok) {
      throw normalizeApiError({ status: response.status, payload, fallbackMessage: "Failed to validate backup" });
    }
    return payload as RestoreValidationResult;
  },

  getRestoreHistory: () =>
    api
      .get<{ count: number; results: RestoreHistoryEntry[] }>("/system/restore/history/")
      .then((response) => response.data),

  getBackupStatus: () =>
    api.get<BackupManagementStatus>("/system/backups/status/").then((response) => response.data),

  generateBackup: () =>
    api.post<BackupManagementStatus>("/system/backups/generate/", {}).then((response) => response.data),

  // Streams the latest dump and triggers a browser download. Returns the
  // server-suggested filename so the UI can confirm what was saved.
  downloadBackup: async (): Promise<string> => {
    const response = await fetchWithAuth("/system/backups/download/");
    if (!response.ok) {
      const contentType = response.headers.get("content-type");
      const payload = contentType?.includes("application/json")
        ? await response.json()
        : await response.text();
      throw normalizeApiError({
        status: response.status,
        payload,
        fallbackMessage: "Failed to download backup",
      });
    }
    const disposition = response.headers.get("content-disposition") || "";
    const match = /filename="?([^";]+)"?/i.exec(disposition);
    const filename = match?.[1] || "backup.dump";
    triggerBrowserDownload(await response.blob(), filename);
    return filename;
  },
};
