import type { WidgetMetricCollection } from "@/components/dashboard/engine/types";
import { getPerformanceStatusFromValues } from "@/components/dashboard/engine/performance-status";
import { toSafeNumber } from "@/components/dashboard/engine/normalize-indicators";

const CSV_HEADERS = ["Indicator", "Target", "Achieved", "Achievement %", "Status"] as const;

/** RFC-4180 field escaping: quote when the value contains a comma, quote, or newline. */
function escapeCsvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * Serialize dashboard indicator metrics to CSV (indicator / target / achieved /
 * achievement % / RAG status). Pure — safe to unit-test in node.
 */
export function metricsToCsv(metrics: WidgetMetricCollection): string {
  const lines: string[] = [CSV_HEADERS.join(",")];
  for (const metric of metrics) {
    const target = toSafeNumber(metric.target);
    const value = toSafeNumber(metric.value);
    const status = getPerformanceStatusFromValues(value, target);
    const percentage = target > 0 ? ((value / target) * 100).toFixed(1) : "";
    lines.push(
      [
        escapeCsvField(String(metric.label ?? "")),
        String(target),
        String(value),
        percentage,
        status.label,
      ].join(","),
    );
  }
  return lines.join("\r\n");
}

/** Trigger a client-side CSV download. No-op outside the browser. */
export function downloadMetricsCsv(
  metrics: WidgetMetricCollection,
  filename = "dashboard-performance.csv",
): void {
  if (typeof document === "undefined") return;
  // Prepend a BOM so Excel opens UTF-8 correctly.
  const blob = new Blob([`﻿${metricsToCsv(metrics)}`], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
