import { memo, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { DashboardPanel } from "@/components/dashboard/components/dashboard-panel";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MessageShareStackedChart } from "@/components/dashboard/message-analytics/message-share-stacked-chart";
import { MessageTypeRankingChart } from "@/components/dashboard/message-analytics/message-type-ranking-chart";
import { MessageAnalyticsTable } from "@/components/dashboard/message-analytics/message-analytics-table";
import {
  buildMessageAnalyticsOrganizations,
  buildMessageTypeOrgMatrix,
  buildNormalizedComparisonMatrix,
  buildPercentageMatrix,
  buildRankedMessageTypeTotals,
  sanitizeMessageAnalyticsSeries,
  type MessageAnalyticsViewMode,
} from "@/components/dashboard/message-analytics/message-analytics-utils";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeOrganizationLabel(value: unknown) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ");
}
const MAKGABANENG_NORMALIZED = normalizeOrganizationLabel("MAKGABANENG");

function MessageAnalyticsDashboardComponent({
  hasError,
  isLoading,
  onEditData,
  rows,
  series,
}: {
  hasError: boolean;
  isLoading: boolean;
  onEditData?: () => void;
  rows: Array<Record<string, unknown>>;
  series: Array<Record<string, unknown>>;
}) {
  const [viewMode, setViewMode] = useState<MessageAnalyticsViewMode>("absolute");

  const safeRows = useMemo(
    () =>
      Array.isArray(rows)
        ? rows
            .filter(isRecord)
            .filter(
              (row) =>
                normalizeOrganizationLabel(row.cso) !== MAKGABANENG_NORMALIZED,
            )
        : [],
    [rows],
  );
  const safeSeries = useMemo(
    () => sanitizeMessageAnalyticsSeries(Array.isArray(series) ? series.filter(isRecord) : []),
    [series],
  );

  const organizations = useMemo(() => buildMessageAnalyticsOrganizations(safeRows), [safeRows]);
  const matrix = useMemo(() => buildMessageTypeOrgMatrix(safeRows, safeSeries), [safeRows, safeSeries]);

  const hasData = organizations.length > 0 && matrix.length > 0;

  const percentageMatrix = useMemo(() => buildPercentageMatrix(matrix), [matrix]);
  const normalizedMatrix = useMemo(() => buildNormalizedComparisonMatrix(matrix), [matrix]);

  const displayMatrix = useMemo(
    () =>
      viewMode === "absolute"
        ? matrix
        : viewMode === "percentage"
          ? percentageMatrix
          : normalizedMatrix,
    [matrix, normalizedMatrix, percentageMatrix, viewMode],
  );

  const rankedMessageTypes = useMemo(
    () => buildRankedMessageTypeTotals(matrix, viewMode),
    [matrix, viewMode],
  );

  return (
    <DashboardPanel
      actions={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <div className="w-[210px]">
            <Select
              value={viewMode}
              onValueChange={(value) =>
                setViewMode(
                  value === "percentage" || value === "normalized" ? value : "absolute",
                )
              }
            >
              <SelectTrigger aria-label="Message analytics view">
                <SelectValue placeholder="Select view" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="absolute">Absolute Counts</SelectItem>
                <SelectItem value="percentage">Percentage Share</SelectItem>
                <SelectItem value="normalized">Normalized Comparison</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {onEditData ? (
            <Button
              type="button"
              variant="outline"
              className="border-border bg-background text-foreground hover:bg-muted"
              onClick={onEditData}
            >
              Edit Data
            </Button>
          ) : null}
        </div>
      }
      eyebrow="HIV Prevention Messages"
      title="HIV Prevention Messages"
      subtitle="Power-view of message performance across organizations and message types"
    >
      {isLoading ? (
        <div className="rounded-[1.1rem] border border-dashed border-border bg-card px-4 py-10 text-sm text-muted-foreground">
          Loading message analytics.
        </div>
      ) : hasError ? (
        <div className="rounded-[1.1rem] border border-dashed border-border bg-card px-4 py-10 text-sm text-muted-foreground">
          Message analytics are temporarily unavailable.
        </div>
      ) : !hasData ? (
        <div className="rounded-[1.1rem] border border-dashed border-border bg-card px-4 py-10 text-sm text-muted-foreground">
          Message analytics will appear once message-type data is available.
        </div>
      ) : (
        <div className="min-w-0 w-full max-w-full space-y-4 overflow-x-hidden">
          <MessageShareStackedChart matrix={matrix} organizations={organizations} viewMode={viewMode} />

          <div className="grid gap-4">
            <MessageTypeRankingChart items={rankedMessageTypes} viewMode={viewMode} />
          </div>

          <MessageAnalyticsTable
            absoluteMatrix={matrix}
            displayMatrix={displayMatrix}
            organizations={organizations}
            viewMode={viewMode}
          />
        </div>
      )}
    </DashboardPanel>
  );
}

export const MessageAnalyticsDashboard = memo(MessageAnalyticsDashboardComponent);
MessageAnalyticsDashboard.displayName = "MessageAnalyticsDashboard";
