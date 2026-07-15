import { api } from "../client";
import type {
  GeographicCoverageResponse,
  ManagementIntelligenceResponse,
} from "@/lib/intelligence/types";

const ENDPOINT = "/analysis/management-intelligence/";

export interface ManagementIntelligenceParams {
  projectId?: number;
  year?: number;
  quarter?: "Q1" | "Q2" | "Q3" | "Q4";
}

/**
 * Management-intelligence cards for a project + period (defaults to the latest
 * elapsed quarter server-side). Read-only; approved data only; coordinator
 * visibility is enforced by the backend to the caller's scope.
 */
export async function fetchManagementIntelligence(
  params: ManagementIntelligenceParams = {},
): Promise<ManagementIntelligenceResponse> {
  const { data } = await api.get<ManagementIntelligenceResponse>(ENDPOINT, {
    project: params.projectId,
    year: params.year,
    quarter: params.quarter,
  });
  return data;
}

/**
 * Exact org/coordinator presence per normalised district (the 'Where' map).
 * Read-only; presence counts only (no per-district value sums, no PII).
 */
export async function fetchGeographicCoverage(
  projectId?: number,
): Promise<GeographicCoverageResponse> {
  const { data } = await api.get<GeographicCoverageResponse>(
    "/analysis/geographic-coverage/",
    { project: projectId },
  );
  return data;
}
