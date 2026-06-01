"use client";

import { useMemo } from "react";
import { Download, Loader2, RefreshCw } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Report } from "@/lib/api";

type ViewerRecord = Record<string, unknown>;

type ComparisonRow = {
  label: string;
  achieved: number;
  target: number;
  organizationName: string;
};

const achievedKeys = ["achieved", "total", "total_value", "value", "current_value"];
const targetKeys = ["target", "target_value"];
const labelKeys = ["indicator_name", "name", "indicator", "project_name", "section"];
const organizationKeys = ["organization_name", "organization", "scope"];

const statusBadge = (status: string) => {
  switch (status) {
    case "completed":
      return <Badge className="bg-success/20 text-success border-success/30">Completed</Badge>;
    case "failed":
      return <Badge className="bg-destructive/20 text-destructive border-destructive/30">Failed</Badge>;
    case "processing":
      return <Badge className="bg-warning/20 text-warning border-warning/30">Processing</Badge>;
    default:
      return <Badge variant="secondary">Pending</Badge>;
  }
};

const asRecordArray = (value: unknown): ViewerRecord[] => {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is ViewerRecord =>
      typeof entry === "object" && entry !== null && !Array.isArray(entry),
  );
};

const readString = (record: ViewerRecord, keys: string[]) => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) return value;
  }
  return "";
};

const readNumber = (record: ViewerRecord, keys: string[]) => {
  for (const key of keys) {
    const value = Number(record[key]);
    if (Number.isFinite(value)) return value;
  }
  return 0;
};

const formatCell = (value: unknown) => {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "number") return value.toLocaleString();
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

