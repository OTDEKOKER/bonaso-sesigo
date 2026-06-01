"use client";

import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import type { ConsolidatedMatrixData } from "@/lib/analytics/query-builder";

type ReportDisaggregateChartProps = {
  title: string;
  matrix: ConsolidatedMatrixData | null;
  yAxisLabel?: string;
};

const SERIES_COLORS = ["#1f6a8a", "#9c2f92", "#2e8b57", "#b55a18", "#1f9ac7", "#0f4258", "#48a535", "#e67e22"];

const formatNumber = (value: number) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);

export function ReportDisaggregateChart(props: ReportDisaggregateChartProps) {
  const { title, matrix, yAxisLabel = "No. of People" } = props;

  const chartData = useMemo(() => {
    if (!matrix) return [];
    return matrix.rowLabels.map((rowLabel, rowIndex) => {
      const row: Record<string, string | number> = {
        category: rowLabel,
      };
      matrix.columnLabels.forEach((columnLabel, columnIndex) => {
        row[columnLabel] = matrix.cells[rowIndex]?.[columnIndex] || 0;
      });
      return row;
    });
  }, [matrix]);

  const yAxisMax = useMemo(() => {
    if (!matrix) return 10;
    const max = matrix.cells.reduce((highest, row) => {
      const rowMax = row.reduce((innerHighest, value) => Math.max(innerHighest, value), 0);
      return Math.max(highest, rowMax);
    }, 0);
    return max <= 0 ? 10 : Math.ceil(max * 1.1);
  }, [matrix]);

  if (!matrix || matrix.rowLabels.length === 0 || matrix.columnLabels.length === 0) {
    return (
      <section className="space-y-3 border border-[#c6c6c6] bg-white p-4">
        <h3 className="text-[16px] font-semibold leading-tight text-[#1f4e79]">{title}</h3>
        <div className="flex h-[280px] items-center justify-center border border-[#d4d4d4] bg-white text-sm text-[#6b7280]">
          No disaggregation chart data available.
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-3 border border-[#c6c6c6] bg-white p-4">
      <h3 className="text-[16px] font-semibold leading-tight text-[#1f4e79]">{title}</h3>
      <div className="h-[360px] border border-[#d4d4d4] bg-white px-2 py-2">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 10, right: 18, left: 10, bottom: 60 }} barCategoryGap="10%">
            <CartesianGrid stroke="#d9d9d9" strokeDasharray="0" vertical={false} />
            <XAxis
              dataKey="category"
              tick={{ fill: "#4b5563", fontSize: 11 }}
              tickLine={{ stroke: "#c4c4c4" }}
              axisLine={{ stroke: "#c4c4c4" }}
              interval={0}
              angle={-18}
              textAnchor="end"
              height={82}
            />
            <YAxis
              domain={[0, yAxisMax]}
              tickFormatter={(value) => formatNumber(Number(value || 0))}
              tick={{ fill: "#4b5563", fontSize: 12 }}
              tickLine={{ stroke: "#c4c4c4" }}
              axisLine={{ stroke: "#c4c4c4" }}
              allowDecimals={false}
              width={72}
              label={{
                value: yAxisLabel,
                angle: -90,
                position: "insideLeft",
                fill: "#4b5563",
                style: { fontSize: 12 },
              }}
            />
            <Tooltip
              formatter={(value: number | null, seriesName: string) => [
                value === null || value === undefined ? "No data reported" : formatNumber(value),
                String(seriesName || ""),
              ]}
              contentStyle={{
                border: "1px solid #d1d5db",
                borderRadius: "2px",
                backgroundColor: "#ffffff",
                color: "#334155",
              }}
            />
            <Legend />
            {matrix.columnLabels.map((columnLabel, index) => (
              <Bar
                key={`disaggregate-series-${columnLabel}`}
                dataKey={columnLabel}
                name={columnLabel}
                fill={SERIES_COLORS[index % SERIES_COLORS.length]}
                stroke={SERIES_COLORS[index % SERIES_COLORS.length]}
                radius={[0, 0, 0, 0]}
                maxBarSize={28}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

