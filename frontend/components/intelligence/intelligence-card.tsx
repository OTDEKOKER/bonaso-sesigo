"use client";

/**
 * Management IntelligenceCard — one indicator, answered five ways:
 *   1. What happened?   headline actual + trend (echarts line)
 *   2. Where?           sub-org / district breakdown (echarts bar)
 *   3. Why it matters?  pace gauge vs expected pace, delta vs prior period
 *   4. Needs attention? ranked exception badges (targets / flags / reporting)
 *   5. Action?          the single recommended management next step
 *
 * Presentational: all data comes pre-computed from the coordinator-intelligence
 * endpoint (see lib/intelligence/types). Charts render through the SESIGO echarts
 * engine so colours match the funder report and Excel export.
 */
import { useMemo } from "react";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Minus, Target } from "lucide-react";

import { EChart } from "@/components/analysis/echarts/echart";
import { paceGaugeOption, trendLineOption, whereBarOption, PACE_COLOR } from "@/components/analysis/echarts/options";
import { formatChartNumber } from "@/components/analysis/chart-theme";
import type {
  AttentionSeverity,
  CoordinatorIntelligenceCard,
} from "@/lib/intelligence/types";

const PACE_LABEL: Record<CoordinatorIntelligenceCard["paceStatus"], string> = {
  ahead: "Ahead of pace",
  on_track: "On track",
  behind: "Behind pace",
  at_risk: "At risk",
};

const SEVERITY_STYLE: Record<AttentionSeverity, string> = {
  critical: "border-[#f3c1c1] bg-[#fdf2f2] text-[#b91c1c]",
  high: "border-[#f4dfba] bg-[#fffbeb] text-[#b45309]",
  medium: "border-[#c8def2] bg-[#f0f7fd] text-[#1d5f97]",
  low: "border-[#dbe5ec] bg-[#f8fafc] text-[#475569]",
};

export function IntelligenceCard({ card }: { card: CoordinatorIntelligenceCard }) {
  const paceColor = PACE_COLOR[card.paceStatus];
  const trendOption = useMemo(() => trendLineOption(card.trend), [card.trend]);
  const whereOption = useMemo(() => whereBarOption(card.where), [card.where]);
  const gaugeOption = useMemo(
    () => paceGaugeOption(card.pctOfTarget, card.paceStatus),
    [card.pctOfTarget, card.paceStatus],
  );

  const delta = card.deltaVsPriorPct;
  const DeltaIcon = delta == null ? Minus : delta >= 0 ? ArrowUpRight : ArrowDownRight;
  const deltaColor = delta == null ? "text-[#94a3b8]" : delta >= 0 ? "text-[#15803d]" : "text-[#dc2626]";

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-border/60 bg-card shadow-sm">
      {/* header */}
      <div className="flex items-start justify-between gap-3 border-b border-border/50 bg-[linear-gradient(180deg,rgba(255,255,255,1)_0%,rgba(248,250,252,0.85)_100%)] px-5 py-4">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            {card.coordinatorName}
          </div>
          <div className="mt-0.5 truncate text-sm font-semibold text-foreground" title={card.indicatorLabel}>
            {card.indicatorLabel}
          </div>
        </div>
        <span className="shrink-0 rounded-full border border-border/60 bg-background px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
          {card.period}
        </span>
      </div>

      <div className="space-y-4 px-5 py-4">
        {/* 1 What happened + 3 Why it matters */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              What happened
            </div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-3xl font-bold tabular-nums text-foreground">
                {formatChartNumber(card.actual)}
              </span>
              {card.unit ? <span className="text-sm text-muted-foreground">{card.unit}</span> : null}
            </div>
            <div className={`mt-1 flex items-center gap-1 text-xs font-medium ${deltaColor}`}>
              <DeltaIcon className="h-3.5 w-3.5" />
              <span>
                {delta == null
                  ? "no prior period"
                  : `${delta >= 0 ? "+" : ""}${delta.toFixed(0)}% vs prior`}
              </span>
            </div>
          </div>
          <div className="text-right">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Why it matters
            </div>
            <div className="mx-auto h-[92px] w-[124px]">
              <EChart option={gaugeOption} ariaLabel={`${card.pctOfTarget}% of target`} className="h-full w-full" />
            </div>
            <div className="text-xs font-semibold" style={{ color: paceColor }}>
              {PACE_LABEL[card.paceStatus]}
            </div>
            <div className="text-[11px] text-muted-foreground">
              target {formatChartNumber(card.effectiveTarget)} · expected {Math.round(card.expectedPacePct)}%
            </div>
          </div>
        </div>

        {/* 1 trend */}
        <div className="h-[132px] w-full rounded-xl border border-border/50 bg-[#fbfdff] p-1.5">
          <EChart option={trendOption} ariaLabel="Trend" className="h-full w-full" />
        </div>

        {/* 2 Where + 4 Needs attention */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Where
            </div>
            <div className="h-[128px] w-full">
              <EChart option={whereOption} ariaLabel="Where breakdown" className="h-full w-full" />
            </div>
          </div>
          <div>
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Needs attention
            </div>
            {card.attention.length === 0 ? (
              <div className="rounded-lg border border-[#ccebd8] bg-[#f3fbf6] px-3 py-2 text-xs text-[#166534]">
                No open exceptions.
              </div>
            ) : (
              <ul className="space-y-1.5">
                {card.attention.map((item, i) => (
                  <li
                    key={`${item.source}-${i}`}
                    className={`flex items-start gap-2 rounded-lg border px-2.5 py-1.5 text-xs ${SEVERITY_STYLE[item.severity]}`}
                  >
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span className="leading-snug">{item.label}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {/* 5 Action */}
      <div className="mt-auto flex items-start gap-2.5 border-t border-border/50 bg-[#f8fafc] px-5 py-3.5">
        <Target className="mt-0.5 h-4 w-4 shrink-0 text-[#0f172a]" />
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Recommended action
          </div>
          <div className="mt-0.5 text-sm font-medium text-foreground">{card.recommendedAction}</div>
        </div>
      </div>
    </div>
  );
}
