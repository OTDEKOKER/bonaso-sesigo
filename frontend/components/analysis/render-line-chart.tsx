"use client";

import {
  Area,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceDot,
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
  truncateAxisLabel,
} from "@/components/analysis/chart-theme";
import type { BarLikeChart } from "@/lib/visualization/engine";

type LineChartType = BarLikeChart;

export function RenderLineChart(props: {
  chart: LineChartType;
  density?: ChartDensity;
  size?: ChartSizeTier;
  onDrilldown?: (target: { dimension: string; value: string }) => void;
  activeFilters?: Record<string, string[]>;
}) {
  const { chart, density = "normal", size = "medium", onDrilldown, activeFilters = {} } = props;
  const latestRow = chart.data[chart.data.length - 1];
  const showLatestLabels = chart.series.length <= 2 && chart.data.length > 0;
  const periodFilterValues = chart.drilldownDimension ? activeFilters[chart.drilldownDimension] || [] : [];
  const hasPeriodSelection = periodFilterValues.length > 0;

  return (
    <div className={getChartHeightClass(size, density)}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={chart.data}
          margin={{ top: 8, right: 28, left: 8, bottom: 8 }}
        >
          <defs>
            <linearGradient id="trendAreaFill" x1="0" y1="0" x2="0" y2="1">
              <stop
                offset="0%"
                stopColor={ANALYTICS_CHART_THEME.palette.actual}
                stopOpacity={0.18}
              />
              <stop
                offset="100%"
                stopColor={ANALYTICS_CHART_THEME.palette.actual}
                stopOpacity={0.02}
              />
            </linearGradient>
          </defs>
          <CartesianGrid
            vertical={false}
            stroke={ANALYTICS_CHART_THEME.palette.grid}
            strokeDasharray="0"
          />
          <Legend verticalAlign="top" align="left" content={<ExecutiveLegend />} />
          <XAxis
            dataKey={chart.xKey}
            tick={{ fill: "#64748b", fontSize: 12 }}
            tickFormatter={(value) => truncateAxisLabel(value, 14)}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tickFormatter={formatChartNumber}
            tick={{ fill: "#64748b", fontSize: 12 }}
            axisLine={false}
            tickLine={false}
            width={52}
          />
          <Tooltip cursor={{ stroke: "#cbd5e1", strokeDasharray: "4 4" }} content={<ExecutiveTooltip />} />
          {chart.series[0] ? (
            <Area
              type="monotone"
              dataKey={chart.series[0].key}
              stroke="none"
              fill="url(#trendAreaFill)"
              isAnimationActive={false}
            />
          ) : null}
          {chart.series.map((series, index) => {
            const color = getSeriesColor(series.key, index);

            return (
              <Line
              key={series.key}
              type="monotone"
              dataKey={series.key}
              name={series.label}
                stroke={color}
                strokeWidth={index === 0 ? 3 : 2.5}
                dot={(dotProps) => {
                  const payload = dotProps.payload as Record<string, string | number> | undefined;
                  const periodValue = String(payload?.[chart.xKey] ?? "");
                  const isSelected = !hasPeriodSelection || periodFilterValues.includes(periodValue);
                  const baseRadius = chart.data.length > 20 ? 2.5 : 3.5;
                  return (
                    <circle
                      cx={dotProps.cx}
                      cy={dotProps.cy}
                      r={baseRadius}
                      fill={color}
                      fillOpacity={hasPeriodSelection ? (isSelected ? 1 : 0.22) : 0.82}
                      stroke={isSelected && hasPeriodSelection ? "#ffffff" : "none"}
                      strokeWidth={isSelected && hasPeriodSelection ? 2 : 0}
                      style={{ cursor: onDrilldown ? "pointer" : "default" }}
                      onClick={() => {
                        if (!onDrilldown || !chart.drilldownDimension || !periodValue) return;
                        onDrilldown({ dimension: chart.drilldownDimension, value: periodValue });
                      }}
                    />
                  );
                }}
                activeDot={{ r: 4, strokeWidth: 0, fill: color }}
              />
            );
          })}
          {showLatestLabels && latestRow
            ? chart.series.map((series, index) => {
                const value = Number(latestRow[series.key] ?? 0);
                if (!Number.isFinite(value)) return null;
                return (
                  <ReferenceDot
                    key={`${series.key}-latest`}
                    x={latestRow[chart.xKey]}
                    y={value}
                    r={5}
                    fill={getSeriesColor(series.key, index)}
                    stroke="#ffffff"
                    strokeWidth={2}
                    label={{
                      value: formatChartNumber(value),
                      position: "top",
                      fill: "#334155",
                      fontSize: 11,
                      fontWeight: 600,
                    }}
                  />
                );
              })
            : null}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
