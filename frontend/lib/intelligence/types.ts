/**
 * Management-intelligence data contract.
 *
 * Every intelligence card answers the five management questions. This is the
 * shared shape returned by the backend `coordinator-intelligence` endpoint and
 * consumed by the `IntelligenceCard` component — one type so the "answers" stay
 * aligned end to end.
 */

export type AttentionSeverity = "critical" | "high" | "medium" | "low";

/** One "what requires attention" signal, sourced from an existing subsystem. */
export type AttentionItem = {
  severity: AttentionSeverity;
  label: string;
  /** Which live subsystem raised it (for provenance + drill-through). */
  source: "target" | "flag" | "reporting" | "anomaly" | "parity";
};

export type TrendPoint = {
  period: string;
  actual: number;
  target?: number | null;
};

/** Pace of achievement vs where we should be by this point in the year. */
export type PaceStatus = "ahead" | "on_track" | "behind" | "at_risk";

export type WhereSlice = {
  name: string;
  value: number;
};

/** A single coordinator's headline indicator, fully answered. */
export type CoordinatorIntelligenceCard = {
  coordinatorId: number;
  coordinatorName: string;
  indicatorId: number;
  indicatorLabel: string;
  unit?: string | null;
  period: string;

  // 1. What happened?
  actual: number;
  trend: TrendPoint[];

  // 2. Where did it happen?
  where: WhereSlice[];

  // 3. Why does it matter?
  effectiveTarget: number;
  pctOfTarget: number;
  expectedPacePct: number;
  paceStatus: PaceStatus;
  deltaVsPriorPct?: number | null;

  // 4. What requires attention?
  attention: AttentionItem[];

  // 5. What action should management take?
  recommendedAction: string;
};

export type CoordinatorIntelligenceResponse = {
  project: { id: number; code: string };
  period: string;
  generatedAt: string;
  cards: CoordinatorIntelligenceCard[];
};
