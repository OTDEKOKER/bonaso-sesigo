import type { CustomAnalysisShowAs, CustomAnalysisState } from "@/components/analysis/custom-analysis-builder";

/**
 * Guided "visualization mode" model for the Data Visualizer. Each mode is a
 * preset over the existing CustomAnalysisState: it recommends a chart, sets the
 * comparison/period defaults, declares which inputs are required, and carries
 * helper text explaining the recommendation. The engine pipeline is unchanged —
 * modes only steer the same query contract.
 */
export type VizMode = "target" | "trend" | "organisation" | "disaggregate" | "quality";

export type ModeRequirements = {
  indicator?: boolean;
  period?: boolean;
  org?: boolean;
  breakdown?: boolean;
  time?: boolean;
};

export type VisualizerModeConfig = {
  value: VizMode;
  label: string;
  description: string;
  /** Recommended chart, shown as the default and in helper text. */
  recommendedChart: CustomAnalysisShowAs;
  recommendedChartLabel: string;
  helper: string;
  requires: ModeRequirements;
  /** Chart views the user may switch to within this mode (first = recommended). */
  chartOptions: Array<{ value: CustomAnalysisShowAs; label: string }>;
  /** Fields applied to the state when this mode is selected. */
  apply: Partial<Pick<CustomAnalysisState, "showAs" | "compareBy">>;
};

export const VISUALIZER_MODES: VisualizerModeConfig[] = [
  {
    value: "target",
    label: "Performance against target",
    description: "Actual vs target, with achievement %",
    recommendedChart: "bar",
    recommendedChartLabel: "Grouped bar",
    helper:
      "A grouped bar chart compares actual values against their targets, with achievement %. Best for one indicator across a period and organisation scope.",
    requires: { indicator: true, period: true, org: true },
    chartOptions: [{ value: "bar", label: "Grouped bar (actual vs target)" }],
    apply: { showAs: "bar", compareBy: "none" },
  },
  {
    value: "trend",
    label: "Trend over time",
    description: "How values change by quarter or month",
    recommendedChart: "line",
    recommendedChartLabel: "Line chart",
    helper:
      "A line chart shows how the indicator changes across quarters or months. Pick a time period mode and the periods to include.",
    requires: { indicator: true, time: true },
    chartOptions: [
      { value: "line", label: "Line chart" },
      { value: "area", label: "Area chart" },
    ],
    apply: { showAs: "line", compareBy: "period" },
  },
  {
    value: "organisation",
    label: "Organisation comparison",
    description: "Rank organisations for one indicator",
    recommendedChart: "bar",
    recommendedChartLabel: "Bar chart",
    helper:
      "A bar chart compares organisations for a single indicator and period. The chart orients itself horizontally when there are many organisations.",
    requires: { indicator: true, period: true },
    chartOptions: [{ value: "bar", label: "Bar chart" }],
    apply: { showAs: "bar", compareBy: "organization" },
  },
  {
    value: "disaggregate",
    label: "Disaggregate breakdown",
    description: "Break down by sex, age, key population, etc.",
    recommendedChart: "matrix",
    recommendedChartLabel: "Matrix table",
    helper:
      "A matrix table breaks values down by your chosen dimension for detailed review. Switch to a stacked bar for a visual comparison.",
    requires: { indicator: true, breakdown: true },
    chartOptions: [
      { value: "matrix", label: "Matrix table" },
      { value: "stacked-bar", label: "Stacked bar" },
    ],
    apply: { showAs: "matrix", compareBy: "none" },
  },
  {
    value: "quality",
    label: "Data quality / completeness",
    description: "Which organisations reported vs are missing",
    recommendedChart: "table",
    recommendedChartLabel: "Completeness table",
    helper:
      "Shows which organisations in scope have reported and which are missing, so you can chase incomplete reporting.",
    requires: { indicator: true, org: true },
    chartOptions: [
      { value: "table", label: "Completeness table" },
      { value: "bar", label: "Reported-value bar" },
    ],
    apply: { showAs: "table", compareBy: "organization" },
  },
];

export function getModeConfig(mode: VizMode): VisualizerModeConfig {
  return VISUALIZER_MODES.find((entry) => entry.value === mode) ?? VISUALIZER_MODES[0];
}

/** Apply a mode's recommended defaults onto the current builder state. */
export function applyMode(mode: VizMode, state: CustomAnalysisState): CustomAnalysisState {
  const config = getModeConfig(mode);
  const next: CustomAnalysisState = { ...state, ...config.apply };
  // Trend needs a time dimension; never leave it on a single date range.
  if (mode === "trend" && next.periodMode === "date-range") {
    next.periodMode = "quarter";
    next.selectedPeriods = [];
  }
  // Keep showAs within the mode's allowed chart options.
  if (!config.chartOptions.some((option) => option.value === next.showAs)) {
    next.showAs = config.recommendedChart;
  }
  return next;
}

const hasPeriod = (state: CustomAnalysisState) =>
  state.selectedPeriods.length > 0 || (state.periodMode === "date-range" && Boolean(state.dateFrom && state.dateTo));

/**
 * Returns the list of unmet requirements for the selected mode. An empty array
 * means the configuration is valid and the preview can render.
 */
export function getModeValidation(input: {
  mode: VizMode;
  state: CustomAnalysisState;
  dimensions: string[];
  scopedOrgCount: number;
}): string[] {
  const { mode, state, dimensions, scopedOrgCount } = input;
  const { requires } = getModeConfig(mode);
  const issues: string[] = [];

  if (requires.indicator && state.indicatorIds.length === 0) {
    issues.push("Select at least one indicator.");
  }
  if (requires.period && !hasPeriod(state)) {
    issues.push("Choose a period or quarter (or a date range).");
  }
  if (requires.time && state.periodMode !== "quarter" && state.periodMode !== "month") {
    issues.push("Trend needs a quarter or month time dimension.");
  }
  if (requires.org && scopedOrgCount === 0) {
    issues.push("Choose an organisation scope that has data.");
  }
  if (requires.breakdown && dimensions.length === 0) {
    issues.push("Choose a breakdown dimension (e.g. sex, age group).");
  }
  return issues;
}
