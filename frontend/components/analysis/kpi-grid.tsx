"use client";

import { AnalyticsEmptyState, ChartInsightFooter } from "@/components/analysis/chart-theme";
import { Card, CardContent } from "@/components/ui/card";
import type { VisualizationKpi } from "@/lib/visualization/engine";

type KPIGridProps = {
  items: VisualizationKpi[];
  insightText?: string | null;
};

export function KPIGrid(props: KPIGridProps) {
  const { items, insightText } = props;

  if (items.length === 0) {
    return (
      <AnalyticsEmptyState
        title="No KPI summary available"
        message="No headline metrics can be generated for the current dashboard scope."
        compact
      />
    );
  }

  return (
    <section className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {items.map((item) => (
          <Card key={item.key} className="overflow-hidden rounded-2xl border border-border/60 bg-card shadow-sm">
            <CardContent className="space-y-3 px-5 py-5">
              <div className="flex items-center justify-between gap-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                  {item.title}
                </div>
                <span className="h-2.5 w-2.5 rounded-full bg-primary/70" />
              </div>
              <div className="text-3xl font-semibold tracking-[-0.03em] text-foreground">{item.value}</div>
              <div className="text-sm leading-6 text-muted-foreground">{item.helper}</div>
            </CardContent>
          </Card>
        ))}
      </div>
      {insightText ? <ChartInsightFooter>{insightText}</ChartInsightFooter> : null}
    </section>
  );
}
