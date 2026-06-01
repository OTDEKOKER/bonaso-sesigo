import { memo, useMemo } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatPercent, formatWholeNumber, toSafeNumber } from "@/components/dashboard/engine/normalize-indicators";
import { renderCenteredWrappedTick } from "@/components/dashboard/widgets/shared-chart-utils";
import {
  buildNormalizedComparisonMatrix,
  type MessageAnalyticsOrganization,
  type MessageAnalyticsRow,
  type MessageAnalyticsViewMode,
} from "@/components/dashboard/message-analytics/message-analytics-utils";

function MessageShareTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ dataKey?: string; payload?: Record<string, unknown>; value?: number }>;
}) {
  if (!active || !payload?.length) return null;

  const row = payload[0]?.payload || {};
  const counts = (row.__counts as Record<string, number> | undefined) || {};
  const shares = (row.__shares as Record<string, number> | undefined) || {};

  return (
    <div className="w-full min-w-0 max-w-[320px] rounded-2xl border border-border bg-card px-3 py-2.5 shadow-lg">
      <div className="text-sm font-semibold text-foreground">{String(row.messageType || "Message Type")}</div>
      <div className="mt-2 space-y-1.5">
        {payload.map((item) => {
          const organization = String(item.dataKey || "Organization");
          const count = toSafeNumber(counts[organization]);
          const share = toSafeNumber(shares[organization]);
          const color = String((item.payload?.[`__color_${organization}`] as string) || "#64748B");

          return (
            <div key={`${organization}-tooltip`} className="flex items-center justify-between gap-4 text-xs">
              <div className="flex items-center gap-2 text-foreground">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: color }} />
                <span>{organization}</span>
              </div>
              <span className="text-right font-medium text-foreground">
                {formatWholeNumber(count)} ({formatPercent(share)}%)
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MessageShareStackedChartComponent({
  matrix,
  organizations,
  viewMode,
}: {
  matrix: MessageAnalyticsRow[];
  organizations: MessageAnalyticsOrganization[];
  viewMode: MessageAnalyticsViewMode;
}) {
  const chartRows = useMemo(() => {
    const sourceMatrix = viewMode === "normalized" ? buildNormalizedComparisonMatrix(matrix) : matrix;

    return sourceMatrix.map((row, index) => {
      const absoluteRow = matrix[index] || row;
      const rowTotal = organizations.reduce(
        (sum, organization) => sum + toSafeNumber(row.valuesByOrganization?.[organization.label]),
        0,
      );
      const shares: Record<string, number> = {};
      const counts: Record<string, number> = {};
      const nextRow: Record<string, number | string> = { messageType: row.messageType };

      organizations.forEach((organization) => {
        const share = rowTotal > 0 ? (toSafeNumber(row.valuesByOrganization?.[organization.label]) / rowTotal) * 100 : 0;
        shares[organization.label] = share;
        counts[organization.label] = toSafeNumber(absoluteRow.valuesByOrganization?.[organization.label]);
        nextRow[organization.label] = share;
        nextRow[`__color_${organization.label}`] = organization.color;
      });

      nextRow.__counts = counts as unknown as number;
      nextRow.__shares = shares as unknown as number;

      return nextRow;
    });
  }, [matrix, organizations, viewMode]);

  return (
    <div className="min-w-0 w-full max-w-full overflow-hidden rounded-2xl border border-border bg-card p-3">
      <div className="mb-2 text-sm font-medium text-foreground">Message Type Share by Organization (100% Stacked)</div>
      <div className="h-[320px] w-full min-w-0 overflow-hidden">
        <ResponsiveContainer width="100%" height="100%" debounce={180}>
          <BarChart data={chartRows} margin={{ top: 10, right: 24, left: 18, bottom: 64 }} barCategoryGap="22%">
            <CartesianGrid vertical={false} stroke="hsl(var(--border) / 0.42)" />
            <XAxis
              axisLine={false}
              dataKey="messageType"
              height={82}
              padding={{ left: 18, right: 18 }}
              tick={renderCenteredWrappedTick}
              tickLine={false}
            />
            <YAxis
              axisLine={false}
              domain={[0, 100]}
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
              tickFormatter={(value: number) => `${formatPercent(value)}%`}
              tickLine={false}
              ticks={[0, 25, 50, 75, 100]}
              width={64}
            />
            <Tooltip content={<MessageShareTooltip />} isAnimationActive={false} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {organizations.map((organization) => (
              <Bar
                key={`share-${organization.key}`}
                dataKey={organization.label}
                fill={organization.color}
                isAnimationActive={false}
                maxBarSize={48}
                name={organization.label}
                stackId="message-share"
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export const MessageShareStackedChart = memo(MessageShareStackedChartComponent);
MessageShareStackedChart.displayName = "MessageShareStackedChart";
