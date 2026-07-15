/**
 * Management-intelligence data contract (mirrors the backend
 * `/api/analysis/management-intelligence/` payload — snake_case, matching the
 * rest of the API services). Every card answers the five management questions
 * and carries finding / evidence / DQ qualifier / action / drill-down.
 */

export type AttentionSeverity = "critical" | "high" | "medium" | "low";

export type AttentionItem = {
  severity: AttentionSeverity;
  label: string;
  source: "target" | "flag" | "reporting" | "anomaly" | "parity";
};

export type TrendPoint = {
  period: string;
  actual: number;
  target?: number | null;
};

/** Pace vs where we should be by now; `pending` when no comparable target yet. */
export type PaceStatus = "ahead" | "on_track" | "behind" | "at_risk" | "pending";

export type WhereSlice = {
  name: string;
  value: number;
  share_percent?: number | null;
};

/** Distinguishes a reported zero from a reporting gap etc. (audit taxonomy). */
export type DataState = "approved" | "zero_reported" | "not_reported" | "target_pending";

export type Drilldown = {
  type: string;
  project: number | null;
  coordinator: number;
  indicator: number;
  year: number | null;
  quarter: string | null;
};

export type CoordinatorIntelligenceCard = {
  coordinator_id: number;
  coordinator_name: string;
  indicator_id: number;
  indicator_label: string;
  unit?: string | null;
  period: string;

  // 1. What happened?
  actual: number;
  trend: TrendPoint[];

  // 2. Where?
  where: WhereSlice[];

  // 3. Why it matters?
  effective_target: number;
  pct_of_target: number | null;
  pace_status: PaceStatus;
  delta_vs_prior_pct?: number | null;

  // 4. Needs attention?
  attention: AttentionItem[];

  // 5. Action + the mandatory management wrapper
  finding: string;
  evidence: string[];
  dq_qualifier: string;
  recommended_action: string;
  data_state: DataState;
  drilldown: Drilldown;
};

export type ManagementIntelligenceResponse = {
  project: { id: number; code: string; name: string };
  period: { year: number; quarter: string; label: string; window_state: string | null } | null;
  lens: string;
  generated_at?: string;
  cards: CoordinatorIntelligenceCard[];
  detail?: string;
};
