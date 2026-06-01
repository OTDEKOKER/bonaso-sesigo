import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, LabelList, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { DashboardPanel } from "@/components/dashboard/components/dashboard-panel";
import { ChartEmptyState } from "@/components/dashboard/components/chart-empty-state";
import { ChartLegend } from "@/components/dashboard/components/chart-legend";
import { resolveDashboardIndicator } from "@/components/dashboard/engine/canonical-indicators";
import {
  actualSeriesColor,
  formatPercent,
  formatWholeNumber,
  indicatorStageOrder,
  renderBarValueLabel,
  targetSeriesColor,
  wrapLabelWithoutTruncation,
} from "@/components/dashboard/engine/normalize-indicators";
import type { WidgetMetricCollection } from "@/components/dashboard/engine/types";
import { CustomWidgetBarTooltip, renderHorizontalCategoryTick, TargetReferenceMarker } from "./shared-chart-utils";

export function IndicatorBarChartWidget({
  metrics,
  subtitle,
  title,
}: {
  metrics: WidgetMetricCollection;
  subtitle?: string;
  title: string;
}) {
  const displayTitle = title === "NCD" ? "NCD Screening Performance" : `${title} Performance`;
  const displaySubtitle = subtitle || "indicator group / reporting period / project";
  const processedData = useMemo(
    () =>
      metrics
        .map((metric) => {
          const { cleanLabel, stage } = resolveDashboardIndicator(metric.label);
          return {
            ...metric,
            cleanLabel,
            progressLabel: metric.target > 0 ? `${formatPercent(metric.percentage)}%` : "No target",
            stage,
          };
        })
        .sort((left, right) => {
          const leftStageIndex = indicatorStageOrder.indexOf(left.stage);
          const rightStageIndex = indicatorStageOrder.indexOf(right.stage);
          if (leftStageIndex !== rightStageIndex) return leftStageIndex - rightStageIndex;
          return right.value - left.value;
        })
        .slice(0, 5),
    [metrics],
  );
  const hasData = processedData.some((metric) => metric.value > 0 || metric.target > 0);
  const chartHeight = useMemo(
    () =>
      Math.max(
        280,
        processedData.reduce(
          (sum, metric) => sum + Math.max(48, wrapLabelWithoutTruncation(metric.cleanLabel, 24).length * 16 + 18),
          12,
        ),
      ),
    [processedData],
  );
  const xAxisMax = useMemo(
    () =>
      Math.max(
        1,
        ...processedData.map((metric) => Math.max(metric.value, metric.target)),
      ),
    [processedData],
  );

  return (
    <DashboardPanel eyebrow="Custom widget" subtitle={hasData ? displaySubtitle : undefined} title={displayTitle}>
      {!hasData ? (
        <ChartEmptyState message="Choose one or more indicators for this widget." />
      ) : (
        <div className="space-y-2">
          <ChartLegend
            items={[
              { color: actualSeriesColor, label: "Actual" },
              { color: targetSeriesColor, label: "Target" },
            ]}
          />
          <div className="w-full min-w-0 overflow-hidden" style={{ height: `${chartHeight}px` }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                layout="vertical"
                data={processedData}
                margin={{ top: 4, right: 124, left: 12, bottom: 4 }}
                barCategoryGap="28%"
              >
                <CartesianGrid horizontal={false} stroke="hsl(var(--border) / 0.4)" />
                <XAxis
                  allowDecimals={false}
                  axisLine={false}
                  domain={[0, Math.ceil(xAxisMax * 1.2)]}
                  tickFormatter={(value: number) => formatWholeNumber(value)}
                  tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
                  tickLine={false}
                  type="number"
                />
                <YAxis
                  axisLine={false}
                  dataKey="cleanLabel"
                  interval={0}
                  tick={renderHorizontalCategoryTick}
                  tickLine={false}
                  type="category"
                  width={240}
                />
                <Tooltip
                  content={<CustomWidgetBarTooltip />}
                  cursor={{ fill: "hsl(var(--muted) / 0.18)" }}
                />
                {processedData
                  .filter((metric) => metric.target > 0)
                  .map((metric) => (
                    <ReferenceDot
                      key={`${metric.indicatorId}-target`}
                      ifOverflow="extendDomain"
                      isFront
                      shape={<TargetReferenceMarker />}
                      x={metric.target}
                      y={metric.cleanLabel}
                    />
                  ))}
                <Bar dataKey="value" fill={actualSeriesColor} name="Actual" radius={[0, 10, 10, 0]} minPointSize={6} maxBarSize={26}>
                  <LabelList
                    dataKey="value"
                    position="right"
                    offset={8}
                    formatter={renderBarValueLabel}
                    fill="hsl(var(--foreground))"
                    fontSize={11}
                  />
                  <LabelList
                    dataKey="progressLabel"
                    position="right"
                    offset={68}
                    fill="hsl(var(--muted-foreground))"
                    fontSize={11}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </DashboardPanel>
  );
}
