"use client";

import { Activity, BarChart3, CheckCircle2, Percent, Target, TrendingUp, Users } from "lucide-react";

import { AnalyticsEmptyState, ChartInsightFooter } from "@/components/analysis/chart-theme";
import { KpiStatCard, type KpiStat } from "@/components/analysis/dashboard-primitives";
import type { VisualizationKpi } from "@/lib/visualization/engine";

type KPIGridProps = {
  items: VisualizationKpi[];
  insightText?: string | null;
};

const ACCENTS = ["#0f766e", "#2563eb", "#7c3aed", "#ea580c", "#0891b2", "#65a30d"];

/** Pick a sensible icon + accent from the KPI title (best-effort, cosmetic). */
function decorate(title: string, index: number): { icon: KpiStat["icon"]; accent: string } {
  const t = title.toLowerCase();
  const accent = ACCENTS[index % ACCENTS.length];
  if (t.includes("target") || t.includes("achiev")) return { icon: Target, accent: "#7c3aed" };
  if (t.includes("percent") || t.includes("%") || t.includes("rate")) return { icon: Percent, accent };
  if (t.includes("people") || t.includes("respond") || t.includes("client") || t.includes("reached"))
    return { icon: Users, accent };
  if (t.includes("complete") || t.includes("approved") || t.includes("quality"))
    return { icon: CheckCircle2, accent: "#15803d" };
  if (t.includes("trend") || t.includes("growth")) return { icon: TrendingUp, accent };
  if (t.includes("total")) return { icon: BarChart3, accent };
  return { icon: Activity, accent };
}

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

  const stats: KpiStat[] = items.map((item, index) => {
    const { icon, accent } = decorate(item.title, index);
    return {
      key: item.key,
      label: item.title,
      value: item.value,
      helper: item.helper,
      icon,
      accent,
    };
  });

  return (
    <section className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => (
          <KpiStatCard key={stat.key} stat={stat} />
        ))}
      </div>
      {insightText ? <ChartInsightFooter>{insightText}</ChartInsightFooter> : null}
    </section>
  );
}
