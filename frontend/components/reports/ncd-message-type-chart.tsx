"use client";

import { useMemo } from "react";

import type { AggregatePeriodMode } from "@/lib/aggregates/quarter-buckets";
import type { Aggregate } from "@/lib/types";

import { buildMessageTypeRows, type MessageTypeConfig } from "@/components/reports/message-type-report-utils";
import { ReportBarChart } from "@/components/reports/report-bar-chart";

const NCD_MESSAGE_TYPES: MessageTypeConfig[] = [
  {
    label: "Alcohol Reduction Messages",
    color: "#1f6a8a",
    aliases: ["alcohol reduction messages", "alcohol abuse messages"],
  },
  {
    label: "Blood Glucose Messages",
    color: "#e67e22",
    aliases: ["blood glucose messages"],
  },
  {
    label: "Blood Pressure Messages",
    color: "#2e8b57",
    aliases: ["blood pressure messages", "bp messages"],
  },
  {
    label: "Healthy Diet Messages",
    color: "#1f9ac7",
    aliases: ["healthy diet messages"],
  },
  {
    label: "Physical Activity Messages",
    color: "#9c2f92",
    aliases: ["physical activity messages"],
  },
  {
    label: "Psychoeducation",
    color: "#48a535",
    aliases: ["psychoeducation"],
  },
  {
    label: "Tobacco Control Messages",
    color: "#0f4258",
    aliases: ["tobacco control messages", "tobacco control mssages", "tobacco cessation messages"],
  },
  {
    label: "Waist Circumference Messages",
    color: "#b55a18",
    aliases: ["waist circumference messages"],
  },
  {
    label: "Weight Management Messages",
    color: "#0b4d18",
    aliases: ["weight management messages"],
  },
];

const isNcdIndicator = (indicatorName: string) => {
  const normalized = String(indicatorName || "").toLowerCase();
  return normalized.includes("ncd") || normalized.includes("non communicable");
};

export function NcdMessageTypeChart(props: {
  aggregates: Aggregate[];
  periodMode: "dates" | AggregatePeriodMode;
  selectedPeriodLabels: string[];
  rangeLabel?: string;
  chartId: string;
  yAxisLabel?: string;
  chartType?: "clustered-bar" | "grouped-bar";
  showLegend?: boolean;
}) {
  const {
    aggregates,
    periodMode,
    selectedPeriodLabels,
    rangeLabel,
    chartId,
    yAxisLabel = "No. of People",
    chartType = "clustered-bar",
    showLegend = true,
  } = props;

  const rows = useMemo(
    () =>
      buildMessageTypeRows({
        aggregates,
        periodMode,
        selectedPeriodLabels,
        rangeLabel,
        config: NCD_MESSAGE_TYPES,
        indicatorFilter: isNcdIndicator,
      }),
    [aggregates, periodMode, rangeLabel, selectedPeriodLabels],
  );

  return (
    <ReportBarChart
      title="Number of People Reached with NCD Prevention Messages by Message Type"
      yAxisLabel={yAxisLabel}
      periodLabels={selectedPeriodLabels}
      rows={rows}
      chartId={chartId}
      chartType={chartType}
      showLegend={showLegend}
    />
  );
}
