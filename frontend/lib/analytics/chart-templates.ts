import {
  applyCustomAnalysisSmartDefaults,
  type CustomAnalysisShowAs,
  type CustomAnalysisState,
} from "@/components/analysis/custom-analysis-builder";
import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  BarChartHorizontal,
  Gauge,
  LineChart,
  ListTree,
  PieChart,
  Table2,
  Target,
  Users,
} from "lucide-react";

/**
 * The simplified "create a visualization" layer. Users think in terms of a
 * chart pattern (template) plus two plain questions — "Group by" (the x-axis
 * categories) and "Split by" (an optional second series). This module turns
 * that small vocabulary into a full {@link CustomAnalysisState}, which the rest
 * of the analytics pipeline (engine, adapter, dashboard persistence) already
 * understands. Nothing downstream changes: a chart built here is identical to
 * one a power user would assemble in the Advanced builder.
 */

/** Chart types offered in the simple builder; each maps 1:1 to `showAs`. */
export type SimpleChartType = Extract<
  CustomAnalysisShowAs,
  "bar" | "stacked-bar" | "line" | "donut" | "kpi" | "table"
>;

export const SIMPLE_CHART_TYPES: Array<{ value: SimpleChartType; label: string; icon: LucideIcon }> = [
  { value: "bar", label: "Bar chart", icon: BarChart3 },
  { value: "stacked-bar", label: "Stacked bar", icon: BarChartHorizontal },
  { value: "line", label: "Line chart", icon: LineChart },
  { value: "donut", label: "Pie chart", icon: PieChart },
  { value: "kpi", label: "Single number", icon: Gauge },
  { value: "table", label: "Table", icon: Table2 },
];

/**
 * Dimensions that the engine treats as a "comparison mode" (they map onto
 * `compareBy`) rather than a disaggregation breakdown (which map onto
 * `breakDownBy` / `secondaryBreakdown`). Everything else — `sex`, `age_band`,
 * `kp_type`, and any indicator-specific disaggregation key — is a breakdown.
 */
export const COMPARISON_DIMENSIONS = ["period", "organization", "coordinator", "indicator"] as const;
export type ComparisonDimension = (typeof COMPARISON_DIMENSIONS)[number];

export function isComparisonDimension(dimension: string): dimension is ComparisonDimension {
  return (COMPARISON_DIMENSIONS as readonly string[]).includes(dimension);
}

const NONE = "none";

function normalizeDimension(value: string | undefined | null): string {
  const trimmed = (value || "").trim();
  return trimmed && trimmed !== NONE ? trimmed : "";
}

/** The user-facing choices in the simple builder. */
export type SimpleSelection = {
  /** X-axis categories. "" / "none" means no explicit grouping. */
  groupBy: string;
  /** Optional second series (grouped/stacked). "" / "none" means none. */
  splitBy: string;
  chartType: SimpleChartType;
  /** Overlay the indicator target (Achieved vs Target). */
  withTarget: boolean;
};

export const DEFAULT_SIMPLE_SELECTION: SimpleSelection = {
  groupBy: "",
  splitBy: "",
  chartType: "bar",
  withTarget: false,
};

/**
 * Fold a {@link SimpleSelection} into a base state. Writes exactly the fields
 * the Advanced builder writes, then runs the existing smart-defaults pass so
 * the result is indistinguishable from a manually-built analysis.
 */
export function applySimpleSelection(base: CustomAnalysisState, selection: SimpleSelection): CustomAnalysisState {
  const next: CustomAnalysisState = {
    ...base,
    indicatorIds: [...base.indicatorIds],
    selectedPeriods: [...base.selectedPeriods],
    selectedOrgIds: [...base.selectedOrgIds],
    // Reset the four "split" fields to a clean slate before re-deriving them.
    compareBy: "none",
    breakDownBy: "none",
    secondaryBreakdown: "none",
    compareWith: "none",
    targetLine: false,
    showAs: selection.chartType,
  };

  const assign = (dimension: string) => {
    const dim = normalizeDimension(dimension);
    if (!dim) return;
    if (isComparisonDimension(dim)) {
      // The engine supports a single comparison mode; first one wins.
      if (next.compareBy === "none") next.compareBy = dim;
      return;
    }
    if (next.breakDownBy === "none") next.breakDownBy = dim;
    else if (next.secondaryBreakdown === "none") next.secondaryBreakdown = dim;
  };

  assign(selection.groupBy);
  if (normalizeDimension(selection.splitBy) !== normalizeDimension(selection.groupBy)) {
    assign(selection.splitBy);
  }

  if (selection.withTarget) {
    next.compareWith = "target";
    next.targetLine = true;
  }

  return applyCustomAnalysisSmartDefaults(next);
}

