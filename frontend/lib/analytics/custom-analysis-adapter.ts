import type { CustomAnalysisShowAs, CustomAnalysisState } from "@/components/analysis/custom-analysis-builder";
import type { AnalyticsComparisonMode, AnalyticsQueryContract } from "@/lib/analytics/query-builder";
import type { VisualizationKind } from "@/lib/visualization/engine";

/**
 * Maps the shared `CustomAnalysisState` builder model onto the inputs the
 * existing analytics pipeline already understands (`buildAnalyticsFacts` +
 * `buildVisualizationResult`). This is the reverse of the `buildDraft()`
 * (filters -> state) helper in `dashboard-analytics-surface.tsx`, so the
 * standalone Data Visualizer produces identical numbers to the dashboard
 * surface for the same selection.
 */

/** Disaggregation/category dimensions chosen in the builder, "none" stripped. */
export function getCustomAnalysisDimensions(state: CustomAnalysisState): string[] {
  return [state.breakDownBy, state.secondaryBreakdown]
    .map((value) => (value || "").trim())
    .filter((value) => value && value !== "none");
}

/**
 * The engine renders a fixed set of chart kinds. Chart types that the engine
 * does not produce directly (kpi/table/matrix/donut/area/progress) are handled
 * by the Visualizer surface separately and resolve to "auto" here.
 */
export function customAnalysisChartMode(showAs: CustomAnalysisShowAs): VisualizationKind | "auto" {
  switch (showAs) {
    case "bar":
      return "bar";
    case "stacked-bar":
      return "stacked-bar";
    case "line":
    case "area":
      return "trend";
    case "heatmap":
      return "heatmap";
    default:
      // kpi, donut, table, matrix, progress — surface handles these.
      return "auto";
  }
}

/** Build the analytics query contract consumed by `buildAnalyticsFacts`. */
export function customAnalysisStateToQuery(state: CustomAnalysisState): AnalyticsQueryContract {
  return {
    project_id: state.projectId && state.projectId !== "all" ? state.projectId : null,
    indicator_ids: state.indicatorIds,
    scope_mode: state.scopeMode,
    parent_org_id: state.parentOrgId || null,
    selected_org_ids: state.selectedOrgIds,
    period_mode: state.periodMode,
    selected_periods: state.selectedPeriods,
    date_from: state.dateFrom || null,
    date_to: state.dateTo || null,
    comparison_mode: state.compareBy as AnalyticsComparisonMode,
    disaggregation_keys: getCustomAnalysisDimensions(state),
    cascade_organization: state.scopeMode === "parent_org",
  };
}

/**
 * Payload for persisting the current Visualizer selection as a dashboard chart,
 * matching the "custom analysis" save path in
 * `dashboard-chart-settings-dialog.tsx` (template_mode + custom_analysis).
 */
export function customAnalysisToDashboardChartPayload(
  state: CustomAnalysisState,
  name: string,
): Record<string, unknown> {
  return {
    name: name.trim() || state.title?.trim() || "Custom analysis",
    template_mode: "custom",
    custom_analysis: state,
  };
}
