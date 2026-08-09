"use client";

/**
 * Official SESIGO visualisation engine — Apache ECharts.
 *
 * A single, tree-shaken React wrapper around echarts/core. Every SESIGO chart
 * (and the topography map) renders through this component so colours, typography
 * and behaviour are consistent system-wide. The brand theme is registered once
 * from the SESIGO palette SSoT (`lib/chart-theme`), which is kept byte-identical
 * to the backend Excel export — so a series is the same colour on screen, in the
 * funder report, and in an exported workbook.
 */

import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import {
  BarChart,
  LineChart,
  PieChart,
  GaugeChart,
  MapChart,
  ScatterChart,
  CustomChart,
} from "echarts/charts";
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
  MarkLineComponent,
  MarkAreaComponent,
  VisualMapComponent,
  GraphicComponent,
  TitleComponent,
  GeoComponent,
} from "echarts/components";
import { LabelLayout, UniversalTransition } from "echarts/features";
import { CanvasRenderer } from "echarts/renderers";
import type { EChartsCoreOption, EChartsType } from "echarts/core";

import { SESIGO_CHART_PALETTE } from "@/lib/chart-theme";

echarts.use([
  BarChart,
  LineChart,
  PieChart,
  GaugeChart,
  MapChart,
  ScatterChart,
  CustomChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
  MarkLineComponent,
  MarkAreaComponent,
  VisualMapComponent,
  GraphicComponent,
  TitleComponent,
  GeoComponent,
  LabelLayout,
  UniversalTransition,
  CanvasRenderer,
]);

export const SESIGO_ECHARTS_THEME = "sesigo";

let themeRegistered = false;
function ensureTheme() {
  if (themeRegistered) return;
  echarts.registerTheme(SESIGO_ECHARTS_THEME, {
    color: [...SESIGO_CHART_PALETTE],
    textStyle: { color: "#334155" },
    title: {
      textStyle: { color: "#0f172a", fontWeight: 600 },
      subtextStyle: { color: "#64748b" },
    },
    legend: { textStyle: { color: "#475569" } },
    tooltip: {
      backgroundColor: "#ffffff",
      borderColor: "#dbe5ec",
      borderWidth: 1,
      textStyle: { color: "#0f172a" },
      extraCssText: "box-shadow:0 14px 32px rgba(15,23,42,0.12);border-radius:12px;",
    },
    categoryAxis: {
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: "#64748b" },
      splitLine: { show: false },
    },
    valueAxis: {
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: "#64748b" },
      splitLine: { lineStyle: { color: "#edf2f7" } },
    },
  });
  themeRegistered = true;
}

// echarts event params are loosely typed; each caller narrows what it needs.
export type EChartEventHandlers = Record<string, (params: any) => void>;

/**
 * Register a GeoJSON map under a name so `series.map` / `geo.map` can use it.
 * Idempotent per name — safe to call on every render of a map component.
 */
export function registerSesigoMap(name: string, geoJson: unknown) {
  if (echarts.getMap(name)) return;
  echarts.registerMap(name, geoJson as any);
}

export function EChart({
  option,
  className,
  onEvents,
  ariaLabel,
  onInit,
  preserveGeoRoam,
}: {
  option: EChartsCoreOption;
  className?: string;
  onEvents?: EChartEventHandlers;
  ariaLabel?: string;
  /**
   * Optional: receive the underlying ECharts instance once, right after init.
   * Used by callers that need `getDataURL()` (image export) or to drive the
   * chart imperatively (e.g. roam sync). Backward compatible — omit to ignore.
   */
  onInit?: (chart: EChartsType) => void;
  /**
   * Optional (maps only): apply option updates with `replaceMerge: ['series']`
   * instead of `notMerge: true`, so a re-render (new filter, legend toggle,
   * cluster recompute) replaces the series but PRESERVES the geo pan/zoom the
   * user has set. Default (omitted) keeps the standard notMerge behaviour that
   * every other SESIGO chart relies on to clear removed series/axes.
   */
  preserveGeoRoam?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<EChartsType | null>(null);
  // Keep the latest handlers in a ref so we bind echarts events once but always
  // dispatch to the current callbacks (which may close over changing props).
  // Sync in an effect (never mutate a ref during render).
  const eventsRef = useRef<EChartEventHandlers | undefined>(onEvents);
  useEffect(() => {
    eventsRef.current = onEvents;
  }, [onEvents]);
  // Same pattern for onInit so the once-only init effect stays dependency-free.
  const onInitRef = useRef(onInit);
  useEffect(() => {
    onInitRef.current = onInit;
  }, [onInit]);

  // Init once; resize with the container; dispose on unmount.
  useEffect(() => {
    ensureTheme();
    const el = containerRef.current;
    if (!el) return;
    const chart = echarts.init(el, SESIGO_ECHARTS_THEME, { renderer: "canvas" });
    chartRef.current = chart;
    onInitRef.current?.(chart);

    const eventNames = Object.keys(eventsRef.current ?? {});
    const bound = eventNames.map((evt) => {
      const fn = (params: any) => eventsRef.current?.[evt]?.(params);
      chart.on(evt, fn);
      return [evt, fn] as const;
    });

    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(el);

    return () => {
      observer.disconnect();
      bound.forEach(([evt, fn]) => chart.off(evt, fn));
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  // Re-apply options whenever they change. Default notMerge so removed
  // series/axes clear; maps opt into replaceMerge to keep the user's geo roam.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    if (preserveGeoRoam) {
      chart.setOption(option, { notMerge: false, replaceMerge: ["series"] });
    } else {
      chart.setOption(option, { notMerge: true });
    }
  }, [option, preserveGeoRoam]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ width: "100%", height: "100%" }}
      role="img"
      aria-label={ariaLabel}
    />
  );
}
