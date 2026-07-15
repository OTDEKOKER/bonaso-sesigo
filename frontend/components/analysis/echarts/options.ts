/**
 * Shared ECharts option builders for SESIGO charts. Small, composable helpers
 * that return an `EChartsCoreOption` — used by intelligence cards now and by the
 * migrated chart renderers as recharts is retired. Colours/typography come from
 * the registered `sesigo` theme; these builders only shape data + layout.
 */
import type { EChartsCoreOption } from "echarts/core";

import { SESIGO_SEMANTIC_COLORS } from "@/lib/chart-theme";
import { formatChartNumber } from "@/components/analysis/chart-theme";
import type { PaceStatus, TrendPoint, WhereSlice } from "@/lib/intelligence/types";

export const PACE_COLOR: Record<PaceStatus, string> = {
  ahead: SESIGO_SEMANTIC_COLORS.overTarget,
  on_track: SESIGO_SEMANTIC_COLORS.achieved,
  behind: SESIGO_SEMANTIC_COLORS.late,
  at_risk: SESIGO_SEMANTIC_COLORS.missing,
  pending: "#94a3b8",
};

/** "What happened" — compact actual-vs-target trend line. */
export function trendLineOption(trend: TrendPoint[]): EChartsCoreOption {
  const periods = trend.map((t) => t.period);
  const hasTarget = trend.some((t) => t.target != null);
  return {
    grid: { top: 16, right: 12, bottom: 22, left: 8, containLabel: true },
    tooltip: {
      trigger: "axis",
      valueFormatter: (v: number) => formatChartNumber(v),
    },
    legend: hasTarget
      ? { show: true, top: 0, right: 0, icon: "circle", itemWidth: 9, itemHeight: 9, textStyle: { fontSize: 11 } }
      : { show: false },
    xAxis: {
      type: "category",
      data: periods,
      boundaryGap: false,
      axisLabel: { fontSize: 11 },
    },
    yAxis: {
      type: "value",
      axisLabel: { fontSize: 11, formatter: (v: number) => formatChartNumber(v) },
    },
    series: [
      {
        name: "Actual",
        type: "line",
        smooth: true,
        showSymbol: trend.length <= 8,
        symbolSize: 6,
        lineStyle: { width: 3 },
        areaStyle: { opacity: 0.08 },
        data: trend.map((t) => t.actual),
      },
      ...(hasTarget
        ? [
            {
              name: "Target",
              type: "line" as const,
              smooth: false,
              showSymbol: false,
              lineStyle: { width: 1.5, type: "dashed" as const, color: SESIGO_SEMANTIC_COLORS.target },
              itemStyle: { color: SESIGO_SEMANTIC_COLORS.target },
              data: trend.map((t) => t.target ?? null),
            },
          ]
        : []),
    ],
  };
}

/** "Where" — horizontal bar of the sub-org / district breakdown. */
export function whereBarOption(where: WhereSlice[]): EChartsCoreOption {
  // echarts category axis renders bottom→top; reverse so the largest is on top.
  const sorted = [...where].sort((a, b) => a.value - b.value);
  return {
    grid: { top: 6, right: 40, bottom: 6, left: 6, containLabel: true },
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (v: number) => formatChartNumber(v) },
    xAxis: { type: "value", show: false },
    yAxis: {
      type: "category",
      data: sorted.map((w) => w.name),
      axisLabel: { fontSize: 11, width: 120, overflow: "truncate" },
    },
    series: [
      {
        type: "bar",
        barMaxWidth: 16,
        itemStyle: { borderRadius: [0, 4, 4, 0] },
        label: {
          show: true,
          position: "right",
          fontSize: 11,
          fontWeight: 600,
          formatter: (p: { value: number }) => formatChartNumber(p.value),
        },
        data: sorted.map((w) => w.value),
      },
    ],
  };
}

/** "Why it matters" — pace gauge: achievement vs expected pace, coloured by status. */
export function paceGaugeOption(pctOfTarget: number, status: PaceStatus): EChartsCoreOption {
  const capped = Math.max(0, Math.min(100, Math.round(pctOfTarget)));
  return {
    series: [
      {
        type: "gauge",
        startAngle: 210,
        endAngle: -30,
        min: 0,
        max: 100,
        radius: "100%",
        center: ["50%", "58%"],
        progress: { show: true, width: 10, itemStyle: { color: PACE_COLOR[status] } },
        axisLine: { lineStyle: { width: 10, color: [[1, "#edf2f7"]] } },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { show: false },
        pointer: { show: false },
        anchor: { show: false },
        title: { show: false },
        detail: {
          valueAnimation: true,
          offsetCenter: [0, 0],
          fontSize: 20,
          fontWeight: 700,
          color: PACE_COLOR[status],
          formatter: (v: number) => `${Math.round(v)}%`,
        },
        data: [{ value: capped }],
      },
    ],
  };
}
