"use client";

import { Pencil, Trash2 } from "lucide-react";

import type { CoordinatorTarget } from "@/lib/api";
import type { CoordinatorPerformanceRow, CoordinatorPerformanceStatus } from "@/components/targets/coordinator-targets-types";
import { getFiscalQuarterLabel } from "@/components/targets/coordinator-targets-utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

type CoordinatorTargetsTableProps = {
  rows: CoordinatorPerformanceRow[];
  loading?: boolean;
  error?: string | null;
  canEdit: boolean;
  onEdit: (target: CoordinatorTarget) => void;
  onDelete: (target: CoordinatorTarget) => void;
};

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return value.toLocaleString();
}

function formatPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "-";
  return `${value.toFixed(1)}%`;
}

function getStatusLabel(status: CoordinatorPerformanceStatus): string {
  if (status === "on_track") return "On Track";
  if (status === "no_target") return "No Target";
  return status === "met" ? "Met" : "Behind";
}

function getStatusClassName(status: CoordinatorPerformanceStatus): string {
  if (status === "met") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700";
  if (status === "on_track") return "border-amber-500/30 bg-amber-500/10 text-amber-700";
  if (status === "behind") return "border-rose-500/30 bg-rose-500/10 text-rose-700";
  return "border-border bg-muted/30 text-muted-foreground";
}

export function CoordinatorTargetsTable(props: CoordinatorTargetsTableProps) {
  const { rows, loading = false, error = null, canEdit, onEdit, onDelete } = props;

  if (loading) {
    return <div className="rounded-xl border border-border/70 p-6 text-sm text-muted-foreground">Loading coordinator targets...</div>;
  }

  if (error) {
    return <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-sm text-destructive">{error}</div>;
  }

  if (rows.length === 0) {
    return <div className="rounded-xl border border-border/70 p-6 text-sm text-muted-foreground">No coordinator targets found for the selected filters.</div>;
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border/70 bg-background">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-[7rem]">Period</TableHead>
            <TableHead className="min-w-[12rem]">Coordinator</TableHead>
            <TableHead className="min-w-[14rem]">Indicator</TableHead>
            <TableHead className="text-right">Target</TableHead>
            <TableHead className="text-right">Actual</TableHead>
            <TableHead className="text-right">Achievement</TableHead>
            <TableHead className="text-right">Variance</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="min-w-[14rem]">Child Contribution</TableHead>
            {canEdit ? <TableHead className="w-[7rem] text-right">Actions</TableHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const topContributions = row.childContributions.slice(0, 3);

            return (
              <TableRow key={row.target.id}>
                <TableCell>{getFiscalQuarterLabel(row.target.year, row.target.quarter)}</TableCell>
                <TableCell className="max-w-[18rem] truncate">{row.coordinatorName}</TableCell>
                <TableCell className="max-w-[20rem] truncate">{row.indicatorName}</TableCell>
                <TableCell className="text-right tabular-nums">{formatNumber(Number(row.target.target_value || 0))}</TableCell>
                <TableCell className="text-right tabular-nums">
                  <div>{formatNumber(row.actualValue)}</div>
                  <div className="text-xs text-muted-foreground">own {formatNumber(row.ownActualValue)}</div>
                </TableCell>
                <TableCell className="text-right tabular-nums">{formatPercent(row.achievementPercent)}</TableCell>
                <TableCell
                  className={cn(
                    "text-right tabular-nums",
                    row.variance < 0 ? "text-destructive" : row.variance > 0 ? "text-emerald-700" : "",
                  )}
                >
                  {row.variance > 0 ? "+" : ""}
                  {formatNumber(row.variance)}
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className={cn("font-normal", getStatusClassName(row.status))}>
                    {getStatusLabel(row.status)}
                  </Badge>
                </TableCell>
                <TableCell className="max-w-[20rem] whitespace-normal text-sm">
                  {topContributions.length === 0 ? (
                    <span className="text-muted-foreground">No child-reported values</span>
                  ) : (
                    topContributions.map((entry, index) => (
                      <div key={`${row.target.id}-${entry.organization_id}`}>
                        {entry.organization_name}: {formatNumber(entry.actual_value)} ({entry.share_percent.toFixed(1)}%)
                        {index === topContributions.length - 1 && row.childContributions.length > 3
                          ? ` +${row.childContributions.length - 3} more`
                          : ""}
                      </div>
                    ))
                  )}
                </TableCell>
                {canEdit ? (
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" onClick={() => onEdit(row.target)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => onDelete(row.target)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                ) : null}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
