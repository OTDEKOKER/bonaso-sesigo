import { api } from "../client";
import type { ManagementIntelligenceResponse } from "@/lib/intelligence/types";

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
