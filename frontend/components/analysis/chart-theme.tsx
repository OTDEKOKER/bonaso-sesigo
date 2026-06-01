"use client";

import type { ReactNode } from "react";
import { BarChart3 } from "lucide-react";

type TooltipEntry = {
  color?: string;
  name?: string;
  value?: string | number;
};

export type ChartDensity = "normal" | "compact";
export type ChartSizeTier = "large" | "medium" | "small";

export const ANALYTICS_CHART_THEME = {
  palette: {
    actual: "#0f766e",
    actualSoft: "#d8f3ef",
    target: "#94a3b8",
    success: "#15803d",
    warning: "#d97706",
    danger: "#dc2626",
    ink: "#0f172a",
    muted: "#64748b",
    border: "#dbe5ec",
    grid: "#edf2f7",
    surface: "#ffffff",
    surfaceAlt: "#f8fafc",
    categorical: [
      "#0f766e",
      "#2563eb",
      "#14b8a6",
      "#f59e0b",
      "#7c3aed",
      "#ea580c",
      "#0891b2",
      "#65a30d",
    ],
  },
  radius: 10,
  barSize: 22,
  stackedBarSize: 28,
  classNames: {
    chartHeight: "h-[292px] w-full sm:h-[312px]",
    panel:
      "overflow-hidden rounded-2xl border border-border/60 bg-card shadow-sm",
    panelHeader:
      "gap-1.5 border-b border-border/50 bg-[linear-gradient(180deg,rgba(255,255,255,1)_0%,rgba(248,250,252,0.85)_100%)] px-5 py-4",
    panelContent: "space-y-3.5 px-5 py-4",
  },
  axis: {
    tick: { fill: "#64748b", fontSize: 12 },
    label: { fill: "#334155", fontSize: 12 },
  },
} as const;

export function getChartHeightClass(size: ChartSizeTier, density: ChartDensity = "normal") {
  if (density === "compact") {
    if (size === "large") return "h-[250px] w-full sm:h-[270px]";
    if (size === "small") return "h-[210px] w-full sm:h-[230px]";
    return "h-[228px] w-full sm:h-[248px]";
  }

  if (size === "large") return "h-[316px] w-full sm:h-[340px]";
  if (size === "small") return "h-[236px] w-full sm:h-[256px]";
  return ANALYTICS_CHART_THEME.classNames.chartHeight;
}

export function getChartPanelClasses(density: ChartDensity = "normal") {
  return {
    panel: ANALYTICS_CHART_THEME.classNames.panel,
    header:
      density === "compact"
        ? "gap-1 border-b border-border/50 bg-[linear-gradient(180deg,rgba(255,255,255,1)_0%,rgba(248,250,252,0.85)_100%)] px-4 py-3"
        : ANALYTICS_CHART_THEME.classNames.panelHeader,
    content:
      density === "compact"
        ? "space-y-3 px-4 py-3.5"
        : ANALYTICS_CHART_THEME.classNames.panelContent,
  };
}

export function formatChartNumber(value: unknown) {
  const numeric = typeof value === "number" ? value : Number(value ?? 0);
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(
    Number.isFinite(numeric) ? numeric : 0,
  );
}

export function formatChartNumberCompact(value: unknown) {
  const numeric = typeof value === "number" ? value : Number(value ?? 0);
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(Number.isFinite(numeric) ? numeric : 0);
}

