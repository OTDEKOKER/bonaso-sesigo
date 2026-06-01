"use client";

import {
  type ChartDensity,
  formatChartNumber,
  formatChartNumberCompact,
} from "@/components/analysis/chart-theme";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { DrilldownTarget, HeatmapChart } from "@/lib/visualization/engine";

type HeatmapChartType = HeatmapChart;

function getHeatColor(value: number, maxValue: number) {
  if (maxValue <= 0 || value <= 0) return "#f8fafc";
  const ratio = Math.min(1, value / maxValue);
  const alpha = 0.12 + ratio * 0.58;
  return `rgba(15,118,110,${alpha})`;
}

export function RenderHeatmapChart(props: {
  chart: HeatmapChartType;
  onDrilldown?: (target: DrilldownTarget) => void;
  density?: ChartDensity;
  activeFilters?: Record<string, string[]>;
}) {
  const { chart, onDrilldown, density = "normal", activeFilters = {} } = props;
  const flattened = chart.cells.flat();
  const maxValue = Math.max(...flattened, 0);
  const gridGap = density === "compact" ? "gap-1.5" : "gap-2";
  const cellPadding = density === "compact" ? "px-2.5 py-2.5" : "px-3 py-3";
  const shellPadding = density === "compact" ? "p-2" : "p-2.5";
  const xFilterValues = activeFilters[chart.xDimension] || [];
  const yFilterValues = activeFilters[chart.yDimension] || [];
  const hasSelection = xFilterValues.length > 0 || yFilterValues.length > 0;

  return (
    <div className={density === "compact" ? "space-y-2.5" : "space-y-3"}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="border-[#dbe5ec] bg-[#f8fafc] text-[#475569]">
          {chart.yLabels.length} rows
        </Badge>
        <Badge variant="outline" className="border-[#dbe5ec] bg-[#f8fafc] text-[#475569]">
          {chart.xLabels.length} columns
        </Badge>
        <Badge variant="outline" className="border-[#dbe5ec] bg-[#f8fafc] text-[#475569]">
          Peak {formatChartNumberCompact(maxValue)}
        </Badge>
      </div>
      <div className={`overflow-auto rounded-[1.1rem] border border-[#dbe5ec] bg-[#fbfdff] ${shellPadding}`}>
        <div
          className={`grid min-w-[720px] ${gridGap}`}
          style={{ gridTemplateColumns: `180px repeat(${chart.xLabels.length}, minmax(96px, 1fr))` }}
        >
          <div className="sticky left-0 top-0 z-30 rounded-[1rem] border border-[#dbe5ec] bg-white px-4 py-2.5 text-sm font-semibold text-[#0f172a] shadow-sm">
            {chart.yDimension}
          </div>
          {chart.xLabels.map((label) => (
            <div
              key={label}
              className="sticky top-0 z-20 rounded-[1rem] border border-[#dbe5ec] bg-white px-3 py-2.5 text-center text-sm font-medium text-[#334155] shadow-sm"
            >
              {label}
            </div>
          ))}

          {chart.yLabels.map((rowLabel, rowIndex) => (
            <div key={rowLabel} className="contents">
              <div className="sticky left-0 z-10 rounded-[1rem] border border-[#dbe5ec] bg-white px-4 py-2.5 text-sm font-medium text-[#334155]">
                {rowLabel}
              </div>
              {chart.xLabels.map((columnLabel, columnIndex) => {
                const value = chart.cells[rowIndex]?.[columnIndex] || 0;
                const matchesX = xFilterValues.length === 0 || xFilterValues.includes(columnLabel);
                const matchesY = yFilterValues.length === 0 || yFilterValues.includes(rowLabel);
                const isSelected = matchesX && matchesY;

                return (
                  <button
                    key={`${rowLabel}-${columnLabel}`}
                    type="button"
                    className={cn(
                      `rounded-[1rem] border border-[#dbe5ec] ${cellPadding} text-center text-sm font-semibold text-[#0f172a] transition-all hover:-translate-y-px hover:shadow-sm`,
                      hasSelection && !isSelected && "opacity-30",
                      hasSelection && isSelected && "ring-2 ring-slate-900/15",
                      !onDrilldown && "cursor-default",
                    )}
                    style={{ backgroundColor: getHeatColor(value, maxValue) }}
                    onClick={() => {
                      if (!onDrilldown) return;
                      onDrilldown({
                        dimension: chart.yDimension,
                        value: rowLabel,
                        seriesDimension: chart.xDimension,
                        seriesValue: columnLabel,
                      });
                    }}
                  >
                    <div className="tabular-nums">{formatChartNumber(value)}</div>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-center justify-end gap-3 text-xs text-[#64748b]">
          <span>Lower</span>
          <div className="h-2 w-28 rounded-full bg-[linear-gradient(90deg,#f8fafc_0%,rgba(15,118,110,0.7)_100%)]" />
          <span>Higher</span>
        </div>
      </div>
    </div>
  );
}
