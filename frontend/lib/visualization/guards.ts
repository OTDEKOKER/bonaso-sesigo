import type { VisualizationChart as LegacyVisualizationChart } from "./engine.ts";

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

export function assertCompatibleChartShape(
  value: unknown,
): asserts value is LegacyVisualizationChart {
  if (!isLegacyVisualizationChart(value)) {
    throw new Error("Unsupported visualization chart shape.");
  }
}