/**
 * Reverse of {@link applySimpleSelection}: read an existing state back into the
 * simple vocabulary so the simple builder can round-trip a saved analysis.
 */
export function deriveSimpleSelection(state: CustomAnalysisState): SimpleSelection {
  const comparison = normalizeDimension(state.compareBy);
  const primary = normalizeDimension(state.breakDownBy);
  const secondary = normalizeDimension(state.secondaryBreakdown);

  // Group is the comparison mode if one is set, otherwise the primary breakdown.
  const groupBy = comparison || primary;
  // Split is whatever meaningful dimension is left over.
  const splitBy = comparison ? primary || secondary : secondary;

  const chartType: SimpleChartType = SIMPLE_CHART_TYPES.some((option) => option.value === state.showAs)
    ? (state.showAs as SimpleChartType)
    : "bar";

  return {
    groupBy: groupBy || "",
    splitBy: splitBy && splitBy !== groupBy ? splitBy : "",
    chartType,
    withTarget: state.compareWith === "target" || state.targetLine,
  };
}

/**
 * A reusable chart pattern. `preset` seeds the simple selection; the gallery
 * shows `label`/`description`/`icon`. Templates only encode *shape* — the user
 * still chooses indicators, period, and scope, so one template produces many
 * concrete charts.
 */
export type ChartTemplate = {
  id: string;
  label: string;
  description: string;
  icon: LucideIcon;
  preset: SimpleSelection;
  /**
   * Disaggregation keys this template relies on (besides comparison dims). Used
   * by the gallery to grey out templates the chosen indicator can't satisfy.
   */
  requiresDimensions?: string[];
};

export const BLANK_TEMPLATE_ID = "blank";

export const CHART_TEMPLATES: ChartTemplate[] = [
  {
    id: "achieved-vs-target",
    label: "Achieved vs Target",
    description: "Compare what each organisation achieved against its target.",
    icon: Target,
    preset: { groupBy: "organization", splitBy: "", chartType: "bar", withTarget: true },
  },
  {
    id: "male-vs-female",
    label: "Male vs Female",
    description: "Break a value down by sex, side by side.",
    icon: Users,
    preset: { groupBy: "sex", splitBy: "", chartType: "bar", withTarget: false },
    requiresDimensions: ["sex"],
  },
  {
    id: "age-band",
    label: "Age band distribution",
    description: "Show the spread across age groups.",
    icon: BarChart3,
    preset: { groupBy: "age_band", splitBy: "sex", chartType: "bar", withTarget: false },
    requiresDimensions: ["age_band"],
  },
  {
    id: "service-cascade",
    label: "Service cascade",
    description: "Screened → eligible → referred → initiated, split by sex.",
    icon: ListTree,
    preset: { groupBy: "", splitBy: "sex", chartType: "bar", withTarget: false },
  },
  {
    id: "trend-over-time",
    label: "Trend over time",
    description: "Track a value across reporting periods.",
    icon: LineChart,
    preset: { groupBy: "period", splitBy: "", chartType: "line", withTarget: false },
  },
  {
    id: "organisation-comparison",
    label: "Organisation comparison",
    description: "Rank organisations against each other.",
    icon: BarChart3,
    preset: { groupBy: "organization", splitBy: "", chartType: "bar", withTarget: false },
  },
  {
    id: "single-number",
    label: "Single number",
    description: "A headline total as a KPI card.",
    icon: Gauge,
    preset: { groupBy: "", splitBy: "", chartType: "kpi", withTarget: false },
  },
  {
    id: BLANK_TEMPLATE_ID,
    label: "Blank / custom",
    description: "Start from scratch and choose everything yourself.",
    icon: BarChart3,
    preset: { ...DEFAULT_SIMPLE_SELECTION },
  },
];

export function getChartTemplate(id: string): ChartTemplate | undefined {
  return CHART_TEMPLATES.find((template) => template.id === id);
}

/** Apply a template's preset onto a base state. */
export function applyTemplate(base: CustomAnalysisState, template: ChartTemplate): CustomAnalysisState {
  return applySimpleSelection(base, template.preset);
}
