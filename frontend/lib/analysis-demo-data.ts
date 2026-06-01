import type {
  DashboardSetting,
  LineList,
  PivotTable,
  Report,
} from "@/lib/api";

export const demoAnalysisNotice =
  "Demo analysis data has been disabled for this deployment.";

export function isDemoAnalysisId(
  id: number | null | undefined,
): boolean {
  void id;
  return false;
}

export function buildDemoIndicatorTrendsBulk(
  indicatorIds: number[],
  indicatorDetails?: Array<{ id: number; name?: string; code?: string; type?: string }>,
): {
  series: Array<{
    indicator_id: number;
    indicator_name: string;
    data: Array<{ month: string; value: number; target: number }>;
  }>;
} {
  void indicatorIds;
  void indicatorDetails;
  return { series: [] };
}

export const demoDashboards: DashboardSetting[] = [];

export const demoReports: Report[] = [];

export const demoPivotTables: PivotTable[] = [];

export const demoLineLists: LineList[] = [];

const escapeCsv = (value: unknown) => {
  const text = value === null || value === undefined ? "" : String(value);
  if (/[\",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
};

export function recordsToCsvBlob(rows: Array<Record<string, unknown>>): Blob {
  if (!rows.length) return new Blob([""], { type: "text/csv;charset=utf-8" });
  const headers = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  const lines = [
    headers.map((header) => escapeCsv(header)).join(","),
    ...rows.map((row) => headers.map((header) => escapeCsv(row[header])).join(",")),
  ];
  return new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
}

export function matrixToCsvBlob(rows: Array<Array<string | number | null>>): Blob {
  const lines = rows.map((row) => row.map((value) => escapeCsv(value)).join(","));
  return new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
}
