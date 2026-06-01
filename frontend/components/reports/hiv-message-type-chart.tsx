"use client";

import { useMemo } from "react";

import type { AggregatePeriodMode } from "@/lib/aggregates/quarter-buckets";
import type { Aggregate } from "@/lib/types";

import { buildMessageTypeRows, type MessageTypeConfig } from "@/components/reports/message-type-report-utils";
import { ReportBarChart } from "@/components/reports/report-bar-chart";

const HIV_MESSAGE_TYPES: MessageTypeConfig[] = [
  {
    label: "HIV Testing Messages",
    color: "#1f6a8a",
    aliases: ["hiv testing messages"],
  },
  {
    label: "PEP Messages",
    color: "#e67e22",
    aliases: ["pep messages"],
  },
  {
    label: "PREP Messages",
    color: "#2e8b57",
    aliases: ["prep messages"],
  },
  {
    label: "Condom Use Messages",
    color: "#1f9ac7",
    aliases: ["condom use messages"],
  },
  {
    label: "HIV Treatment Messages",
    color: "#9c2f92",
    aliases: ["hiv treatment messages"],
  },
  {
    label: "ARV Based Prevention Messages",
    color: "#48a535",
    aliases: ["arv based prevention messages"],
  },
  {
    label: "EMTCT Messages",
    color: "#0f4258",
    aliases: ["emtct messages"],
  },
  {
    label: "GBV Messages",
    color: "#b55a18",
    aliases: ["gbv messages"],
  },
];

const isHivIndicator = (indicatorName: string) => {
  const normalized = String(indicatorName || "").toLowerCase();
  return normalized.includes("hiv") || normalized.includes("gbv") || normalized.includes("condom");
};

export function HivMessageTypeChart(props: {
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
        config: HIV_MESSAGE_TYPES,
        indicatorFilter: isHivIndicator,
      }),
    [aggregates, periodMode, rangeLabel, selectedPeriodLabels],
  );

  return (
    <ReportBarChart
      title="Number of People Reached with HIV Prevention Messages by Message Type"
      yAxisLabel={yAxisLabel}
      periodLabels={selectedPeriodLabels}
      rows={rows}
      chartId={chartId}
      chartType={chartType}
      showLegend={showLegend}
    />
  );
}
