"use client";

import { useMemo, useState } from "react";

import { AnalyticsEmptyState, ChartInsightFooter } from "@/components/analysis/chart-theme";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { RawAggregateRecord } from "@/lib/analytics/query-builder";

type RawRecordsTableProps = {
  title: string;
  records: RawAggregateRecord[];
  pageSize?: number;
};

const numberFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

function formatValue(value: number) {
  return numberFormatter.format(Number.isFinite(value) ? value : 0);
}

export function RawRecordsTable(props: RawRecordsTableProps) {
  const { title, records, pageSize = 20 } = props;
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const filteredRecords = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return records;
    return records.filter((record) => {
      return (
        record.organization.toLowerCase().includes(query) ||
        record.indicator.toLowerCase().includes(query) ||
        record.period.toLowerCase().includes(query) ||
        record.disaggregationLabels.toLowerCase().includes(query) ||
        record.notes.toLowerCase().includes(query)
      );
    });
  }, [records, search]);

  const totalPages = Math.max(1, Math.ceil(filteredRecords.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const startIndex = (safePage - 1) * pageSize;
  const paginatedRecords = filteredRecords.slice(startIndex, startIndex + pageSize);

  return (
    <Card className="overflow-hidden rounded-2xl border border-border/60 bg-card shadow-sm">
      <CardHeader className="gap-3 border-b border-border/50 bg-[linear-gradient(180deg,rgba(255,255,255,1)_0%,rgba(248,250,252,0.88)_100%)] px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="text-base font-semibold tracking-[-0.02em] text-foreground">{title}</CardTitle>
            <CardDescription className="text-sm text-muted-foreground">
              Searchable source rows behind the current dashboard visualizations.
            </CardDescription>
          </div>
          <div className="rounded-full border border-border/60 bg-muted/30 px-3 py-1 text-xs font-medium text-muted-foreground">
            {filteredRecords.length} record{filteredRecords.length === 1 ? "" : "s"}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <Input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder="Search organization, indicator, period, disaggregate..."
            className="max-w-md"
          />
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((previous) => Math.max(1, previous - 1))}
              disabled={safePage <= 1}
            >
              Previous
            </Button>
            <span className="text-xs text-muted-foreground">
              Page {safePage} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((previous) => Math.min(totalPages, previous + 1))}
              disabled={safePage >= totalPages}
            >
              Next
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 px-5 py-4">
        {filteredRecords.length === 0 ? (
          <AnalyticsEmptyState
            title="No matching records"
            message="Adjust the search term or broaden the current dashboard filters to inspect raw rows."
            compact
          />
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-border/60 bg-background">
            <table className="w-full min-w-[980px] border-collapse text-[13px] text-slate-600">
              <thead>
                <tr className="bg-muted/35">
                  <th className="border-b border-border/60 px-4 py-3 text-left font-semibold text-foreground">Organization</th>
                  <th className="border-b border-border/60 px-4 py-3 text-left font-semibold text-foreground">Indicator</th>
                  <th className="border-b border-border/60 px-4 py-3 text-left font-semibold text-foreground">Period</th>
                  <th className="border-b border-border/60 px-4 py-3 text-left font-semibold text-foreground">Disaggregation labels</th>
                  <th className="border-b border-border/60 px-4 py-3 text-right font-semibold text-foreground">Value</th>
                  <th className="border-b border-border/60 px-4 py-3 text-left font-semibold text-foreground">Notes</th>
                </tr>
              </thead>
              <tbody>
                {paginatedRecords.map((record, index) => (
                  <tr key={record.rowKey} className={index % 2 === 0 ? "bg-background" : "bg-muted/10"}>
                    <td className="border-b border-border/50 px-4 py-3">{record.organization}</td>
                    <td className="border-b border-border/50 px-4 py-3">{record.indicator}</td>
                    <td className="border-b border-border/50 px-4 py-3">{record.period}</td>
                    <td className="border-b border-border/50 px-4 py-3">{record.disaggregationLabels || "-"}</td>
                    <td className="border-b border-border/50 px-4 py-3 text-right tabular-nums text-foreground">
                      {formatValue(record.submittedValue)}
                    </td>
                    <td className="border-b border-border/50 px-4 py-3">{record.notes || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <ChartInsightFooter>
          Raw records remain available for audit review and reconciliation against the visual summaries.
        </ChartInsightFooter>
      </CardContent>
    </Card>
  );
}