export function ReportViewerDialog({
  open,
  onOpenChange,
  report,
  organizations,
  onRefresh,
  onDownload,
  refreshing = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  report: Report | null;
  organizations?: Array<{ id: string | number; name: string }> | null;
  onRefresh?: () => Promise<void> | void;
  onDownload?: () => Promise<void> | void;
  refreshing?: boolean;
}) {
  const dataRows = useMemo(() => asRecordArray(report?.cached_data), [report?.cached_data]);
  const tableColumns = useMemo(() => {
    const columns = new Set<string>();
    dataRows.forEach((row) => {
      Object.keys(row).forEach((key) => {
        if (columns.size < 8) columns.add(key);
      });
    });
    return Array.from(columns);
  }, [dataRows]);
  const comparisonRows = useMemo<ComparisonRow[]>(() => {
    return dataRows
      .map((row, index) => ({
        label: readString(row, labelKeys) || `Row ${index + 1}`,
        achieved: readNumber(row, achievedKeys),
        target: readNumber(row, targetKeys),
        organizationName: readString(row, organizationKeys),
      }))
      .filter((row) => row.achieved > 0 || row.target > 0)
      .slice(0, 10);
  }, [dataRows]);
  const summary = useMemo(() => {
    return comparisonRows.reduce(
      (acc, row) => {
        acc.achieved += row.achieved;
        acc.target += row.target;
        return acc;
      },
      { achieved: 0, target: 0 },
    );
  }, [comparisonRows]);
  const organizationLabel = useMemo(() => {
    const organizationId = report?.parameters?.organization_id;
    if (organizationId === undefined || organizationId === null) return "All organizations";
    const matched = organizations?.find((organization) => String(organization.id) === String(organizationId));
    if (!matched) return "Selected organization";
    const cascade = report?.parameters?.cascade_organization === true;
    return cascade ? `${matched.name} + subs` : matched.name;
  }, [organizations, report?.parameters]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <DialogTitle>{report?.name || "Report preview"}</DialogTitle>
              <DialogDescription>
                Review generated report data, refresh cached output, or download the latest export.
              </DialogDescription>
            </div>
            {report ? statusBadge(report.status) : null}
          </div>
        </DialogHeader>

        {!report ? (
          <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
            Select a report to preview it here.
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                <span className="rounded-full border border-border bg-muted/40 px-3 py-1">
                  {organizationLabel}
                </span>
                <span className="rounded-full border border-border bg-muted/40 px-3 py-1">
                  {report.parameters?.format === "csv" ? "CSV" : report.parameters?.format === "pdf" ? "PDF" : "Excel"}
                </span>
                <span className="rounded-full border border-border bg-muted/40 px-3 py-1">
                  {report.created_at ? new Date(report.created_at).toLocaleString() : "Draft"}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {onRefresh ? (
                  <Button variant="outline" onClick={() => void onRefresh()} disabled={refreshing}>
                    {refreshing ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="mr-2 h-4 w-4" />
                    )}
                    Refresh
                  </Button>
                ) : null}
                {onDownload ? (
                  <Button onClick={() => void onDownload()}>
                    <Download className="mr-2 h-4 w-4" />
                    Download
                  </Button>
                ) : null}
              </div>
            </div>

            {comparisonRows.length > 0 ? (
              <>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-xl border border-border bg-muted/20 px-4 py-3">
                    <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Rows</p>
                    <p className="mt-2 text-2xl font-semibold">{dataRows.length}</p>
                  </div>
                  <div className="rounded-xl border border-border bg-muted/20 px-4 py-3">
                    <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Achieved</p>
                    <p className="mt-2 text-2xl font-semibold">{summary.achieved.toLocaleString()}</p>
                  </div>
                  <div className="rounded-xl border border-border bg-muted/20 px-4 py-3">
                    <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Target</p>
                    <p className="mt-2 text-2xl font-semibold">{summary.target.toLocaleString()}</p>
                  </div>
                </div>

                <div className="rounded-xl border border-border bg-card p-4">
                  <div className="mb-3">
                    <p className="text-sm font-semibold text-foreground">Achieved vs target</p>
                    <p className="text-xs text-muted-foreground">
                      Comparison extracted from the generated report rows.
                    </p>
                  </div>
                  <div className="h-[280px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={comparisonRows}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis
                          dataKey="label"
                          stroke="hsl(var(--muted-foreground))"
                          tick={{ fontSize: 11 }}
                          interval={0}
                          angle={-18}
                          textAnchor="end"
                          height={70}
                        />
                        <YAxis stroke="hsl(var(--muted-foreground))" />
                        <Tooltip
                          cursor={{ fill: "rgba(16, 24, 40, 0.06)" }}
                          contentStyle={{
                            backgroundColor: "hsl(var(--card))",
                            border: "1px solid hsl(var(--border))",
                            borderRadius: "12px",
                          }}
                          formatter={(value: number, name: string) => [Number(value).toLocaleString(), name]}
                        />
                        <Bar dataKey="achieved" name="Achieved" fill="hsl(var(--chart-2))" radius={[6, 6, 0, 0]} />
                        <Bar dataKey="target" name="Target" fill="hsl(var(--chart-4))" radius={[6, 6, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </>
            ) : null}

            {dataRows.length > 0 ? (
              <div className="overflow-hidden rounded-xl border border-border">
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-muted/40 text-left text-xs uppercase tracking-[0.16em] text-muted-foreground">
                      <tr>
                        {tableColumns.map((column) => (
                          <th key={column} className="px-4 py-3">
                            {column.replace(/_/g, " ")}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {dataRows.map((row, index) => (
                        <tr key={`${report.id}-${index}`} className="border-t border-border align-top">
                          {tableColumns.map((column) => (
                            <td key={column} className="px-4 py-3 whitespace-nowrap">
                              {formatCell(row[column])}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : report.status === "processing" ? (
              <div className="flex items-center justify-center gap-2 rounded-xl border border-border bg-muted/20 px-4 py-10 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Generating report data&hellip;
              </div>
            ) : report.cached_data !== null && report.cached_data !== undefined && !Array.isArray(report.cached_data) ? (
              <pre className="overflow-x-auto rounded-xl border border-border bg-muted/20 p-4 text-xs text-foreground">
                {JSON.stringify(report.cached_data, null, 2)}
              </pre>
            ) : (
              <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
                <p className="font-medium">No data found for this report.</p>
                <p className="mt-1 text-xs">
                  {report.status === "completed"
                    ? "The report ran but returned no rows. Check that the selected organization and indicators have approved aggregates, then click Refresh."
                    : "Click Refresh to generate the latest data."}
                </p>
                {onRefresh && (
                  <button
                    onClick={() => void onRefresh()}
                    className="mt-3 text-xs text-primary underline hover:no-underline"
                  >
                    Refresh now
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default ReportViewerDialog;
