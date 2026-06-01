import { Activity, Building2, MessagesSquare, Users } from "lucide-react";
import { formatPercent, formatWholeNumber } from "@/components/dashboard/engine/normalize-indicators";
import type { MessageAnalyticsSummary } from "@/components/dashboard/message-analytics/message-analytics-utils";

export function MessageKpiCards({ summary }: { summary: MessageAnalyticsSummary }) {
  const cards = [
    {
      id: "total-reached",
      icon: Users,
      label: "Total People Reached",
      value: formatWholeNumber(summary.totalReached),
      note: "across all message types",
    },
    {
      id: "top-organization",
      icon: Building2,
      label: "Top Organization",
      value: summary.topOrganization.name || "-",
      note: `${formatWholeNumber(summary.topOrganization.value)} (${formatPercent(summary.topOrganization.percentage)}%)`,
    },
    {
      id: "top-message-type",
      icon: MessagesSquare,
      label: "Top Message Type",
      value: summary.topMessageType.name || "-",
      note: `${formatWholeNumber(summary.topMessageType.value)} (${formatPercent(summary.topMessageType.percentage)}%)`,
    },
    {
      id: "reporting-organizations",
      icon: Building2,
      label: "Reporting Organizations",
      value: formatWholeNumber(summary.reportingOrganizations),
      note: "with non-zero message totals",
    },
    {
      id: "average-per-organization",
      icon: Activity,
      label: "Average Reach per Organization",
      value: formatWholeNumber(summary.averagePerOrganization),
      note: "mean people reached",
    },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      {cards.map((card) => (
        <div key={card.id} className="rounded-2xl border border-border bg-card p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {card.label}
              </p>
              <p className="mt-2 text-xl font-semibold text-foreground">{card.value}</p>
              <p className="mt-1 text-xs text-muted-foreground">{card.note}</p>
            </div>
            <div className="rounded-xl border border-border bg-background p-2 text-muted-foreground">
              <card.icon className="h-4 w-4" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
