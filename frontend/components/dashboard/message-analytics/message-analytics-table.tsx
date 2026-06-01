import { memo, useMemo } from "react";
import { cn } from "@/lib/utils";
import { formatPercent, formatWholeNumber, toSafeNumber } from "@/components/dashboard/engine/normalize-indicators";
import {
  type MessageAnalyticsOrganization,
  type MessageAnalyticsRow,
  type MessageAnalyticsViewMode,
} from "@/components/dashboard/message-analytics/message-analytics-utils";

function getCellFormatter(viewMode: MessageAnalyticsViewMode) {
  if (viewMode === "absolute") {
    return (value: number) => formatWholeNumber(value);
  }
  return (value: number) => `${formatPercent(value)}%`;
}

function MessageAnalyticsTableComponent({
  absoluteMatrix,
  displayMatrix,
  organizations,
  viewMode,
}: {
  absoluteMatrix: MessageAnalyticsRow[];
  displayMatrix: MessageAnalyticsRow[];
  organizations: MessageAnalyticsOrganization[];
  viewMode: MessageAnalyticsViewMode;
}) {
  const formatter = getCellFormatter(viewMode);

  const rowTotals = useMemo(
    () =>
      absoluteMatrix.map((row) =>
        organizations.reduce(
          (sum, organization) => sum + toSafeNumber(row.valuesByOrganization?.[organization.label]),
          0,
        ),
      ),
    [absoluteMatrix, organizations],
  );

  const grandTotal = useMemo(
    () => rowTotals.reduce((sum, value) => sum + toSafeNumber(value), 0),
    [rowTotals],
  );

  const columnTotals = useMemo(() => {
    return organizations.map((organization) =>
      absoluteMatrix.reduce(
        (sum, row) => sum + toSafeNumber(row.valuesByOrganization?.[organization.label]),
        0,
      ),
    );
  }, [absoluteMatrix, organizations]);

  return (
    <div className="w-full max-w-full overflow-x-auto rounded-2xl border border-border bg-card">
      <table className="w-full min-w-[720px] table-fixed border-collapse text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            <th className="sticky left-0 z-20 w-[240px] bg-muted/40 px-3 py-2 text-left">Message Type</th>
            {organizations.map((organization) => (
              <th key={`header-${organization.key}`} className="px-3 py-2 text-center">
                {organization.label}
              </th>
            ))}
            <th className="w-[120px] px-3 py-2 text-right">Row Total</th>
            <th className="w-[120px] px-3 py-2 text-right">Row %</th>
          </tr>
        </thead>
        <tbody>
          {displayMatrix.map((row, rowIndex) => {
            const rowValues = organizations.map((organization) => toSafeNumber(row.valuesByOrganization?.[organization.label]));
            const rowMax = rowValues.length > 0 ? Math.max(...rowValues) : 0;
            const absoluteRowTotal = toSafeNumber(rowTotals[rowIndex]);
            const rowContribution = grandTotal > 0 ? (absoluteRowTotal / grandTotal) * 100 : 0;

            return (
              <tr key={`matrix-row-${row.messageType}`} className="border-b border-border last:border-b-0">
                <th className="sticky left-0 z-10 bg-card px-3 py-2.5 text-left font-medium text-foreground">
                  {row.messageType}
                </th>
                {organizations.map((organization, columnIndex) => {
                  const value = rowValues[columnIndex];
                  const isZero = value === 0;
                  const isRowMax = rowMax > 0 && value === rowMax;

                  return (
                    <td
                      key={`matrix-cell-${row.messageType}-${organization.key}`}
                      className={cn(
                        "px-3 py-2 text-center tabular-nums",
                        isZero ? "text-muted-foreground/70" : "text-foreground",
                        isRowMax ? "bg-emerald-50/60 dark:bg-emerald-950/25" : "",
                        isZero ? "bg-muted/25" : "",
                      )}
                    >
                      {formatter(value)}
                    </td>
                  );
                })}
                <td className="px-3 py-2 text-right tabular-nums text-foreground">
                  {formatWholeNumber(absoluteRowTotal)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                  {formatPercent(rowContribution)}%
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t border-border bg-muted/35 text-sm">
            <th className="sticky left-0 z-10 bg-muted/35 px-3 py-2 text-left font-semibold text-foreground">Column totals</th>
            {columnTotals.map((total, index) => (
              <td key={`column-total-${organizations[index]?.key || index}`} className="px-3 py-2 text-center tabular-nums font-medium text-foreground">
                {formatWholeNumber(total)}
              </td>
            ))}
            <td className="px-3 py-2 text-right tabular-nums font-semibold text-foreground">{formatWholeNumber(grandTotal)}</td>
            <td className="px-3 py-2 text-right tabular-nums font-semibold text-foreground">100%</td>
          </tr>
        </tfoot>
      </table>
      {viewMode !== "absolute" ? (
        <div className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
          Cell values reflect {viewMode === "percentage" ? "percentage share per message type row" : "normalized comparison by organization"}; totals remain absolute counts.
        </div>
      ) : null}
    </div>
  );
}

export const MessageAnalyticsTable = memo(MessageAnalyticsTableComponent);
MessageAnalyticsTable.displayName = "MessageAnalyticsTable";
