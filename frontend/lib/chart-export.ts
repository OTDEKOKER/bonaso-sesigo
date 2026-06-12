/**
 * Native Excel chart export. Posts a chart spec to the backend
 * (POST /api/analysis/chart-export/) which renders a real, editable Excel chart
 * whose series colours come from the shared palette (lib/chart-theme.ts) — so
 * the downloaded chart matches the on-screen chart, colours included.
 */
import { fetchWithAuth, normalizeApiError } from "@/lib/api/client";
import { exportColor } from "@/lib/chart-theme";

export type ChartExportSeries = {
  name: string;
  /** Optional explicit hex; falls back to the palette by series index. */
  color?: string | null;
  values: Array<number | string | null>;
};

export type ChartExportType =
  | "bar"
  | "column"
  | "line"
  | "stacked-bar"
  | "stacked-column"
  | "pie";

export type ChartExportSpec = {
  title: string;
  subtitle?: string;
  chartType: ChartExportType;
  categories: string[];
  series: ChartExportSeries[];
  /** Shown as a "Filters applied" block in the workbook (project/period/...). */
  sourceFilters?: Record<string, string | number | null | undefined>;
  valueAxisTitle?: string;
  categoryAxisTitle?: string;
  /** Download filename without extension; defaults to a slug of the title. */
  fileName?: string;
};

function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 60) || "chart"
  );
}

/**
 * Build the wire payload, resolving every series colour from the shared palette
 * so colours are stable regardless of how the chart sourced them on screen.
 */
export function buildChartExportPayload(spec: ChartExportSpec) {
  return {
    title: spec.title,
    subtitle: spec.subtitle ?? "",
    chart_type: spec.chartType,
    categories: spec.categories,
    series: spec.series.map((s, i) => ({
      name: s.name,
      color: exportColor(i, s.color),
      values: s.values,
    })),
    source_filters: Object.fromEntries(
      Object.entries(spec.sourceFilters ?? {}).filter(
        ([, v]) => v !== null && v !== undefined && v !== "",
      ),
    ),
    value_axis_title: spec.valueAxisTitle ?? "",
    category_axis_title: spec.categoryAxisTitle ?? "",
  };
}

/** Export a chart to a native Excel workbook and trigger the browser download. */
export async function exportChartToExcel(spec: ChartExportSpec): Promise<void> {
  const payload = buildChartExportPayload(spec);
  const response = await fetchWithAuth("/analysis/chart-export/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const contentType = response.headers.get("content-type");
    const body = contentType?.includes("application/json")
      ? await response.json()
      : await response.text();
    throw normalizeApiError({
      status: response.status,
      payload: body,
      fallbackMessage: "Failed to export chart to Excel",
    });
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${spec.fileName ? slugify(spec.fileName) : slugify(spec.title)}.xlsx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
