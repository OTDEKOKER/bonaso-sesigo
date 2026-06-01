"use client";

import {
  ANALYTICS_CHART_THEME,
  type ChartDensity,
  formatChartNumber,
} from "@/components/analysis/chart-theme";
import type { DrilldownTarget, FunnelChart } from "@/lib/visualization/engine";

type FunnelChartType = FunnelChart;

function getStageTone(dropoffPercent: number, index: number) {
  if (index === 0) return ANALYTICS_CHART_THEME.palette.actual;
  if (dropoffPercent < 20) return ANALYTICS_CHART_THEME.palette.success;
  if (dropoffPercent < 40) return ANALYTICS_CHART_THEME.palette.warning;
  return ANALYTICS_CHART_THEME.palette.danger;
}

export function RenderFunnelChart(props: {
  chart: FunnelChartType;
  density?: ChartDensity;
  onDrilldown?: (target: DrilldownTarget) => void;
  activeFilters?: Record<string, string[]>;
}) {
  const { chart, density = "normal", onDrilldown, activeFilters = {} } = props;
  const maxValue = Math.max(...chart.steps.map((step) => step.value), 0);
  const cardPadding = density === "compact" ? "p-3" : "p-3.5";
  const stageFilters = activeFilters.stage || [];
  const hasSelection = stageFilters.length > 0;

  return (
    <div className={density === "compact" ? "space-y-2.5" : "space-y-3"}>
      {chart.steps.map((step, index) => {
        const tone = getStageTone(step.dropoffPercent, index);

        return (
          <div
            key={step.key}
            className={`rounded-[1.2rem] border border-[#dbe5ec] bg-white shadow-[0_8px_22px_rgba(15,23,42,0.05)] ${cardPadding} ${
              hasSelection && !stageFilters.includes(step.key) ? "opacity-35" : ""
            } ${hasSelection && stageFilters.includes(step.key) ? "ring-2 ring-slate-900/15" : ""} ${
              onDrilldown ? "cursor-pointer" : ""
            }`}
            role={onDrilldown ? "button" : undefined}
            tabIndex={onDrilldown ? 0 : undefined}
            onClick={() => {
              if (!onDrilldown) return;
              onDrilldown({ dimension: "stage", value: step.key });
            }}
            onKeyDown={(event) => {
              if (!onDrilldown) return;
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              onDrilldown({ dimension: "stage", value: step.key });
            }}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#64748b]">
                  Stage {index + 1}
                </div>
                <div className="mt-1 text-lg font-semibold text-[#0f172a]">{step.label}</div>
              </div>
              <div className="grid min-w-[152px] grid-cols-2 gap-2">
                <div className="rounded-[1rem] border border-[#dbe5ec] bg-[#f8fafc] px-3 py-2 text-right">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#64748b]">
                    Count
                  </div>
                  <div className="mt-1 text-2xl font-semibold tabular-nums text-[#0f172a]">
                    {formatChartNumber(step.value)}
                  </div>
                </div>
                <div className="rounded-[1rem] border border-[#dbe5ec] bg-[#f8fafc] px-3 py-2 text-right">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#64748b]">Entry %</div>
                  <div className="mt-1 text-lg font-semibold tabular-nums text-[#0f172a]">{step.retentionPercent.toFixed(1)}%</div>
                </div>
              </div>
            </div>
            <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-[#eaf1f5]">
              <div
                className="h-full rounded-full transition-[width]"
                style={{
                  width: `${maxValue > 0 ? Math.max(8, (step.value / maxValue) * 100) : 0}%`,
                  backgroundColor: tone,
                }}
              />
            </div>
            <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-sm text-[#64748b]">
              <div>Stage share of entry point</div>
              <div className="font-medium tabular-nums text-[#334155]">
                {step.retentionPercent.toFixed(1)}%
              </div>
            </div>
            {typeof step.targetValue === "number" ? (
              <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-sm text-[#64748b]">
                <div>Target</div>
                <div className="font-semibold tabular-nums text-[#334155]">
                  {formatChartNumber(step.targetValue)}
                </div>
              </div>
            ) : null}
            {step.conversionPercent !== null ? (
              <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-sm text-[#64748b]">
                <div>Conversion from previous stage</div>
                <div className="font-semibold tabular-nums text-[#334155]">
                  {step.conversionPercent.toFixed(1)}%
                  {step.targetConversionPercent !== null && step.targetConversionPercent !== undefined
                    ? ` (target ${step.targetConversionPercent.toFixed(1)}%)`
                    : ""}
                </div>
              </div>
            ) : null}
            {index > 0 ? (
              <div className="mt-1 text-sm text-[#64748b]">
                Drop-off from previous stage:{" "}
                <span className="font-semibold tabular-nums text-[#334155]">
                  {step.dropoffPercent.toFixed(1)}%
                </span>
              </div>
            ) : null}
            {Array.isArray(step.breakdown) && step.breakdown.length > 0 ? (
              <div className="mt-3 rounded-xl border border-[#dbe5ec] bg-[#f8fafc] p-2.5">
                <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#64748b]">
                  Disaggregation
                </div>
                <div className="space-y-1.5">
                  {step.breakdown.slice(0, 6).map((entry) => (
                    <div key={`${step.key}-${entry.key}`} className="flex items-center justify-between gap-2 text-xs text-[#334155]">
                      <span className="truncate">{entry.label}</span>
                      <span className="tabular-nums font-medium">
                        {formatChartNumber(entry.value)}
                        {typeof entry.targetValue === "number" ? ` / ${formatChartNumber(entry.targetValue)}` : ""}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
