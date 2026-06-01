"use client";

import { useMemo } from "react";
import {
  Bar,
  BarChart,
  Line,
  LineChart,
  Pie,
  PieChart as RechartsPieChart,
  Cell,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { ReportDataTable, type ReportTableRow, type ReportValueCell } from "@/components/reports/report-data-table";

export type ReportBarCategoryRow = {
  label: string;
  color: string;
  byPeriod: Record<string, ReportValueCell>;
};

type ReportBarChartProps = {
  title: string;
  yAxisLabel: string;
  periodLabels: string[];
  rows: ReportBarCategoryRow[];
  chartId: string;
  chartType?: "clustered-bar" | "grouped-bar" | "line" | "pie";
  showLegend?: boolean;
};

const PERIOD_COMPARE_COLORS = ["#1f6a8a", "#9c2f92", "#2e8b57", "#b55a18"];

const formatNumber = (value: number) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);

const toSafeNumber = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replaceAll(",", ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

type TooltipProps = {
  active?: boolean;
  payload?: Array<{ payload?: Record<string, unknown> }>;
  periodLabels: string[];
};

function ReportBarTooltip(props: TooltipProps) {
  const { active, payload, periodLabels } = props;
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload as
    | { category?: string; __cells?: Record<string, ReportValueCell> }
    | undefined;
  if (!row?.category || !row.__cells) return null;

  return (
    <div className="border border-[#d1d5db] bg-white px-3 py-2 text-xs text-[#334155]">
      <div className="mb-1 font-semibold">{row.category}</div>
      <div className="space-y-1">
        {periodLabels.map((periodLabel) => {
          const cell = row.__cells?.[periodLabel];
          return (
            <div key={`${row.category}-${periodLabel}`} className="flex items-center justify-between gap-3">
              <span>{periodLabel}</span>
              <span className="font-medium">
                {!cell?.hasData ? "No data reported" : formatNumber(cell.value ?? 0)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ReportBarChart(props: ReportBarChartProps) {
  const {
    title,
    yAxisLabel,
    periodLabels,
    rows,
    chartId,
    chartType = "clustered-bar",
    showLegend = true,
  } = props;

  const chartRows = useMemo(() => {
    return rows.map((row) => {
      const entry: Record<string, unknown> = {
        category: row.label,
        color: row.color,
        __cells: row.byPeriod,
      };
      periodLabels.forEach((periodLabel) => {
        entry[periodLabel] = row.byPeriod[periodLabel]?.value ?? null;
      });
      return entry;
    });
  }, [periodLabels, rows]);

  const yAxisMax = useMemo(() => {
    let maxValue = 0;
    rows.forEach((row) => {
      periodLabels.forEach((periodLabel) => {
        const cell = row.byPeriod[periodLabel];
        if (!cell?.hasData) return;
        maxValue = Math.max(maxValue, toSafeNumber(cell.value));
      });
    });
    if (maxValue <= 0) return 10;
    return Math.ceil(maxValue * 1.1);
  }, [periodLabels, rows]);

  const tableRows = useMemo<ReportTableRow[]>(
    () =>
      rows.map((row) => ({
        label: row.label,
        color: row.color,
        cells: periodLabels.map((periodLabel) => row.byPeriod[periodLabel] || { hasData: false, value: null }),
      })),
    [periodLabels, rows],
  );

  const singlePeriodMode = periodLabels.length === 1;
  const resolvedChartType =
    chartType === "pie" && !singlePeriodMode ? "clustered-bar" : chartType;
  const pieData = useMemo(
    () =>
      rows
        .map((row) => {
          const cell = row.byPeriod[periodLabels[0]];
          return {
            category: row.label,
            color: row.color,
            value: cell?.hasData ? cell.value ?? 0 : null,
            hasData: Boolean(cell?.hasData),
          };
        })
        .filter((entry) => entry.hasData),
    [periodLabels, rows],
  );

  if (periodLabels.length === 0) {
    return (
      <section id={chartId} className="space-y-3 border border-[#c6c6c6] bg-white p-4">
        <h3 className="text-[16px] font-semibold leading-tight text-[#1f4e79]">{title}</h3>
        <div className="flex h-[220px] items-center justify-center border border-[#d4d4d4] bg-white text-sm text-[#6b7280]">
          No period selected.
        </div>
      </section>
    );
  }

  return (
    <section id={chartId} className="space-y-3 border border-[#c6c6c6] bg-white p-4">
      <h3 className="text-[16px] font-semibold leading-tight text-[#1f4e79]">{title}</h3>

      <div className="h-[360px] border border-[#d4d4d4] bg-white px-2 py-2">
        {resolvedChartType === "pie" ? (
          pieData.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-[#6b7280]">
              No data available.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <RechartsPieChart>
                <Pie data={pieData} dataKey="value" nameKey="category" outerRadius={120}>
                  {pieData.map((entry) => (
                    <Cell key={`pie-${entry.category}`} fill={entry.color} stroke={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value: number | null) =>
                    value === null || value === undefined
                      ? "No data reported"
                      : formatNumber(value)
                  }
                  contentStyle={{
                    border: "1px solid #d1d5db",
                    borderRadius: "2px",
                    backgroundColor: "#ffffff",
                    color: "#334155",
                  }}
                />
                {showLegend ? <Legend /> : null}
              </RechartsPieChart>
            </ResponsiveContainer>
          )
        ) : resolvedChartType === "line" ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartRows} margin={{ top: 10, right: 18, left: 10, bottom: 60 }}>
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
                tickFormatter={(value) => formatNumber(toSafeNumber(value))}
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
              <Tooltip cursor={{ fill: "rgba(15, 23, 42, 0.04)" }} content={<ReportBarTooltip periodLabels={periodLabels} />} />
              {showLegend && !singlePeriodMode ? <Legend /> : null}
              {singlePeriodMode ? (
                <Line
                  type="linear"
                  dataKey={periodLabels[0]}
                  name={periodLabels[0]}
                  stroke="#1f6a8a"
                  strokeWidth={2}
                  dot={{ r: 3, fill: "#1f6a8a" }}
                  connectNulls={false}
                />
              ) : (
                periodLabels.map((periodLabel, index) => (
                  <Line
                    key={`line-${periodLabel}`}
                    type="linear"
                    dataKey={periodLabel}
                    name={periodLabel}
                    stroke={PERIOD_COMPARE_COLORS[index % PERIOD_COMPARE_COLORS.length]}
                    strokeWidth={2}
                    dot={{ r: 3, fill: PERIOD_COMPARE_COLORS[index % PERIOD_COMPARE_COLORS.length] }}
                    connectNulls={false}
                  />
                ))
              )}
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={chartRows}
              margin={{ top: 10, right: 18, left: 10, bottom: 60 }}
              barCategoryGap={resolvedChartType === "grouped-bar" ? "8%" : "20%"}
            >
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
                tickFormatter={(value) => formatNumber(toSafeNumber(value))}
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
              <Tooltip cursor={{ fill: "rgba(15, 23, 42, 0.04)" }} content={<ReportBarTooltip periodLabels={periodLabels} />} />
              {showLegend && !singlePeriodMode ? <Legend /> : null}

              {singlePeriodMode ? (
                <Bar dataKey={periodLabels[0]} name={periodLabels[0]} radius={[0, 0, 0, 0]} maxBarSize={30}>
                  {rows.map((row) => (
                    <Cell key={`${row.label}-single`} fill={row.color} stroke={row.color} />
                  ))}
                </Bar>
              ) : (
                periodLabels.map((periodLabel, index) => (
                  <Bar
                    key={`period-${periodLabel}`}
                    dataKey={periodLabel}
                    name={periodLabel}
                    fill={PERIOD_COMPARE_COLORS[index % PERIOD_COMPARE_COLORS.length]}
                    stroke={PERIOD_COMPARE_COLORS[index % PERIOD_COMPARE_COLORS.length]}
                    radius={[0, 0, 0, 0]}
                    maxBarSize={26}
                  />
                ))
              )}
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      <ReportDataTable
        columnLabels={periodLabels}
        rows={tableRows}
        titleColumnLabel="Indicator / Category"
      />
    </section>
  );
}
