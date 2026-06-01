import { indicatorStageLabels, targetSeriesColor, formatPercent, formatWholeNumber, wrapLabelWithoutTruncation, wrapTickLabel, actualSeriesColor } from "@/components/dashboard/engine/normalize-indicators";
import type { IndicatorStage } from "@/components/dashboard/engine/types";

export function renderCompactPieLabel({
  cx,
  cy,
  midAngle,
  outerRadius,
  payload,
}: {
  cx?: number;
  cy?: number;
  midAngle?: number;
  outerRadius?: number;
  payload?: { shortLabel?: string; share?: number };
}) {
  if (
    typeof cx !== "number" ||
    typeof cy !== "number" ||
    typeof midAngle !== "number" ||
    typeof outerRadius !== "number" ||
    !payload?.shortLabel ||
    (payload.share ?? 0) < 8
  ) {
    return null;
  }

  const radius = outerRadius * 0.62;
  const x = cx + radius * Math.cos((-midAngle * Math.PI) / 180);
  const y = cy + radius * Math.sin((-midAngle * Math.PI) / 180);

  return (
    <text
      x={x}
      y={y}
      fill="#ffffff"
      fontSize="12"
      fontWeight="600"
      textAnchor="middle"
      dominantBaseline="central"
    >
      {payload.shortLabel}
    </text>
  );
}

export function renderAngledTick({
  x = 0,
  y = 0,
  payload,
}: {
  x?: number;
  y?: number;
  payload?: { value?: string };
}) {
  const value = String(payload?.value || "");
  const lines = wrapTickLabel(value);
  return (
    <g transform={`translate(${x},${y})`}>
      <text
        dx={-8}
        dy={22}
        textAnchor="end"
        transform="rotate(-32)"
        fill="hsl(var(--muted-foreground))"
        fontSize={10}
      >
        {lines.map((line, index) => (
          <tspan key={`${line}-${index}`} x={0} dy={index === 0 ? 0 : 12}>
            {line}
          </tspan>
        ))}
      </text>
    </g>
  );
}

export function renderCenteredWrappedTick({
  x = 0,
  y = 0,
  payload,
}: {
  x?: number;
  y?: number;
  payload?: { value?: string };
}) {
  const value = String(payload?.value || "");
  const lines = wrapTickLabel(value, 14, 3);

  return (
    <g transform={`translate(${x},${y})`}>
      <text
        dy={18}
        textAnchor="middle"
        fill="hsl(var(--muted-foreground))"
        fontSize={10}
      >
        {lines.map((line, index) => (
          <tspan key={`${line}-${index}`} x={0} dy={index === 0 ? 0 : 12}>
            {line}
          </tspan>
        ))}
      </text>
    </g>
  );
}

export function renderHorizontalCategoryTick({
  x = 0,
  y = 0,
  payload,
}: {
  x?: number;
  y?: number;
  payload?: { value?: string };
}) {
  const value = String(payload?.value || "");
  const lines = wrapLabelWithoutTruncation(value, 24);
  const firstLineOffset = -((lines.length - 1) * 6);

  return (
    <g transform={`translate(${x},${y})`}>
      <text
        x={0}
        y={0}
        textAnchor="end"
        dominantBaseline="middle"
        fill="hsl(var(--muted-foreground))"
        fontSize={11}
      >
        {lines.map((line, index) => (
          <tspan key={`${line}-${index}`} x={0} dy={index === 0 ? firstLineOffset : 12}>
            {line}
          </tspan>
        ))}
      </text>
    </g>
  );
}

export function TargetReferenceMarker({
  cx,
  cy,
}: {
  cx?: number;
  cy?: number;
}) {
  if (typeof cx !== "number" || typeof cy !== "number") return null;

  return (
    <g>
      <line
        x1={cx}
        x2={cx}
        y1={cy - 12}
        y2={cy + 12}
        stroke={targetSeriesColor}
        strokeWidth={2}
        strokeLinecap="round"
      />
      <circle
        cx={cx}
        cy={cy}
        r={3.5}
        fill={targetSeriesColor}
        stroke="hsl(var(--card))"
        strokeWidth={1.5}
      />
    </g>
  );
}

export function CustomWidgetBarTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{
    payload?: {
      cleanLabel?: string;
      percentage?: number;
      stage?: IndicatorStage;
      target?: number;
      value?: number;
    };
  }>;
}) {
  if (!active || !payload?.length) return null;

  const firstItem = payload[0]?.payload;
  const cleanLabel = firstItem?.cleanLabel || "Indicator";
  const stage = firstItem?.stage;
  const stageLabel = stage ? indicatorStageLabels[stage] : null;
  const actualValue = typeof firstItem?.value === "number" ? firstItem.value : Number(firstItem?.value || 0);
  const targetValue = typeof firstItem?.target === "number" ? firstItem.target : Number(firstItem?.target || 0);
  const hasTarget = targetValue > 0;
  const progressLabel = hasTarget ? `${formatPercent(firstItem?.percentage || 0)}%` : "No target";

  return (
    <div className="min-w-[220px] rounded-2xl border border-border bg-card px-3 py-2.5 shadow-lg">
      <div className="text-sm font-semibold text-foreground">{cleanLabel}</div>
      {stageLabel ? <div className="mt-0.5 text-xs text-muted-foreground">{stageLabel}</div> : null}
      <div className="mt-2 space-y-1.5">
        <div className="flex items-center justify-between gap-4 text-xs">
          <div className="flex items-center gap-2 text-foreground">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: actualSeriesColor }} />
            <span>Actual</span>
          </div>
          <span className="font-medium text-foreground">{formatWholeNumber(actualValue)}</span>
        </div>
        <div className="flex items-center justify-between gap-4 text-xs">
          <div className="flex items-center gap-2 text-foreground">
            <span className="block h-4 w-0.5 rounded-full" style={{ backgroundColor: targetSeriesColor }} />
            <span>Target</span>
          </div>
          <span className="font-medium text-foreground">
            {hasTarget ? formatWholeNumber(targetValue) : "Not set"}
          </span>
        </div>
        <div className="flex items-center justify-between gap-4 text-xs">
          <span className="text-foreground">Progress</span>
          <span className="font-medium text-foreground">{progressLabel}</span>
        </div>
      </div>
    </div>
  );
}
