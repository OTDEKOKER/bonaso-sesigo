"use client";

import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { ReportDataTable, type ReportTableRow, type ReportValueCell } from "@/components/reports/report-data-table";

export type ReportTargetRow = {
  label: string;
  achieved: ReportValueCell;
  target: ReportValueCell;
};

type ReportTargetChartProps = {
  title: string;
  yAxisLabel: string;
  chartId: string;
  rows: ReportTargetRow[];
  showTargets?: boolean;
  showAchievement?: boolean;
  showPerformancePercent?: boolean;
};

const formatNumber = (value: number) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);

export function ReportTargetChart(props: ReportTargetChartProps) {
  const {
    title,
    yAxisLabel,
    chartId,
    rows,
    showTargets = true,
    showAchievement = true,
    showPerformancePercent = false,
  } = props;

  const chartData = useMemo(
    () =>
      rows.map((row) => ({
        category: row.label,
        achieved: showAchievement ? row.achieved.value : null,
        target: showTargets ? row.target.value : null,
        __achieved: row.achieved,
        __target: row.target,
      })),
    [rows, showAchievement, showTargets],
  );

  const yAxisMax = useMemo(() => {
    const max = rows.reduce((highest, row) => {
      const achievedValue = row.achieved.hasData ? row.achieved.value ?? 0 : 0;
      const targetValue = row.target.hasData ? row.target.value ?? 0 : 0;
      return Math.max(highest, achievedValue, targetValue);
    }, 0);
    return max <= 0 ? 10 : Math.ceil(max * 1.1);
  }, [rows]);

  const tableRows = useMemo<ReportTableRow[]>(
    () => {
      const table: ReportTableRow[] = [];
      if (showAchievement) {
        table.push({
          label: "Achieved",
          color: "#1f6a8a",
          cells: rows.map((row) => row.achieved),
        });
      }
      if (showTargets) {
        table.push({
          label: "Target",
          color: "#9c2f92",
          cells: rows.map((row) => row.target),
        });
      }
      if (showPerformancePercent) {
        table.push({
          label: "Performance %",
          color: "#2e8b57",
          cells: rows.map((row) => {
            if (!row.achieved.hasData || !row.target.hasData) {
              return { hasData: false, value: null };
            }
            const targetValue = row.target.value ?? 0;
            if (targetValue <= 0) {
              return { hasData: false, value: null };
            }
            const achievedValue = row.achieved.value ?? 0;
            const percent = (achievedValue / targetValue) * 100;
            return {
              hasData: true,
              value: percent,
              displayValue: `${percent.toFixed(1)}%`,
            };
          }),
        });
      }
      return table;
    },
    [rows, showAchievement, showPerformancePercent, showTargets],
  );

  return (
    <section id={chartId} className="space-y-3 border border-[#c6c6c6] bg-white p-4">
      <h3 className="text-[16px] font-semibold leading-tight text-[#1f4e79]">{title}</h3>

      <div className="h-[340px] border border-[#d4d4d4] bg-white px-2 py-2">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 10, right: 18, left: 10, bottom: 60 }}>
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
              cursor={{ fill: "rgba(15, 23, 42, 0.04)" }}
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
            {showAchievement ? (
              <Bar dataKey="achieved" name="Achieved" fill="#1f6a8a" stroke="#1f6a8a" radius={[0, 0, 0, 0]} maxBarSize={28} />
            ) : null}
            {showTargets ? (
              <Bar dataKey="target" name="Target" fill="#9c2f92" stroke="#9c2f92" radius={[0, 0, 0, 0]} maxBarSize={28} />
            ) : null}
          </BarChart>
        </ResponsiveContainer>
      </div>

      <ReportDataTable
        columnLabels={rows.map((row) => row.label)}
        rows={tableRows}
        titleColumnLabel="Series"
      />
    </section>
  );
}
