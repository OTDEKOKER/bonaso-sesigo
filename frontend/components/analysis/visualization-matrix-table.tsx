"use client";

import { useMemo, useState } from "react";
import * as XLSX from "xlsx-js-style";
import { Download, LayoutGrid } from "lucide-react";

import { triggerBlobDownload } from "@/components/analysis/analytics-utils";
import { AnalyticsEmptyState, ChartInsightFooter } from "@/components/analysis/chart-theme";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { ConsolidatedMatrixData } from "@/lib/analytics/query-builder";
import { cn } from "@/lib/utils";

type VisualizationMatrixTableProps = {
  title: string;
  description: string;
  matrix: ConsolidatedMatrixData | null;
  exportBaseName?: string;
  insightText?: string | null;
};

type DensityMode = "normal" | "compact";

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(
    Number.isFinite(value) ? value : 0,
  );
}

function sanitizeSpreadsheetValue(value: unknown) {
  const text = String(value ?? "");
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

function exportMatrixCsv(matrix: ConsolidatedMatrixData, filename: string) {
  const header = [matrix.rowDimensionKey, ...matrix.columnLabels, "Row total"];
  const rows = matrix.rowLabels.map((rowLabel, rowIndex) => [
    sanitizeSpreadsheetValue(rowLabel),
    ...matrix.columnLabels.map((_, columnIndex) =>
      sanitizeSpreadsheetValue(matrix.cells[rowIndex]?.[columnIndex] ?? ""),
    ),
    sanitizeSpreadsheetValue(matrix.rowTotals[rowIndex] ?? ""),
  ]);
  const footer = [
    sanitizeSpreadsheetValue("Column total"),
    ...matrix.columnTotals.map((value) => sanitizeSpreadsheetValue(value)),
    sanitizeSpreadsheetValue(matrix.grandTotal),
  ];

  const csv = [header, ...rows, footer]
    .map((row) =>
      row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(","),
    )
    .join("\n");

  triggerBlobDownload(new Blob([csv], { type: "text/csv;charset=utf-8" }), `${filename}.csv`);
}

function exportMatrixExcel(matrix: ConsolidatedMatrixData, filename: string) {
  const workbook = XLSX.utils.book_new();

  const rows = [
    [matrix.rowDimensionKey, ...matrix.columnLabels, "Row total"],
    ...matrix.rowLabels.map((rowLabel, rowIndex) => [
      sanitizeSpreadsheetValue(rowLabel),
      ...matrix.columnLabels.map((_, columnIndex) =>
        sanitizeSpreadsheetValue(matrix.cells[rowIndex]?.[columnIndex] ?? ""),
      ),
      sanitizeSpreadsheetValue(matrix.rowTotals[rowIndex] ?? ""),
    ]),
    [
      sanitizeSpreadsheetValue("Column total"),
      ...matrix.columnTotals.map((value) => sanitizeSpreadsheetValue(value)),
      sanitizeSpreadsheetValue(matrix.grandTotal),
    ],
  ];

  const worksheet = XLSX.utils.aoa_to_sheet(rows);

  worksheet["!cols"] = Array.from({ length: rows[0]?.length || 1 }, (_, index) => ({
    wch: index === 0 ? 26 : 14,
  }));

  XLSX.utils.book_append_sheet(workbook, worksheet, "Matrix");

  const output = XLSX.write(workbook, { type: "array", bookType: "xlsx" });

  triggerBlobDownload(
    new Blob([output], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    `${filename}.xlsx`,
  );
}

function getCellState(value: number | undefined) {
  if (value === undefined || value === null) return { label: "—", kind: "empty" as const };
  if (!Number.isFinite(value)) return { label: "N/A", kind: "na" as const };
  if (value === 0) return { label: "0", kind: "zero" as const };
  return { label: formatNumber(value), kind: "value" as const };
}

function getValueTone(value: number | undefined, maxCellValue: number) {
  if (value === undefined || value === null) return "text-muted-foreground";
  if (!Number.isFinite(value)) return "text-muted-foreground italic";
  if (value === 0) return "text-slate-400";
  if (maxCellValue <= 0) return "text-foreground";

  const ratio = value / maxCellValue;
  if (ratio >= 0.8) return "bg-emerald-50/80 text-emerald-900";
  if (ratio >= 0.45) return "bg-teal-50/70 text-slate-900";
  if (ratio <= 0.15) return "bg-amber-50/70 text-amber-900";
  return "text-foreground";
}

export function VisualizationMatrixTable(props: VisualizationMatrixTableProps) {
  const { title, description, matrix, exportBaseName = "analytics_matrix", insightText } = props;
  const [density, setDensity] = useState<DensityMode>("normal");

  const maxCellValue = useMemo(() => {
    if (!matrix) return 0;

    let max = 0;

    for (const row of matrix.cells) {
      for (const value of row) {
        if (Number.isFinite(value) && Number(value) > max) {
          max = Number(value);
        }
      }
    }

    return max;
  }, [matrix]);

  if (!matrix || matrix.rowLabels.length === 0 || matrix.columnLabels.length === 0) {
    return (
      <Card className="overflow-hidden rounded-2xl border border-border/60 bg-card shadow-sm">
        <CardHeader className="gap-1.5 border-b border-border/50 bg-[linear-gradient(180deg,rgba(255,255,255,1)_0%,rgba(248,250,252,0.88)_100%)]">
          <CardTitle className="text-base font-semibold tracking-[-0.02em] text-foreground">
            {title}
          </CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="px-5 py-4">
          <AnalyticsEmptyState
            title="No matrix data available"
            message="No matrix data is available for the current filter state."
            compact
          />
        </CardContent>
      </Card>
    );
  }

  const cellPadding = density === "compact" ? "px-3 py-2.5" : "px-4 py-3.5";
  const firstColumnWidth = density === "compact" ? "min-w-[14rem]" : "min-w-[16rem]";

  return (
    <Card className="overflow-hidden rounded-2xl border border-border/60 bg-card shadow-sm">
      <CardHeader className="gap-3 border-b border-border/50 bg-[linear-gradient(180deg,rgba(255,255,255,1)_0%,rgba(248,250,252,0.88)_100%)]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="text-base font-semibold tracking-[-0.02em] text-foreground">
              {title}
            </CardTitle>
            <CardDescription className="max-w-3xl text-sm text-muted-foreground">
              {description}
            </CardDescription>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-xl border border-border/60 bg-background p-1 shadow-sm">
              <Button
                variant={density === "compact" ? "secondary" : "ghost"}
                size="sm"
                className="h-8 px-3"
                onClick={() => setDensity("compact")}
              >
                <LayoutGrid className="mr-2 h-4 w-4" />
                Compact
              </Button>
              <Button
                variant={density === "normal" ? "secondary" : "ghost"}
                size="sm"
                className="h-8 px-3"
                onClick={() => setDensity("normal")}
              >
                Normal
              </Button>
            </div>

            <Button variant="outline" size="sm" onClick={() => exportMatrixCsv(matrix, exportBaseName)}>
              <Download className="mr-2 h-4 w-4" />
              CSV
            </Button>

            <Button variant="outline" size="sm" onClick={() => exportMatrixExcel(matrix, exportBaseName)}>
              <Download className="mr-2 h-4 w-4" />
              Excel
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 px-5 py-4">
        <div className="overflow-auto rounded-2xl border border-border/60 bg-background scroll-smooth">
          <table className="min-w-[900px] border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th
                  className={cn(
                    "sticky left-0 top-0 z-30 border-b border-r border-border/60 bg-slate-100 px-4 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-600",
                    cellPadding,
                    firstColumnWidth,
                  )}
                >
                  {matrix.rowDimensionKey}
                </th>

                {matrix.columnLabels.map((columnLabel, columnIndex) => (
                  <th
                    key={`${columnLabel}-${columnIndex}`}
                    className={cn(
                      "sticky top-0 z-20 border-b border-r border-border/60 bg-slate-100 text-right text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-600",
                      cellPadding,
                    )}
                  >
                    {columnLabel}
                  </th>
                ))}

                <th
                  className={cn(
                    "sticky top-0 z-20 border-b border-border/60 bg-slate-100 text-right text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-600",
                    cellPadding,
                  )}
                >
                  Row total
                </th>
              </tr>
            </thead>

            <tbody>
              {matrix.rowLabels.map((rowLabel, rowIndex) => (
                <tr key={`${rowLabel}-${rowIndex}`} className="group">
                  <th
                    className={cn(
                      "sticky left-0 z-10 border-b border-r border-border/50 bg-background text-left font-medium text-foreground transition-colors group-hover:bg-slate-50",
                      cellPadding,
                      firstColumnWidth,
                    )}
                  >
                    {rowLabel}
                  </th>

                  {matrix.columnLabels.map((columnLabel, columnIndex) => {
                    const rawValue = matrix.cells[rowIndex]?.[columnIndex];
                    const cellState = getCellState(rawValue);

                    return (
                      <td
                        key={`${rowLabel}-${rowIndex}-${columnLabel}-${columnIndex}`}
                        className={cn(
                          "border-b border-r border-border/40 text-right tabular-nums transition-colors group-hover:bg-slate-50/70",
                          cellPadding,
                          getValueTone(rawValue, maxCellValue),
                        )}
                      >
                        {cellState.label}
                      </td>
                    );
                  })}

                  <td
                    className={cn(
                      "border-b border-border/50 bg-muted/15 text-right font-semibold tabular-nums text-foreground group-hover:bg-muted/25",
                      cellPadding,
                    )}
                  >
                    {formatNumber(
                      Number.isFinite(matrix.rowTotals[rowIndex])
                        ? Number(matrix.rowTotals[rowIndex])
                        : 0,
                    )}
                  </td>
                </tr>
              ))}
            </tbody>

            <tfoot>
              <tr>
                <th
                  className={cn(
                    "sticky bottom-0 left-0 z-20 border-r border-t border-border/60 bg-slate-100 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-700",
                    cellPadding,
                    firstColumnWidth,
                  )}
                >
                  Column total
                </th>

                {matrix.columnTotals.map((total, columnIndex) => (
                  <td
                    key={`column-total-${columnIndex}`}
                    className={cn(
                      "sticky bottom-0 z-10 border-r border-t border-border/60 bg-slate-100 text-right font-semibold tabular-nums text-slate-700",
                      cellPadding,
                    )}
                  >
                    {formatNumber(Number.isFinite(total) ? Number(total) : 0)}
                  </td>
                ))}

                <td
                  className={cn(
                    "sticky bottom-0 z-10 border-t border-border/60 bg-slate-200 text-right font-bold tabular-nums text-slate-900",
                    cellPadding,
                  )}
                >
                  {formatNumber(
                    Number.isFinite(matrix.grandTotal) ? Number(matrix.grandTotal) : 0,
                  )}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {insightText ? <ChartInsightFooter text={insightText} /> : null}
      </CardContent>
    </Card>
  );
}