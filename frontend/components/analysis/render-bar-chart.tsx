"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  ANALYTICS_CHART_THEME,
  type ChartDensity,
  type ChartSizeTier,
  ExecutiveLegend,
  ExecutiveTooltip,
  formatChartNumber,
  getChartHeightClass,
  getSeriesColor,
  shouldUseHorizontalBarLayout,
  truncateAxisLabel,
} from "@/components/analysis/chart-theme";
import type { BarLikeChart, DrilldownTarget } from "@/lib/visualization/engine";

function handleSeriesDrilldown(
  chart: BarLikeChart,
  payload: Record<string, string | number>,
  seriesKey: string,
  onDrilldown?: (target: DrilldownTarget) => void,
) {
  if (!onDrilldown || !chart.drilldownDimension) return;
  const categoryValue = String(payload[chart.xKey] ?? "");
  if (!categoryValue) return;
  onDrilldown({
    dimension: chart.drilldownDimension,
    value: categoryValue,
    ...(chart.secondaryDrilldownDimension
      ? {
          seriesDimension: chart.secondaryDrilldownDimension,
          seriesValue: seriesKey,
        }
      : {}),
  });
}

export function RenderBarChart(props: {
  chart: BarLikeChart;
  onDrilldown?: (target: DrilldownTarget) => void;
  density?: ChartDensity;
  size?: ChartSizeTier;
  activeFilters?: Record<string, string[]>;
}) {
  const { chart, onDrilldown, density = "normal", size = "medium", activeFilters = {} } = props;
  const isHorizontal = shouldUseHorizontalBarLayout(chart.data, chart.xKey);
  const showValueLabels = chart.data.length <= 8 && chart.series.length === 1;
  const primaryFilterValues = chart.drilldownDimension ? activeFilters[chart.drilldownDimension] || [] : [];
  const secondaryFilterValues = chart.secondaryDrilldownDimension
    ? activeFilters[chart.secondaryDrilldownDimension] || []
    : [];
  const hasRelevantSelection = primaryFilterValues.length > 0 || secondaryFilterValues.length > 0;

  return (
    <div className={getChartHeightClass(size, density)}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={chart.data}
          layout={isHorizontal ? "vertical" : "horizontal"}
          margin={{
            top: 8,
            right: 28,
            left: isHorizontal ? 24 : 4,
            bottom: isHorizontal ? 4 : 18,
          }}
          barCategoryGap={isHorizontal ? "18%" : "24%"}
        >
          <CartesianGrid
            vertical={false}
            stroke={ANALYTICS_CHART_THEME.palette.grid}
            strokeDasharray="0"
          />
          <Legend verticalAlign="top" align="left" content={<ExecutiveLegend />} />
          {isHorizontal ? (
            <>
              <XAxis
                type="number"
                tickFormatter={formatChartNumber}
                tick={{ fill: "#64748b", fontSize: 12 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                type="category"
                dataKey={chart.xKey}
                width={160}
                tick={{ fill: "#334155", fontSize: 12 }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(value) => truncateAxisLabel(value, 24)}
              />
            </>
          ) : (
            <>
              <XAxis
                dataKey={chart.xKey}
                tick={{ fill: "#64748b", fontSize: 12 }}
                tickFormatter={(value) => truncateAxisLabel(value, 18)}
                angle={chart.data.length > 6 ? -18 : 0}
                textAnchor={chart.data.length > 6 ? "end" : "middle"}
                interval={0}
                height={chart.data.length > 6 ? 68 : 34}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tickFormatter={formatChartNumber}
                tick={{ fill: "#64748b", fontSize: 12 }}
                axisLine={false}
                tickLine={false}
                width={50}
              />
            </>
          )}
          <Tooltip cursor={{ fill: "#f8fafc" }} content={<ExecutiveTooltip />} />
          {chart.series.map((series, seriesIndex) => (
            <Bar
              key={series.key}
              dataKey={series.key}
              name={series.label}
              fill={getSeriesColor(series.key, seriesIndex)}
              barSize={ANALYTICS_CHART_THEME.barSize}
              radius={
                isHorizontal
                  ? [0, ANALYTICS_CHART_THEME.radius, ANALYTICS_CHART_THEME.radius, 0]
                  : [ANALYTICS_CHART_THEME.radius, ANALYTICS_CHART_THEME.radius, 0, 0]
              }
              onClick={(data) =>
                handleSeriesDrilldown(
                  chart,
                  (data?.payload as Record<string, string | number>) || {},
                  series.label,
                  onDrilldown,
                )
              }
            >
              {chart.data.map((row, cellIndex) => {
                const categoryValue = String(row[chart.xKey] ?? "");
                const matchesPrimary =
                  primaryFilterValues.length === 0 || primaryFilterValues.includes(categoryValue);
                const matchesSecondary =
                  secondaryFilterValues.length === 0 ||
                  secondaryFilterValues.includes(series.label) ||
                  secondaryFilterValues.includes(series.key);
                const isSelected = matchesPrimary && matchesSecondary;

                return (
                  <Cell
                    key={`${series.key}-${cellIndex}`}
                    fill={getSeriesColor(series.key, seriesIndex)}
                    fillOpacity={hasRelevantSelection ? (isSelected ? 1 : 0.24) : 1}
                    stroke={isSelected && hasRelevantSelection ? "#0f172a" : "none"}
                    strokeWidth={isSelected && hasRelevantSelection ? 1.2 : 0}
                    cursor={onDrilldown ? "pointer" : "default"}
                  />
                );
              })}
              {showValueLabels ? (
                <LabelList
                  dataKey={series.key}
                  position={isHorizontal ? "right" : "top"}
                  formatter={(value: unknown) => formatChartNumber(value)}
                  style={{ fill: "#334155", fontSize: 11, fontWeight: 600 }}
                />
              ) : null}
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