export function truncateAxisLabel(value: unknown, maxLength = 22) {
  const text = String(value ?? "");
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

export function getSeriesColor(seriesKey: string, index: number) {
  const normalized = seriesKey.toLowerCase();
  if (normalized === "male" || normalized.includes("male")) {
    return "#2563eb";
  }
  if (normalized === "female" || normalized.includes("female")) {
    return "#0f766e";
  }
  if (
    normalized === "other" ||
    normalized === "unknown" ||
    normalized.includes("unknown") ||
    normalized.includes("other")
  ) {
    return "#94a3b8";
  }
  if (normalized === "actual" || normalized.includes("actual")) {
    return ANALYTICS_CHART_THEME.palette.actual;
  }
  if (normalized === "target" || normalized.includes("target")) {
    return ANALYTICS_CHART_THEME.palette.target;
  }
  if (normalized.includes("success") || normalized.includes("complete")) {
    return ANALYTICS_CHART_THEME.palette.success;
  }
  if (normalized.includes("warning") || normalized.includes("partial")) {
    return ANALYTICS_CHART_THEME.palette.warning;
  }
  if (normalized.includes("drop") || normalized.includes("under")) {
    return ANALYTICS_CHART_THEME.palette.danger;
  }
  return ANALYTICS_CHART_THEME.palette.categorical[
    index % ANALYTICS_CHART_THEME.palette.categorical.length
  ];
}

export function shouldUseHorizontalBarLayout(
  data: Array<Record<string, string | number>>,
  xKey: string,
) {
  if (data.length <= 0) return false;
  const longestLabel = data.reduce((max, row) => {
    const label = String(row[xKey] ?? "");
    return Math.max(max, label.length);
  }, 0);
  return longestLabel > 16 || data.length > 7;
}

export function ExecutiveTooltip(props: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string | number;
}) {
  const { active, payload, label } = props;
  if (!active || !payload || payload.length === 0) return null;

  return (
    <div className="min-w-[180px] rounded-2xl border border-[#dbe5ec] bg-white px-3.5 py-3 shadow-[0_14px_32px_rgba(15,23,42,0.12)]">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#64748b]">
        {label}
      </div>
      <div className="mt-2.5 space-y-1.5">
        {payload.map((entry) => (
          <div
            key={`${entry.name}-${entry.value}`}
            className="flex items-center gap-2.5 text-sm text-[#0f172a]"
          >
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: entry.color || ANALYTICS_CHART_THEME.palette.muted }}
            />
            <span className="flex-1 text-[#334155]">{entry.name}</span>
            <span className="font-semibold tabular-nums text-[#0f172a]">
              {formatChartNumber(entry.value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ExecutiveLegend(props: {
  payload?: Array<{ color?: string; value?: string }>;
}) {
  const payload = props.payload || [];
  if (payload.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-1 pb-1">
      {payload.map((entry) => (
        <div
          key={`${entry.value}-${entry.color}`}
          className="flex items-center gap-2 text-xs font-medium text-[#475569]"
        >
          <span
            className="h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: entry.color || ANALYTICS_CHART_THEME.palette.muted }}
          />
          <span>{entry.value}</span>
        </div>
      ))}
    </div>
  );
}

export function ChartSectionStat(props: {
  label: string;
  value: string;
  tone?: "default" | "success" | "warning";
}) {
  const { label, value, tone = "default" } = props;
  const toneClasses =
    tone === "success"
      ? "border-[#ccebd8] bg-[#f3fbf6] text-[#166534]"
      : tone === "warning"
        ? "border-[#f4dfba] bg-[#fffbeb] text-[#b45309]"
        : "border-[#dbe5ec] bg-[#f8fafc] text-[#0f172a]";

  return (
    <div className={`rounded-full border px-3 py-2 ${toneClasses}`}>
      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] opacity-70">
        {label}
      </div>
      <div className="mt-0.5 text-sm font-semibold tabular-nums">{value}</div>
    </div>
  );
}

export function ChartInsightFooter(props: { children?: ReactNode; text?: string | null }) {
  const content = props.children ?? props.text;
  if (!content) return null;

  return (
    <div className="rounded-[1rem] border border-[#dbe5ec] bg-[#f8fafc] px-3.5 py-2.5 text-sm text-[#475569]">
      {content}
    </div>
  );
}

export function AnalyticsEmptyState(props: {
  title: string;
  message: string;
  compact?: boolean;
}) {
  const { title, message, compact = false } = props;

  return (
    <div
      className={`flex items-center justify-center rounded-2xl border border-dashed border-border/70 bg-[linear-gradient(180deg,rgba(255,255,255,1)_0%,rgba(248,250,252,0.88)_100%)] px-6 text-center ${
        compact ? "min-h-[220px]" : "min-h-[300px]"
      }`}
    >
      <div className="max-w-md space-y-2.5">
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full border border-border/70 bg-background text-muted-foreground">
          <BarChart3 className="h-5 w-5" />
        </div>
        <div className="text-base font-semibold text-foreground">{title}</div>
        <div className="text-sm leading-6 text-muted-foreground">{message}</div>
      </div>
    </div>
  );
}
