"use client";

import { useMemo, useRef, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Line,
  LineChart,
  Pie,
  PieChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  Scatter,
  ScatterChart,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import {
  AreaChart as AreaChartIcon,
  BarChart3,
  BarChart4,
  Download,
  Gauge as GaugeIcon,
  Hash,
  LineChart as LineChartIcon,
  PieChart as PieChartIcon,
  Radar as RadarIcon,
  ScatterChart as ScatterChartIcon,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { cn } from "@/lib/utils";

export type AggregateChartPoint = {
  name: string;
} & Record<string, string | number>;

export type AggregateChartSeries = {
  key: string;
  label: string;
  color: string;
};

type PresentationMode = "report" | "split";
type ReportChartPoint = {
  name: string;
  total: number;
};

type AggregateChartType =
  | "bar"
  | "stacked-bar"
  | "line"
  | "area"
  | "stacked-area"
  | "pie"
  | "single-value"
  | "gauge"
  | "radar"
  | "scatter";

type ChartTypeOption = {
  id: AggregateChartType;
  label: string;
  description: string;
  icon: LucideIcon;
};

const CHART_TYPE_OPTIONS: ChartTypeOption[] = [
  {
    id: "bar",
    label: "Bar",
    description: "Compare sizes of related elements.",
    icon: BarChart3,
  },
  {
    id: "stacked-bar",
    label: "Stacked bar",
    description: "Compare parts of a whole across related elements.",
    icon: BarChart4,
  },
  {
    id: "line",
    label: "Line",
    description: "Track or compare changes over time.",
    icon: LineChartIcon,
  },
  {
    id: "area",
    label: "Area",
    description: "Track changes over time, filled.",
    icon: AreaChartIcon,
  },
  {
    id: "stacked-area",
    label: "Stacked area",
    description: "Compare parts of a whole over time.",
    icon: AreaChartIcon,
  },
  {
    id: "pie",
    label: "Pie",
    description: "Compare parts of a whole at a single point.",
    icon: PieChartIcon,
  },
  {
    id: "single-value",
    label: "Single value",
    description: "Display the grand total as one number.",
    icon: Hash,
  },
  {
    id: "gauge",
    label: "Gauge",
    description: "Total against target as a percentage. Needs a target.",
    icon: GaugeIcon,
  },
  {
    id: "radar",
    label: "Radar",
    description: "Compare items across multiple categories.",
    icon: RadarIcon,
  },
  {
    id: "scatter",
    label: "Scatter",
    description: "Relationship between two series. Needs exactly two series.",
    icon: ScatterChartIcon,
  },
];

const reportPalette = [
  "#AFC4D8",
  "#CC0000",
  "#93C94D",
  "#F1E800",
  "#0FA546",
  "#20A3D3",
  "#0A2B73",
  "#6F35A5",
];

const formatter = new Intl.NumberFormat("en-US");

function toNumeric(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, "").trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function wrapLabel(label: string, maxCharsPerLine: number) {
  const words = String(label || "").split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let currentLine = "";

  words.forEach((word) => {
    const next = currentLine ? `${currentLine} ${word}` : word;
    if (next.length <= maxCharsPerLine) {
      currentLine = next;
      return;
    }
    if (currentLine) lines.push(currentLine);
    currentLine = word;
  });

  if (currentLine) lines.push(currentLine);
  return lines.length > 0 ? lines : [label];
}

function WrappedTick(props: { x?: number; y?: number; payload?: { value?: string } }) {
  const { x = 0, y = 0, payload } = props;
  const lines = wrapLabel(String(payload?.value || ""), 14);

  return (
    <g transform={`translate(${x},${y})`}>
      <text
        x={0}
        y={0}
        dy={10}
        textAnchor="middle"
        fill="hsl(var(--muted-foreground))"
        fontSize={12}
      >
        {lines.map((line, index) => (
          <tspan key={`${line}-${index}`} x={0} dy={index === 0 ? 0 : 14}>
            {line}
          </tspan>
        ))}
      </text>
    </g>
  );
}

type AggregateChartDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: AggregateChartPoint[];
  series: AggregateChartSeries[];
  title?: string;
  subtitle?: string;
  meta?: string;
  target?: number;
};

export function AggregateChartDialog(props: AggregateChartDialogProps) {
  const { open, onOpenChange, data, series, title, subtitle, meta, target } = props;
  const chartRef = useRef<HTMLDivElement | null>(null);

  const [chartType, setChartType] = useState<AggregateChartType>("bar");
  const gaugeAvailable = typeof target === "number" && target > 0;

  const isSexSplitSeries = useMemo(() => {
    if (series.length < 2) return false;
    const normalizedKeys = series.map((entry) => entry.key.toLowerCase());
    return normalizedKeys.includes("male") && normalizedKeys.includes("female");
  }, [series]);
  const [preferredMode, setPreferredMode] = useState<PresentationMode | null>(null);
  const barMode: PresentationMode = isSexSplitSeries ? preferredMode ?? "report" : "split";

  const reportData = useMemo<ReportChartPoint[]>(() => {
    return data.map((row) => {
      const total = series.reduce((sum, entry) => sum + toNumeric(row[entry.key]), 0);
      return {
        name: row.name,
        total,
      };
    });
  }, [data, series]);

  const grandTotal = useMemo(
    () => reportData.reduce((sum, row) => sum + row.total, 0),
    [reportData],
  );

  const seriesTotals = useMemo(
    () =>
      series.map((entry) => ({
        key: entry.key,
        label: entry.label,
        color: entry.color,
        total: data.reduce((sum, row) => sum + toNumeric(row[entry.key]), 0),
      })),
    [data, series],
  );

  const seriesChartConfig = useMemo(
    () =>
      Object.fromEntries(
        series.map((entry) => [entry.key, { label: entry.label, color: entry.color }]),
      ),
    [series],
  );

  const downloadChartSvg = () => {
    const container = chartRef.current;
    if (!container) return;
    const svg = container.querySelector("svg");
    if (!svg) return;

    const cloned = svg.cloneNode(true) as SVGSVGElement;
    if (!cloned.getAttribute("xmlns")) {
      cloned.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    }

    const serializer = new XMLSerializer();
    const svgText = serializer.serializeToString(cloned);
    const blob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `aggregates_chart_${new Date().toISOString().slice(0, 10)}.svg`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const scatterAvailable = series.length === 2;
  const resolvedChartType: AggregateChartType =
    chartType === "gauge" && !gaugeAvailable
      ? "bar"
      : chartType === "scatter" && !scatterAvailable
        ? "bar"
        : chartType;
  const showBarModeToggle = resolvedChartType === "bar" && isSexSplitSeries;
  const chartHasData = data.length > 0 && series.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] max-h-[90vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>{title || "Aggregate Totals"}</DialogTitle>
          {subtitle ? (
            <DialogDescription className="text-base text-foreground/80">
              {subtitle}
            </DialogDescription>
          ) : null}
          {meta ? (
            <div className="text-sm text-muted-foreground">{meta}</div>
          ) : null}
        </DialogHeader>

        <div className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Chart type
          </div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-4">
            {CHART_TYPE_OPTIONS.map((option) => {
              const Icon = option.icon;
              const disabled =
                (option.id === "scatter" && !scatterAvailable) ||
                (option.id === "gauge" && !gaugeAvailable);
              const active = resolvedChartType === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => setChartType(option.id)}
                  className={cn(
                    "flex items-start gap-3 rounded-lg border p-3 text-left transition-colors",
                    active
                      ? "border-primary bg-primary/5"
                      : "border-border bg-card hover:bg-muted",
                    disabled && "cursor-not-allowed opacity-50 hover:bg-card",
                  )}
                >
                  <Icon className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-foreground">{option.label}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {option.description}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          {showBarModeToggle ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant={barMode === "report" ? "default" : "outline"}
                onClick={() => setPreferredMode("report")}
              >
                Report View
              </Button>
              <Button
                type="button"
                size="sm"
                variant={barMode === "split" ? "default" : "outline"}
                onClick={() => setPreferredMode("split")}
              >
                Sex Split View
              </Button>
            </div>
          ) : (
            <div />
          )}
          <Button variant="outline" size="sm" onClick={downloadChartSvg}>
            <Download className="mr-2 h-4 w-4" />
            Download Chart
          </Button>
        </div>

        {!chartHasData ? (
          <div className="rounded-lg border border-dashed border-border p-8 text-center text-muted-foreground">
            No data available for the selected filters.
          </div>
        ) : (
          <div ref={chartRef}>
            {resolvedChartType === "bar" ? (
              barMode === "report" ? (
                <BarReportChart data={reportData} />
              ) : (
                <BarSplitChart data={data} series={series} chartConfig={seriesChartConfig} />
              )
            ) : null}

            {resolvedChartType === "stacked-bar" ? (
              <StackedBarChart data={data} series={series} chartConfig={seriesChartConfig} />
            ) : null}

            {resolvedChartType === "line" ? (
              <LineSeriesChart data={data} series={series} chartConfig={seriesChartConfig} />
            ) : null}

            {resolvedChartType === "area" ? (
              <AreaSeriesChart data={data} series={series} chartConfig={seriesChartConfig} stacked={false} />
            ) : null}

            {resolvedChartType === "stacked-area" ? (
              <AreaSeriesChart data={data} series={series} chartConfig={seriesChartConfig} stacked />
            ) : null}

            {resolvedChartType === "pie" ? <PieTotalsChart data={reportData} /> : null}

            {resolvedChartType === "single-value" ? (
              <SingleValuePanel
                grandTotal={grandTotal}
                seriesTotals={seriesTotals}
                title={title}
              />
            ) : null}

            {resolvedChartType === "gauge" && gaugeAvailable ? (
              <GaugePanel current={grandTotal} target={target!} title={title} />
            ) : null}

            {resolvedChartType === "radar" ? (
              <RadarSeriesChart data={data} series={series} chartConfig={seriesChartConfig} />
            ) : null}

            {resolvedChartType === "scatter" && scatterAvailable ? (
              <ScatterTwoSeriesChart data={data} series={series} />
            ) : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function BarReportChart({ data }: { data: ReportChartPoint[] }) {
  return (
    <div className="space-y-4">
      <ChartContainer
        config={{ total: { label: "Total", color: reportPalette[0] } }}
        className="h-[500px]"
      >
        <BarChart data={data} margin={{ top: 28, right: 20, left: 0, bottom: 56 }}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis
            dataKey="name"
            tickLine={false}
            axisLine={false}
            interval={0}
            height={88}
            tick={<WrappedTick />}
          />
          <YAxis tickLine={false} axisLine={false} />
          <ChartTooltip
            cursor={{ fill: "rgba(16, 24, 40, 0.06)" }}
            content={<ChartTooltipContent indicator="dot" />}
          />
          <Bar
            dataKey="total"
            name="Total"
            fillOpacity={0.95}
            stroke="rgba(16, 24, 40, 0.2)"
            strokeWidth={1}
            barSize={34}
            radius={[4, 4, 0, 0]}
          >
            <LabelList
              dataKey="total"
              position="top"
              offset={8}
              formatter={(value: number) => formatter.format(toNumeric(value))}
              className="fill-foreground text-[10px] font-medium"
            />
            {data.map((row, index) => (
              <Cell
                key={`${row.name}-${index}`}
                fill={reportPalette[index % reportPalette.length]}
              />
            ))}
          </Bar>
        </BarChart>
      </ChartContainer>

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full min-w-[720px] border-collapse text-xs">
          <thead>
            <tr className="bg-muted/40">
              {data.map((row) => (
                <th
                  key={`head-${row.name}`}
                  className="border px-2 py-1.5 text-left font-medium text-muted-foreground"
                >
                  {row.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              {data.map((row) => (
                <td key={`val-${row.name}`} className="border px-2 py-1.5 text-center">
                  {formatter.format(row.total)}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

type SeriesChartProps = {
  data: AggregateChartPoint[];
  series: AggregateChartSeries[];
  chartConfig: Record<string, { label: string; color: string }>;
};

function BarSplitChart({ data, series, chartConfig }: SeriesChartProps) {
  return (
    <ChartContainer config={chartConfig} className="h-[420px]">
      <BarChart data={data} margin={{ top: 10, right: 20, left: 0, bottom: 20 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="name"
          tickLine={false}
          axisLine={false}
          interval={0}
          angle={-20}
          textAnchor="end"
          height={80}
        />
        <YAxis tickLine={false} axisLine={false} />
        <ChartTooltip
          cursor={{ fill: "rgba(16, 24, 40, 0.06)" }}
          content={<ChartTooltipContent indicator="dot" />}
        />
        <ChartLegend content={<ChartLegendContent />} />
        {series.map((entry) => (
          <Bar
            key={entry.key}
            dataKey={entry.key}
            name={entry.label}
            fill={`var(--color-${entry.key})`}
            fillOpacity={0.85}
            stroke="rgba(16, 24, 40, 0.2)"
            strokeWidth={1}
            barSize={series.length === 1 ? 32 : 20}
            radius={[4, 4, 0, 0]}
          >
            <LabelList
              dataKey={entry.key}
              position="top"
              offset={6}
              formatter={(value: number) => formatter.format(toNumeric(value))}
              className="fill-foreground text-[10px] font-medium"
            />
          </Bar>
        ))}
      </BarChart>
    </ChartContainer>
  );
}

function StackedBarChart({ data, series, chartConfig }: SeriesChartProps) {
  return (
    <ChartContainer config={chartConfig} className="h-[420px]">
      <BarChart data={data} margin={{ top: 10, right: 20, left: 0, bottom: 20 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="name"
          tickLine={false}
          axisLine={false}
          interval={0}
          angle={-20}
          textAnchor="end"
          height={80}
        />
        <YAxis tickLine={false} axisLine={false} />
        <ChartTooltip
          cursor={{ fill: "rgba(16, 24, 40, 0.06)" }}
          content={<ChartTooltipContent indicator="dot" />}
        />
        <ChartLegend content={<ChartLegendContent />} />
        {series.map((entry) => (
          <Bar
            key={entry.key}
            dataKey={entry.key}
            name={entry.label}
            fill={`var(--color-${entry.key})`}
            stackId="stack"
            fillOpacity={0.9}
            stroke="rgba(16, 24, 40, 0.15)"
            strokeWidth={1}
            barSize={32}
          />
        ))}
      </BarChart>
    </ChartContainer>
  );
}

function LineSeriesChart({ data, series, chartConfig }: SeriesChartProps) {
  return (
    <ChartContainer config={chartConfig} className="h-[420px]">
      <LineChart data={data} margin={{ top: 10, right: 20, left: 0, bottom: 20 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="name"
          tickLine={false}
          axisLine={false}
          interval={0}
          angle={-20}
          textAnchor="end"
          height={80}
        />
        <YAxis tickLine={false} axisLine={false} />
        <ChartTooltip cursor={{ stroke: "rgba(16, 24, 40, 0.15)" }} content={<ChartTooltipContent indicator="dot" />} />
        <ChartLegend content={<ChartLegendContent />} />
        {series.map((entry) => (
          <Line
            key={entry.key}
            type="monotone"
            dataKey={entry.key}
            name={entry.label}
            stroke={`var(--color-${entry.key})`}
            strokeWidth={2.5}
            dot={{ r: 3 }}
            activeDot={{ r: 5 }}
          />
        ))}
      </LineChart>
    </ChartContainer>
  );
}

function AreaSeriesChart({
  data,
  series,
  chartConfig,
  stacked,
}: SeriesChartProps & { stacked: boolean }) {
  return (
    <ChartContainer config={chartConfig} className="h-[420px]">
      <AreaChart data={data} margin={{ top: 10, right: 20, left: 0, bottom: 20 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="name"
          tickLine={false}
          axisLine={false}
          interval={0}
          angle={-20}
          textAnchor="end"
          height={80}
        />
        <YAxis tickLine={false} axisLine={false} />
        <ChartTooltip cursor={{ stroke: "rgba(16, 24, 40, 0.15)" }} content={<ChartTooltipContent indicator="dot" />} />
        <ChartLegend content={<ChartLegendContent />} />
        {series.map((entry) => (
          <Area
            key={entry.key}
            type="monotone"
            dataKey={entry.key}
            name={entry.label}
            stroke={`var(--color-${entry.key})`}
            fill={`var(--color-${entry.key})`}
            fillOpacity={stacked ? 0.55 : 0.25}
            stackId={stacked ? "stack" : undefined}
          />
        ))}
      </AreaChart>
    </ChartContainer>
  );
}

function PieTotalsChart({ data }: { data: ReportChartPoint[] }) {
  const pieData = useMemo(
    () => data.filter((row) => row.total > 0),
    [data],
  );

  if (pieData.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-8 text-center text-muted-foreground">
        All totals are zero — pie chart not available.
      </div>
    );
  }

  return (
    <ChartContainer
      config={Object.fromEntries(
        pieData.map((row, index) => [
          row.name,
          { label: row.name, color: reportPalette[index % reportPalette.length] },
        ]),
      )}
      className="h-[460px]"
    >
      <PieChart>
        <ChartTooltip content={<ChartTooltipContent indicator="dot" hideLabel />} />
        <Pie
          data={pieData}
          dataKey="total"
          nameKey="name"
          innerRadius={0}
          outerRadius={160}
          paddingAngle={1}
          label={(entry: { name?: string; total?: number }) =>
            `${entry.name}: ${formatter.format(toNumeric(entry.total))}`
          }
        >
          {pieData.map((row, index) => (
            <Cell
              key={`${row.name}-${index}`}
              fill={reportPalette[index % reportPalette.length]}
              stroke="rgba(16, 24, 40, 0.15)"
            />
          ))}
        </Pie>
      </PieChart>
    </ChartContainer>
  );
}

function SingleValuePanel({
  grandTotal,
  seriesTotals,
  title,
}: {
  grandTotal: number;
  seriesTotals: { key: string; label: string; color: string; total: number }[];
  title?: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card px-6 py-12 text-center shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {title || "Grand total"}
      </div>
      <div className="mt-4 text-6xl font-semibold text-foreground tabular-nums sm:text-7xl">
        {formatter.format(grandTotal)}
      </div>
      {seriesTotals.length > 1 ? (
        <div className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
          {seriesTotals.map((entry) => (
            <div key={entry.key} className="flex items-center gap-2">
              <span
                className="inline-block h-2.5 w-2.5 rounded-sm"
                style={{ backgroundColor: entry.color }}
                aria-hidden="true"
              />
              <span className="font-medium text-foreground">{entry.label}:</span>
              <span className="tabular-nums">{formatter.format(entry.total)}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function GaugePanel({
  current,
  target,
  title,
}: {
  current: number;
  target: number;
  title?: string;
}) {
  const ratio = target > 0 ? current / target : 0;
  const clamped = Math.max(0, Math.min(1, ratio));
  const percentLabel = (ratio * 100).toFixed(0);
  const overTarget = ratio > 1;

  const size = 260;
  const stroke = 22;
  const radius = (size - stroke) / 2;
  const center = size / 2;
  const startAngle = Math.PI;
  const sweep = Math.PI;
  const endAngle = startAngle + sweep * clamped;

  const pointAt = (angle: number) => ({
    x: center + radius * Math.cos(angle),
    y: center + radius * Math.sin(angle),
  });
  const start = pointAt(startAngle);
  const bgEnd = pointAt(startAngle + sweep);
  const fgEnd = pointAt(endAngle);
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
  const arcColor = overTarget ? "#16a34a" : ratio >= 0.75 ? "#16a34a" : ratio >= 0.5 ? "#eab308" : "#dc2626";

  return (
    <div className="rounded-2xl border border-border bg-card px-6 py-10 text-center shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {title || "Performance"}
      </div>
      <div className="mt-4 flex justify-center">
        <svg width={size} height={size / 2 + stroke} viewBox={`0 0 ${size} ${size / 2 + stroke}`}>
          <path
            d={`M ${start.x} ${start.y} A ${radius} ${radius} 0 1 1 ${bgEnd.x} ${bgEnd.y}`}
            fill="none"
            stroke="hsl(var(--muted))"
            strokeWidth={stroke}
            strokeLinecap="round"
          />
          {clamped > 0 ? (
            <path
              d={`M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArc} 1 ${fgEnd.x} ${fgEnd.y}`}
              fill="none"
              stroke={arcColor}
              strokeWidth={stroke}
              strokeLinecap="round"
            />
          ) : null}
          <text
            x={center}
            y={center - 6}
            textAnchor="middle"
            className="fill-foreground"
            fontSize={42}
            fontWeight={600}
          >
            {percentLabel}%
          </text>
          <text
            x={center}
            y={center + 22}
            textAnchor="middle"
            className="fill-muted-foreground"
            fontSize={12}
          >
            of target
          </text>
        </svg>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-x-8 gap-y-1 text-sm">
        <div className="text-muted-foreground">
          <span className="font-medium text-foreground">{formatter.format(current)}</span> achieved
        </div>
        <div className="text-muted-foreground">
          target <span className="font-medium text-foreground">{formatter.format(target)}</span>
        </div>
        {overTarget ? (
          <div className="rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800 dark:bg-green-950 dark:text-green-300">
            +{formatter.format(current - target)} over target
          </div>
        ) : null}
      </div>
    </div>
  );
}

function RadarSeriesChart({ data, series, chartConfig }: SeriesChartProps) {
  return (
    <ChartContainer config={chartConfig} className="h-[460px]">
      <RadarChart data={data}>
        <PolarGrid />
        <PolarAngleAxis dataKey="name" tick={{ fontSize: 11 }} />
        <PolarRadiusAxis tick={{ fontSize: 10 }} />
        <ChartTooltip content={<ChartTooltipContent indicator="dot" />} />
        <ChartLegend content={<ChartLegendContent />} />
        {series.map((entry) => (
          <Radar
            key={entry.key}
            name={entry.label}
            dataKey={entry.key}
            stroke={`var(--color-${entry.key})`}
            fill={`var(--color-${entry.key})`}
            fillOpacity={0.25}
          />
        ))}
      </RadarChart>
    </ChartContainer>
  );
}

function ScatterTwoSeriesChart({
  data,
  series,
}: {
  data: AggregateChartPoint[];
  series: AggregateChartSeries[];
}) {
  const [xSeries, ySeries] = series;
  const scatterData = useMemo(
    () =>
      data.map((row) => ({
        name: row.name,
        x: toNumeric(row[xSeries.key]),
        y: toNumeric(row[ySeries.key]),
      })),
    [data, xSeries.key, ySeries.key],
  );

  return (
    <ChartContainer
      config={{ scatter: { label: `${xSeries.label} vs ${ySeries.label}`, color: xSeries.color } }}
      className="h-[460px]"
    >
      <ScatterChart margin={{ top: 20, right: 20, left: 0, bottom: 20 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis type="number" dataKey="x" name={xSeries.label} tickLine={false} axisLine={false} />
        <YAxis type="number" dataKey="y" name={ySeries.label} tickLine={false} axisLine={false} />
        <ZAxis type="category" dataKey="name" name="Group" />
        <ChartTooltip
          cursor={{ strokeDasharray: "3 3" }}
          content={<ChartTooltipContent indicator="dot" />}
        />
        <Scatter
          data={scatterData}
          fill={xSeries.color}
          stroke="rgba(16, 24, 40, 0.2)"
        />
      </ScatterChart>
    </ChartContainer>
  );
}
