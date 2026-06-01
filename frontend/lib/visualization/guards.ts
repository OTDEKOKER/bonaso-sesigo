import type { VisualizationChart as LegacyVisualizationChart } from "./engine.ts";
import type { VisualizationResult as VisualizationResultV2 } from "./engine-v2.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isLegacyVisualizationChart(
  value: unknown,
): value is LegacyVisualizationChart {
  if (!isRecord(value) || typeof value.kind !== "string") return false;

  if (value.kind === "heatmap") {
    return (
      Array.isArray(value.xLabels) &&
      Array.isArray(value.yLabels) &&
      Array.isArray(value.cells)
    );
  }

  if (value.kind === "funnel" || value.kind === "cascade") {
    return Array.isArray(value.steps);
  }

  return (
    typeof value.xKey === "string" &&
    Array.isArray(value.data) &&
    Array.isArray(value.series)
  );
}

export function isV2VisualizationResult(
  value: unknown,
): value is VisualizationResultV2 {
  if (!isRecord(value)) return false;
  return (
    Array.isArray(value.summary) &&
    typeof value.recommendedChart === "string" &&
    Array.isArray(value.availableViews) &&
    Array.isArray(value.facts)
  );
}

export function assertCompatibleChartShape(
  value: unknown,
): asserts value is LegacyVisualizationChart {
  if (!isLegacyVisualizationChart(value)) {
    throw new Error("Unsupported visualization chart shape.");
  }
}
