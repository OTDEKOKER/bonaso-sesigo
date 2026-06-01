import { formatPercent, formatWholeNumber } from "@/components/dashboard/engine/normalize-indicators";
import type { MessageAnalyticsInsights } from "@/components/dashboard/message-analytics/message-analytics-utils";

export function MessageInsightPanel({ insights }: { insights: MessageAnalyticsInsights }) {
  const zeroTypes = insights.messageTypesWithAnyZero;

  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <h3 className="text-sm font-semibold text-foreground">Automatic Insights</h3>
      <div className="mt-3 space-y-2 text-sm text-muted-foreground">
        <p>
          Top organization contributed{" "}
          <span className="font-medium text-foreground">
            {insights.topOrganization ? `${formatPercent(insights.topOrganization.percentage)}%` : "0%"}
          </span>{" "}
          of all reached people
          {insights.topOrganization ? ` (${insights.topOrganization.label}: ${formatWholeNumber(insights.topOrganization.value)})` : ""}.
        </p>
        <p>
          Top message type was{" "}
          <span className="font-medium text-foreground">{insights.topMessageType?.label || "-"}</span>
          {insights.topMessageType ? ` (${formatWholeNumber(insights.topMessageType.value)})` : ""}.
        </p>
        <p>
          Lowest reporting organization was{" "}
          <span className="font-medium text-foreground">{insights.lowestOrganization?.label || "-"}</span>
          {insights.lowestOrganization ? ` (${formatWholeNumber(insights.lowestOrganization.value)})` : ""}.
        </p>
        <p>
          Message types with zero values in at least one organization:{" "}
          <span className="font-medium text-foreground">
            {zeroTypes.length > 0 ? zeroTypes.join(", ") : "None"}
          </span>
          .
        </p>
      </div>
    </div>
  );
}
