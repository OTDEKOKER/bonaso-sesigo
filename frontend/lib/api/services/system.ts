import { api } from "../client";

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

export const systemService = {
  getStatus: () => api.get<SystemStatusResponse>("/system/status/").then((response) => response.data),
};
