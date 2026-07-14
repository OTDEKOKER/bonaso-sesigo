"use client";

import { useCallback, useMemo, useState, type ComponentType } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, CircleHelp, Clock3 } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AddCardTile } from "@/components/dashboard/components/add-card-tile";
import { DashboardPanel } from "@/components/dashboard/components/dashboard-panel";
import { CustomWidgetShell } from "@/components/dashboard/components/widget-shell";
import {
  type ActivityItem,
  type DashboardAggregateFilterContext,
  type DashboardChartPreferences,
  type DashboardCustomWidget,
  type DashboardCustomWidgetType,
  DASHBOARD_CUSTOM_WIDGET_STYLE_OPTIONS,
  DEFAULT_DASHBOARD_CUSTOM_WIDGET_TYPE,
  parseDashboardCustomWidgetType,
  type QuickLink,
  type SummaryCard,
  type UpdatesTab,
} from "@/components/dashboard/engine/types";
import {
  actualSeriesColor,
  clamp,
  formatCompactNumber,
  formatWholeNumber,
  getCustomWidgetSubtitle,
  renderBarValueLabel,
  targetSeriesColor,
  toSafeNumber,
} from "@/components/dashboard/engine/normalize-indicators";
import { DashboardWidgetRenderer } from "@/components/dashboard/widgets/widget-registry";
import { MetricBarsPanel } from "@/components/dashboard/widgets/indicator-progress-widget";
import { renderCenteredWrappedTick, renderHorizontalCategoryTick } from "@/components/dashboard/widgets/shared-chart-utils";
import { MessageAnalyticsDashboard } from "@/components/dashboard/message-analytics/message-analytics-dashboard";
import type { Project, ProjectDeadline } from "@/lib/types";
import type { ScreeningDashboardInsights } from "@/lib/dashboard/screening-insights";
import { cn } from "@/lib/utils";

export type { ScreeningDashboardInsights } from "@/lib/dashboard/screening-insights";
export {
  DASHBOARD_CUSTOM_WIDGET_STYLE_OPTIONS,
  DEFAULT_DASHBOARD_CUSTOM_WIDGET_TYPE,
  parseDashboardCustomWidgetType,
};
export type {
  DashboardAggregateFilterContext,
  DashboardChartPreferences,
  DashboardCustomWidget,
  DashboardCustomWidgetType,
} from "@/components/dashboard/engine/types";

export type DashboardAggregateReviewSnapshot = {
  approved: number;
  pendingReview: number;
  mismatches: number;
};

interface DashboardExecutiveBoardProps {
  activeProjects: Project[];
  activeUpdatesTab: UpdatesTab;
  aggregateReviewSnapshot?: DashboardAggregateReviewSnapshot;
  aggregateFilterContext?: DashboardAggregateFilterContext;
  chartPreferences: DashboardChartPreferences;
  customWidgets: DashboardCustomWidget[];
  customWidgetMetricsById: Record<string, ScreeningDashboardInsights["indicatorMetrics"]>;
  messageAnalyticsRows: Array<Record<string, number | string>>;
  messageAnalyticsSeries: Array<{ color: string; key: string; label: string }>;
  messageAnalyticsIsLoading: boolean;
  messageAnalyticsHasError: boolean;
  recentActivity: ActivityItem[];
  deadlines: ProjectDeadline[];
  screeningInsights: ScreeningDashboardInsights;
  showFavoritesPanel: boolean;
  showSpotlightPanel: boolean;
  showSummaryStrip: boolean;
  showUpdatesBoard: boolean;
  visibleQuickLinks: QuickLink[];
  visibleSummaryCards: SummaryCard[];
  onActiveUpdatesTabChange: (tab: UpdatesTab) => void;
  onDeleteCustomWidget: (widgetId: string) => void;
  onEditCustomWidget: (widgetId: string) => void;
  onOpenCustomizeDashboard: () => void;
  onConfigureServicePathways?: () => void;
}

const MS_PER_DAY = 1000 * 60 * 60 * 24;
const deadlineSliceCount = 20;
const chartLikeCustomWidgetTypes = new Set<DashboardCustomWidgetType>([
  "indicator-column-chart",
  "indicator-bar-chart",
  "indicator-line-chart",
  "indicator-stacked-bar-chart",
  "indicator-doughnut-chart",
  "indicator-pie-chart",
]);
const EMPTY_MESSAGE_TYPE_BY_CSO = { rows: [], series: [] } as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isRenderableIcon(value: unknown): value is ComponentType<{ className?: string }> {
  return typeof value === "function";
}

function shortenLabel(name: string, _code?: string | null) {
  const words = name.trim().split(/\s+/).slice(0, 2);
  return words.join(" ");
}

function formatMonthDay(value?: string | null) {
  if (!value) return "No date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No date";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(date);
}

function formatFullDate(value?: string | null) {
  if (!value) return "No date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No date";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function formatRelativeDate(value?: string | null) {
  if (!value) return "No timestamp";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No timestamp";

  const diffInHours = Math.round((Date.now() - date.getTime()) / (1000 * 60 * 60));
  if (diffInHours < 1) return "Less than 1 hour";
  if (diffInHours < 24) return `${diffInHours}h ago`;

  const diffInDays = Math.round(diffInHours / 24);
  if (diffInDays < 7) return `${diffInDays}d ago`;

  return formatMonthDay(value);
}

function getDaysUntil(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Math.ceil((date.getTime() - Date.now()) / MS_PER_DAY);
}

function getProjectMetrics(project: Project) {
  const explicitProgress =
    typeof project.progress_percentage === "number" && Number.isFinite(project.progress_percentage)
      ? clamp(project.progress_percentage, 0, 100)
      : null;

  const startTime = new Date(project.start_date).getTime();
  const endTime = new Date(project.end_date).getTime();

  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime <= startTime) {
    return {
      daysRemaining: null as number | null,
      durationDays: null as number | null,
      scheduleProgress: explicitProgress ?? 0,
    };
  }

  const durationDays = Math.max(1, Math.ceil((endTime - startTime) / MS_PER_DAY));
  const elapsedDays = clamp(Math.ceil((Date.now() - startTime) / MS_PER_DAY), 0, durationDays);
  const derivedProgress = Math.round((elapsedDays / durationDays) * 100);
  const daysRemaining = Math.ceil((endTime - Date.now()) / MS_PER_DAY);

  return {
    daysRemaining,
    durationDays,
    scheduleProgress: explicitProgress ?? clamp(derivedProgress, 0, 100),
  };
}

function getDeadlineBadgeClass(daysUntil: number | null) {
  if (daysUntil === null) return "border border-border bg-card text-muted-foreground";
  if (daysUntil < 0) return "border border-destructive/30 bg-destructive/10 text-destructive";
  if (daysUntil <= 7) return "border border-warning/40 bg-warning/10 text-warning-foreground";
  if (daysUntil <= 30) return "border border-primary/30 bg-primary/10 text-foreground";
  return "border border-border bg-card text-muted-foreground";
}

function formatProgressPercent(value: number) {
  if (!Number.isFinite(value)) return "0";
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  });
}

function ServicePathwayCardsPanel({
  hasError,
  isLoading,
  items,
  onEditData,
}: {
  hasError: boolean;
  isLoading: boolean;
  items: ScreeningDashboardInsights["servicePathways"];
  onEditData?: () => void;
}) {
  const [activePathwayId, setActivePathwayId] = useState<string | null>(null);
  const [selectedStageByPathway, setSelectedStageByPathway] = useState<Record<string, string>>({});
  const normalizedItems = useMemo(() => {
    const rawItems = Array.isArray(items) ? (items as Array<unknown>) : [];
    return rawItems
      .filter(isRecord)
      .map((item, itemIndex) => {
        const fallbackId =
          typeof item.id === "string" && item.id.trim() ? item.id : `pathway-${itemIndex}`;
        const rawStages = Array.isArray(item.stages) ? item.stages : [];
        const rawIndicatorDetails = Array.isArray(item.indicatorDetails) ? item.indicatorDetails : [];

        return {
          id: fallbackId,
          indicatorDetails: rawIndicatorDetails.filter(isRecord).map((detail, detailIndex) => ({
            code: typeof detail.code === "string" ? detail.code : "",
            name: typeof detail.name === "string" && detail.name.trim() ? detail.name : "Indicator",
            stageId:
              typeof detail.stageId === "string" && detail.stageId.trim()
                ? detail.stageId
                : `stage-${detailIndex}`,
            stageLabel:
              typeof detail.stageLabel === "string" && detail.stageLabel.trim()
                ? detail.stageLabel
                : "Other",
            value: toSafeNumber(detail.value),
          })),
          stages: rawStages.filter(isRecord).map((stage, stageIndex) => ({
            color: typeof stage.color === "string" && stage.color.trim() ? stage.color : "#64748B",
            id:
              typeof stage.id === "string" && stage.id.trim()
                ? stage.id
                : `${fallbackId}-stage-${stageIndex}`,
            label:
              typeof stage.label === "string" && stage.label.trim()
                ? stage.label
                : `Stage ${stageIndex + 1}`,
            value: toSafeNumber(stage.value),
            target: toSafeNumber(stage.target),
          })),
          title: typeof item.title === "string" && item.title.trim() ? item.title : "Pathway",
          total: toSafeNumber(item.total),
        };
      });
  }, [items]);
  const activePathway = normalizedItems.find((item) => item.id === activePathwayId) || null;
  const selectedStageFilter = activePathway ? selectedStageByPathway[activePathway.id] || "all" : "all";
  const visibleIndicatorDetails = useMemo(() => {
    if (!activePathway) return [];
    const filtered =
      selectedStageFilter === "all"
        ? activePathway.indicatorDetails
        : activePathway.indicatorDetails.filter((item) => item.stageId === selectedStageFilter);
    return [...filtered].sort((left, right) => right.value - left.value);
  }, [activePathway, selectedStageFilter]);

  return (
    <>
      <DashboardPanel
        eyebrow="Pathways"
        title="Service pathway cards"
        actions={
          onEditData ? (
            <Button
              type="button"
              variant="outline"
              className="border-border bg-background text-foreground hover:bg-muted"
              onClick={onEditData}
            >
              Configure
            </Button>
          ) : undefined
        }
      >
        {isLoading ? (
          <div className="rounded-xl border border-dashed border-border bg-muted/20 px-4 py-8 text-sm text-muted-foreground">
            Loading service pathway cards.
          </div>
        ) : hasError ? (
          <div className="rounded-xl border border-dashed border-border bg-muted/20 px-4 py-8 text-sm text-muted-foreground">
            Service pathway cards are temporarily unavailable.
          </div>
        ) : normalizedItems.every((item) => item.total === 0) ? (
          <div className="rounded-xl border border-dashed border-border bg-muted/20 px-4 py-8 text-sm text-muted-foreground">
            No service pathways configured yet. Use <span className="font-medium text-foreground">Configure</span>{" "}
            to choose the indicators for each pathway stage.
          </div>
        ) : (
          <div className="grid min-w-0 w-full max-w-full grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {normalizedItems.map((item) => {
              const maxStageValue = Math.max(...item.stages.map((stage) => stage.value), 1);
              return (
                <div
                  key={item.id}
                  className="min-w-0 overflow-hidden rounded-2xl border border-border bg-card p-4 shadow-sm"
                >
                  <div className="mb-4 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="min-w-0 break-words text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                        {item.title}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-9 w-9 shrink-0 rounded-full border-border bg-card text-muted-foreground hover:bg-muted"
                      onClick={() => setActivePathwayId(item.id)}
                    >
                      <CircleHelp className="h-4 w-4" />
                    </Button>
                  </div>

                  <div className="space-y-3">
                    {item.stages.map((stage) => {
                      // With a target, the bar shows progress toward it (actual/target);
                      // otherwise it falls back to relative-to-largest-stage sizing.
                      const width =
                        stage.target > 0
                          ? clamp(Math.round((stage.value / stage.target) * 100), 0, 100)
                          : stage.value <= 0
                            ? 0
                            : clamp(Math.round((stage.value / maxStageValue) * 100), 0, 100);
                      return (
                        <div key={`${item.id}-${stage.label}`} className="space-y-1.5">
                          <div className="flex items-center justify-between gap-3 text-xs">
                            <span className="min-w-0 break-words font-medium text-foreground">{stage.label}</span>
                            <span className="shrink-0 text-muted-foreground">
                              {stage.target > 0
                                ? `${formatWholeNumber(stage.value)} / ${formatWholeNumber(stage.target)}`
                                : formatWholeNumber(stage.value)}
                            </span>
                          </div>
                          <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full max-w-full rounded-full"
                              style={{ width: `${Math.min(width, 100)}%`, backgroundColor: stage.color }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </DashboardPanel>

      <Dialog open={Boolean(activePathway)} onOpenChange={(open) => !open && setActivePathwayId(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{activePathway ? `${activePathway.title} pathway details` : "Pathway details"}</DialogTitle>
            <DialogDescription>
              Review the full matched indicator names behind this card and filter them by stage.
            </DialogDescription>
          </DialogHeader>

          {activePathway ? (
            <div className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-[220px_minmax(0,1fr)] sm:items-end">
                <div className="space-y-2">
                  <Label htmlFor="pathway-stage-filter">Stage filter</Label>
                  <Select
                    value={selectedStageFilter}
                    onValueChange={(value) =>
                      setSelectedStageByPathway((current) => ({
                        ...current,
                        [activePathway.id]: value,
                      }))
                    }
                  >
                    <SelectTrigger id="pathway-stage-filter">
                      <SelectValue placeholder="All stages" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All stages</SelectItem>
                      {activePathway.stages.map((stage) => (
                        <SelectItem key={`${activePathway.id}-${stage.id}`} value={stage.id}>
                          {stage.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="rounded-xl border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
                  Total matched indicators: {formatWholeNumber(visibleIndicatorDetails.length)}
                </div>
              </div>

              <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2">
                {activePathway.stages.map((stage) => (
                  <div key={`${activePathway.id}-summary-${stage.id}`} className="min-w-0 overflow-hidden rounded-xl border border-border bg-card px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-medium text-foreground">{stage.label}</span>
                      <span className="text-sm text-muted-foreground">{formatWholeNumber(stage.value)}</span>
                    </div>
                  </div>
                ))}
              </div>

              <ScrollArea className="max-h-[45vh] rounded-xl border border-border">
                <div className="divide-y divide-border">
                  {visibleIndicatorDetails.length === 0 ? (
                    <div className="px-4 py-6 text-sm text-muted-foreground">No indicators matched this filter.</div>
                  ) : (
                    visibleIndicatorDetails.map((indicator, index) => (
                      <div key={`${indicator.stageId}-${indicator.code}-${index}`} className="px-4 py-4">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                              {indicator.stageLabel}
                            </p>
                            <p className="mt-1 text-sm font-medium text-foreground">
                              {indicator.name}
                            </p>
                          </div>
                          <div className="text-right text-sm text-muted-foreground">
                            {formatWholeNumber(indicator.value)}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function HivTestingComparisonPiePanel({
  items,
}: {
  items: ScreeningDashboardInsights["hivTestingComparison"];
}) {
  const normalizedItems = useMemo(
    () =>
      (Array.isArray(items) ? (items as Array<unknown>) : [])
        .filter(isRecord)
        .map((entry, index) => ({
          actual: toSafeNumber(entry.actual),
          label: typeof entry.label === "string" && entry.label.trim() ? entry.label : `Entry ${index + 1}`,
          target: toSafeNumber(entry.target),
        })),
    [items],
  );

  return (
    <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">
      {normalizedItems.map((entry) => {
        const hasTarget = entry.target > 0;
        const hasActual = entry.actual > 0;
        const exceededBy = hasTarget && entry.actual > entry.target ? entry.actual - entry.target : 0;
        const progressPercent = hasTarget ? (entry.actual / entry.target) * 100 : null;
        const normalizedProgress = hasTarget ? clamp(entry.actual / entry.target, 0, 1) : hasActual ? 1 : 0;
        const centerLabel = hasTarget ? `${formatProgressPercent(progressPercent || 0)}%` : hasActual ? "Actual" : "No data";
        const centerCaption = hasTarget ? "to target" : hasActual ? "reported" : "waiting";
        const pieData =
          normalizedProgress > 0
            ? [
                { key: "actual", value: normalizedProgress, color: actualSeriesColor },
                ...(normalizedProgress < 1
                  ? [{ key: "remaining", value: 1 - normalizedProgress, color: targetSeriesColor }]
                  : []),
              ]
            : [{ key: "remaining", value: 1, color: targetSeriesColor }];

        return (
          <div key={entry.label} className="h-full min-w-0 overflow-hidden rounded-2xl border border-border bg-card p-4 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              {entry.label}
            </div>
            <div className="mt-3 grid min-w-0 gap-4 2xl:grid-cols-2 2xl:items-center">
              <div className="min-w-0 w-full">
                <div className="mx-auto aspect-square w-full min-w-0 max-w-[240px] overflow-hidden">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart aria-label={`${entry.label} pie chart`} role="img">
                      <Pie
                        data={pieData}
                        dataKey="value"
                        nameKey="key"
                        cx="50%"
                        cy="50%"
                        innerRadius={0}
                        outerRadius="80%"
                        paddingAngle={pieData.length > 1 ? 2 : 0}
                        stroke="hsl(var(--card))"
                        strokeWidth={2}
                      >
                        {pieData.map((slice) => (
                          <Cell key={slice.key} fill={slice.color} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-3 text-center">
                  <div className="text-2xl font-semibold text-foreground">{centerLabel}</div>
                  <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{centerCaption}</div>
                </div>
              </div>
              <div className="min-w-0 w-full space-y-3">
                <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-3 py-2.5">
                  <div className="flex items-center gap-2 text-sm text-foreground">
                    <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: actualSeriesColor }} />
                    <span>Actual</span>
                  </div>
                  <span className="text-sm text-muted-foreground">{formatWholeNumber(entry.actual)}</span>
                </div>
                <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-3 py-2.5">
                  <div className="flex items-center gap-2 text-sm text-foreground">
                    <span className="block h-4 w-0.5 rounded-full" style={{ backgroundColor: targetSeriesColor }} />
                    <span>Target</span>
                  </div>
                  <span className="text-sm text-muted-foreground">
                    {hasTarget ? formatWholeNumber(entry.target) : "Not set"}
                  </span>
                </div>
                {exceededBy > 0 ? (
                  <div className="rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-muted-foreground">
                    Exceeded target by {formatWholeNumber(exceededBy)}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function HivPreventionMessagesByCsoPanel({
  hasError,
  isLoading,
  items,
  onEditData,
}: {
  hasError: boolean;
  isLoading: boolean;
  items: ScreeningDashboardInsights["hivPreventionMessagesByCso"];
  onEditData?: (csoLabel?: string) => void;
}) {
  const [csoFilter, setCsoFilter] = useState("all");
  const [legendFilter, setLegendFilter] = useState<"both" | "achieved" | "target">("both");
  const normalizedItems = useMemo(
    () =>
      (Array.isArray(items) ? (items as Array<unknown>) : [])
        .filter(isRecord)
        .map((item, index) => ({
          label: typeof item.label === "string" && item.label.trim() ? item.label : `CSO ${index + 1}`,
          target: toSafeNumber(item.target),
          value: toSafeNumber(item.value),
        })),
    [items],
  );
  const showAchieved = legendFilter === "both" || legendFilter === "achieved";
  const showTarget = legendFilter === "both" || legendFilter === "target";
  const hasData = normalizedItems.some((item) => item.value > 0 || item.target > 0);
  const chartRows = useMemo(
    () =>
      normalizedItems.map((item) => ({
        achieved: toSafeNumber(item.value),
        cso: item.label,
        target: toSafeNumber(item.target),
      })),
    [normalizedItems],
  );
  const csoOptions = useMemo(
    () => chartRows.map((row) => String(row.cso || "")).filter((value) => value.trim().length > 0),
    [chartRows],
  );
  const effectiveCsoFilter = csoOptions.includes(csoFilter) ? csoFilter : "all";
  const filteredChartRows = useMemo(
    () =>
      effectiveCsoFilter === "all"
        ? chartRows
        : chartRows.filter((row) => String(row.cso) === effectiveCsoFilter),
    [chartRows, effectiveCsoFilter],
  );
  const hasFilteredData = filteredChartRows.some((row) => row.achieved > 0 || row.target > 0);
  const yAxisMax = useMemo(
    () =>
      Math.max(
        1,
        ...filteredChartRows.map((row) => Math.max(showAchieved ? row.achieved : 0, showTarget ? row.target : 0)),
      ),
    [filteredChartRows, showAchieved, showTarget],
  );

  return (
    <DashboardPanel
      actions={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <div className="w-[220px]">
            <Select value={effectiveCsoFilter} onValueChange={setCsoFilter}>
              <SelectTrigger aria-label="Filter CSO">
                <SelectValue placeholder="All CSOs" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All CSOs</SelectItem>
                {csoOptions.map((csoName) => (
                  <SelectItem key={`filter-${csoName}`} value={csoName}>
                    {csoName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-[170px]">
            <Select
              value={legendFilter}
              onValueChange={(value) =>
                setLegendFilter(value === "achieved" || value === "target" ? value : "both")
              }
            >
              <SelectTrigger aria-label="Filter legend">
                <SelectValue placeholder="Legend" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="both">Legend: Both</SelectItem>
                <SelectItem value="achieved">Legend: Actual</SelectItem>
                <SelectItem value="target">Legend: Target</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {onEditData ? (
            <Button
              type="button"
              variant="outline"
              className="border-border bg-background text-foreground hover:bg-muted"
              onClick={() => onEditData(effectiveCsoFilter === "all" ? undefined : effectiveCsoFilter)}
            >
              Edit Data
            </Button>
          ) : null}
        </div>
      }
      eyebrow="HIV Prevention Messages"
      title="Number of People Reached with HIV Messages Against Targets by CSO"
    >
      {isLoading ? (
        <div className="rounded-xl border border-dashed border-border bg-muted/20 px-4 py-8 text-sm text-muted-foreground">
          Loading HIV prevention messaging coverage by CSO.
        </div>
      ) : hasError ? (
        <div className="rounded-xl border border-dashed border-border bg-muted/20 px-4 py-8 text-sm text-muted-foreground">
          HIV prevention messaging coverage by CSO is temporarily unavailable.
        </div>
      ) : !hasData ? (
        <div className="rounded-xl border border-dashed border-border bg-muted/20 px-4 py-8 text-sm text-muted-foreground">
          CSO actual and target values will appear once HIV prevention messaging data is available.
        </div>
      ) : !hasFilteredData ? (
        <div className="rounded-xl border border-dashed border-border bg-muted/20 px-4 py-8 text-sm text-muted-foreground">
          No actual/target values are available for the selected CSO.
        </div>
      ) : (
        <div className="min-w-0 w-full max-w-full space-y-2">
          <div className="h-[320px] w-full min-w-0 overflow-hidden">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={filteredChartRows}
                margin={{ top: 10, right: 14, left: 8, bottom: 54 }}
                barCategoryGap="28%"
              >
                <CartesianGrid vertical={false} stroke="hsl(var(--border) / 0.42)" />
                <XAxis
                  axisLine={false}
                  dataKey="cso"
                  height={74}
                  tick={renderCenteredWrappedTick}
                  tickLine={false}
                />
                <YAxis
                  allowDecimals={false}
                  axisLine={false}
                  domain={[0, Math.ceil(yAxisMax * 1.15)]}
                  tickFormatter={(value: number) => formatWholeNumber(value)}
                  tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
                  tickLine={false}
                  width={90}
                  label={{
                    angle: -90,
                    fill: "hsl(var(--muted-foreground))",
                    position: "insideLeft",
                    style: { textAnchor: "middle" },
                    value: "No of People",
                  }}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "16px",
                    color: "hsl(var(--foreground))",
                  }}
                  formatter={(
                    value: number,
                    name: string,
                    item: { dataKey?: string | number },
                  ) => {
                    const dataKey = String(item?.dataKey || "");
                    const seriesLabel =
                      dataKey === "achieved" ? "Actual" : dataKey === "target" ? "Target" : name;
                    return [formatWholeNumber(Number(value)), seriesLabel];
                  }}
                  labelFormatter={(label) => String(label || "CSO")}
                />
                {showAchieved ? (
                  <Bar
                    dataKey="achieved"
                    fill="#4F81BD"
                    name="Actual"
                    radius={[6, 6, 0, 0]}
                    maxBarSize={48}
                  />
                ) : null}
                {showTarget ? (
                  <Bar
                    dataKey="target"
                    fill="#ED7D31"
                    name="Target"
                    radius={[6, 6, 0, 0]}
                    maxBarSize={48}
                  />
                ) : null}
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="w-full max-w-full overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  <th className="sticky left-0 z-10 min-w-[160px] bg-muted/40 px-3 py-2 text-left">Series</th>
                  {filteredChartRows.map((row) => (
                    <th
                      key={`cso-header-${row.cso}`}
                      className="min-w-[140px] px-3 py-2 text-center leading-snug whitespace-normal break-words"
                    >
                      {row.cso}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {showAchieved ? (
                  <tr className={showTarget ? "border-b border-border" : ""}>
                    <th className="sticky left-0 z-10 min-w-[160px] bg-card px-3 py-2 text-left font-medium text-foreground">
                      <span className="inline-flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: "#4F81BD" }} />
                        <span>Actual</span>
                      </span>
                    </th>
                    {filteredChartRows.map((row) => (
                      <td
                        key={`achieved-${row.cso}`}
                        className="min-w-[140px] px-3 py-2 text-center tabular-nums whitespace-nowrap text-muted-foreground"
                      >
                        {formatWholeNumber(row.achieved)}
                      </td>
                    ))}
                  </tr>
                ) : null}
                {showTarget ? (
                  <tr>
                    <th className="sticky left-0 z-10 min-w-[160px] bg-card px-3 py-2 text-left font-medium text-foreground">
                      <span className="inline-flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: "#ED7D31" }} />
                        <span>Target</span>
                      </span>
                    </th>
                    {filteredChartRows.map((row) => (
                      <td
                        key={`target-${row.cso}`}
                        className="min-w-[140px] px-3 py-2 text-center tabular-nums whitespace-nowrap text-muted-foreground"
                      >
                        {formatWholeNumber(row.target)}
                      </td>
                    ))}
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-4 text-xs text-muted-foreground">
            {showAchieved ? (
              <span className="inline-flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: "#4F81BD" }} />
                <span>Actual</span>
              </span>
            ) : null}
            {showTarget ? (
              <span className="inline-flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: "#ED7D31" }} />
                <span>Target</span>
              </span>
            ) : null}
          </div>
        </div>
      )}
    </DashboardPanel>
  );
}

function NcdMessagesDisaggregatePanel({
  hasError,
  isLoading,
  items,
  onEditData,
}: {
  hasError: boolean;
  isLoading: boolean;
  items: ScreeningDashboardInsights["ncdMessageDisaggregates"];
  onEditData?: () => void;
}) {
  const isTotalLikeLabel = useCallback((label: string) => {
    const normalized = String(label || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
    if (!normalized) return false;
    return (
      normalized === "total" ||
      normalized === "totals" ||
      normalized === "overall" ||
      normalized === "value" ||
      normalized === "values" ||
      normalized.startsWith("total ")
    );
  }, []);

  const normalizedItems = useMemo(
    () =>
      (Array.isArray(items) ? items : [])
        .filter((item) => Boolean(item?.label))
        .map((item) => ({
          color: item.color || "#64748B",
          label: item.label,
          value: toSafeNumber(item.value),
        }))
        .filter((item) => item.value > 0 && !isTotalLikeLabel(item.label)),
    [items, isTotalLikeLabel],
  );
  const chartHeight = Math.max(320, normalizedItems.length * 34);
  const hasData = normalizedItems.length > 0;

  return (
    <DashboardPanel
      actions={
        onEditData ? (
          <Button
            type="button"
            variant="outline"
            className="border-border bg-background text-foreground hover:bg-muted"
            onClick={onEditData}
          >
            Edit Data
          </Button>
        ) : null
      }
      eyebrow="NCD Messages"
      title="NCD messages by disaggregate"
      subtitle="Legend entries correspond to disaggregate categories"
    >
      {isLoading ? (
        <div className="rounded-xl border border-dashed border-border bg-muted/20 px-4 py-8 text-sm text-muted-foreground">
          Loading NCD message disaggregates.
        </div>
      ) : hasError ? (
        <div className="rounded-xl border border-dashed border-border bg-muted/20 px-4 py-8 text-sm text-muted-foreground">
          NCD message disaggregates are temporarily unavailable.
        </div>
      ) : !hasData ? (
        <div className="rounded-xl border border-dashed border-border bg-muted/20 px-4 py-8 text-sm text-muted-foreground">
          NCD disaggregate values will appear once matching aggregates are available.
        </div>
      ) : (
        <div className="space-y-4">
          <div className="w-full min-w-0 overflow-hidden" style={{ height: chartHeight }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={normalizedItems}
                layout="vertical"
                margin={{ top: 8, right: 44, left: 24, bottom: 8 }}
                barCategoryGap="24%"
              >
                <CartesianGrid horizontal={false} stroke="hsl(var(--border) / 0.55)" />
                <XAxis
                  type="number"
                  allowDecimals={false}
                  domain={[0, (dataMax: number) => Math.max(10, Math.ceil(dataMax * 1.12))]}
                  tickCount={5}
                  tickFormatter={(value: number) => formatWholeNumber(value)}
                  tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  type="category"
                  dataKey="label"
                  width={236}
                  interval={0}
                  tick={renderHorizontalCategoryTick}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  cursor={false}
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "14px",
                    color: "hsl(var(--foreground))",
                  }}
                  formatter={(value: number) => [formatWholeNumber(value), "People reached"]}
                  labelFormatter={(label) => String(label || "Disaggregate")}
                />
                <Bar dataKey="value" radius={[0, 10, 10, 0]} maxBarSize={28} minPointSize={4}>
                  {normalizedItems.map((entry) => (
                    <Cell key={`ncd-disaggregate-${entry.label}`} fill={entry.color} />
                  ))}
                  <LabelList
                    dataKey="value"
                    position="right"
                    formatter={renderBarValueLabel}
                    fill="hsl(var(--foreground))"
                    fontSize={11}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="rounded-xl border border-border bg-card px-3 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Legend (Disaggregates)
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {normalizedItems.map((entry) => (
                <div
                  key={`ncd-disaggregate-legend-${entry.label}`}
                  className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs text-foreground"
                >
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: entry.color }} />
                  <span>{entry.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </DashboardPanel>
  );
}

export function DashboardExecutiveBoard({
  activeProjects,
  activeUpdatesTab,
  aggregateFilterContext,
  chartPreferences,
  customWidgets,
  customWidgetMetricsById,
  messageAnalyticsRows,
  messageAnalyticsSeries,
  messageAnalyticsIsLoading,
  messageAnalyticsHasError,
  deadlines,
  onActiveUpdatesTabChange,
  onDeleteCustomWidget,
  onEditCustomWidget,
  onOpenCustomizeDashboard,
  onConfigureServicePathways,
  recentActivity,
  screeningInsights,
  showFavoritesPanel,
  showSpotlightPanel,
  showSummaryStrip,
  showUpdatesBoard,
  visibleQuickLinks,
  visibleSummaryCards,
}: DashboardExecutiveBoardProps) {
  const router = useRouter();
  const safeChartPreferences: DashboardChartPreferences = useMemo(
    () => ({
      pathwayStyle:
        chartPreferences?.pathwayStyle === "pie" || chartPreferences?.pathwayStyle === "donut"
          ? chartPreferences.pathwayStyle
          : "donut",
      showTrendLegend:
        typeof chartPreferences?.showTrendLegend === "boolean"
          ? chartPreferences.showTrendLegend
          : true,
      trendLayout: chartPreferences?.trendLayout === "stacked" ? "stacked" : "grouped",
      trendSeriesLimit:
        chartPreferences?.trendSeriesLimit === 1 ||
        chartPreferences?.trendSeriesLimit === 2 ||
        chartPreferences?.trendSeriesLimit === 3 ||
        chartPreferences?.trendSeriesLimit === 4 ||
        chartPreferences?.trendSeriesLimit === 5
          ? chartPreferences.trendSeriesLimit
          : 3,
    }),
    [chartPreferences],
  );
  const safeCustomWidgets = useMemo(
    () =>
      (Array.isArray(customWidgets) ? customWidgets.filter(isRecord) : []) as DashboardCustomWidget[],
    [customWidgets],
  );
  const safeActiveProjects = useMemo(
    () => (Array.isArray(activeProjects) ? activeProjects.filter(isRecord) : []) as Project[],
    [activeProjects],
  );
  const safeDeadlines = useMemo(
    () => (Array.isArray(deadlines) ? deadlines.filter(isRecord) : []) as ProjectDeadline[],
    [deadlines],
  );
  const safeRecentActivity = useMemo(
    () => (Array.isArray(recentActivity) ? recentActivity.filter(isRecord) : []) as ActivityItem[],
    [recentActivity],
  );
  const safeVisibleQuickLinks = useMemo(
    () => (Array.isArray(visibleQuickLinks) ? visibleQuickLinks.filter(isRecord) : []) as QuickLink[],
    [visibleQuickLinks],
  );
  const safeVisibleSummaryCards = useMemo(
    () => (Array.isArray(visibleSummaryCards) ? visibleSummaryCards.filter(isRecord) : []) as SummaryCard[],
    [visibleSummaryCards],
  );
  const indicatorMetrics = useMemo(
    () =>
      Array.isArray(screeningInsights?.indicatorMetrics)
        ? (screeningInsights.indicatorMetrics.filter(isRecord) as ScreeningDashboardInsights["indicatorMetrics"])
        : [],
    [screeningInsights],
  );
  const servicePathways = useMemo(
    () =>
      Array.isArray(screeningInsights?.servicePathways)
        ? (screeningInsights.servicePathways.filter(isRecord) as ScreeningDashboardInsights["servicePathways"])
        : [],
    [screeningInsights],
  );
  const hivTestingComparison = useMemo(
    () =>
      Array.isArray(screeningInsights?.hivTestingComparison)
        ? (screeningInsights.hivTestingComparison.filter(isRecord) as ScreeningDashboardInsights["hivTestingComparison"])
        : [],
    [screeningInsights],
  );
  const hivPreventionMessageTypeByCso = {
    rows:
      Array.isArray(messageAnalyticsRows) && messageAnalyticsRows.length > 0
        ? messageAnalyticsRows
        : screeningInsights?.hivPreventionMessageTypeByCso?.rows ||
          EMPTY_MESSAGE_TYPE_BY_CSO.rows,
    series:
      Array.isArray(messageAnalyticsSeries) && messageAnalyticsSeries.length > 0
        ? messageAnalyticsSeries
        : screeningInsights?.hivPreventionMessageTypeByCso?.series ||
          EMPTY_MESSAGE_TYPE_BY_CSO.series,
  };
  const hivPreventionMessageTypeRows = useMemo(
    () =>
      Array.isArray(hivPreventionMessageTypeByCso.rows)
        ? (hivPreventionMessageTypeByCso.rows.filter(isRecord) as ScreeningDashboardInsights["hivPreventionMessageTypeByCso"]["rows"])
        : [],
    [hivPreventionMessageTypeByCso.rows],
  );
  const hivPreventionMessageTypeSeries = useMemo(
    () =>
      Array.isArray(hivPreventionMessageTypeByCso.series)
        ? (hivPreventionMessageTypeByCso.series.filter(isRecord) as ScreeningDashboardInsights["hivPreventionMessageTypeByCso"]["series"])
        : [],
    [hivPreventionMessageTypeByCso.series],
  );
  const hivPreventionMessagesByCso = useMemo(
    () =>
      Array.isArray(screeningInsights?.hivPreventionMessagesByCso)
        ? (screeningInsights.hivPreventionMessagesByCso.filter(isRecord) as ScreeningDashboardInsights["hivPreventionMessagesByCso"])
        : [],
    [screeningInsights],
  );
  const ncdMessageDisaggregates = useMemo(
    () =>
      Array.isArray(screeningInsights?.ncdMessageDisaggregates)
        ? (screeningInsights.ncdMessageDisaggregates.filter(isRecord) as ScreeningDashboardInsights["ncdMessageDisaggregates"])
        : [],
    [screeningInsights],
  );
  const topIndicators = useMemo(
    () =>
      Array.isArray(screeningInsights?.topIndicators)
        ? (screeningInsights.topIndicators.filter(isRecord) as ScreeningDashboardInsights["topIndicators"])
        : [],
    [screeningInsights],
  );
  const projectMetrics = useMemo(
    () =>
      Array.isArray(screeningInsights?.projects)
        ? (screeningInsights.projects.filter(isRecord) as ScreeningDashboardInsights["projects"])
        : [],
    [screeningInsights],
  );
  const trendSeries = useMemo(
    () =>
      Array.isArray(screeningInsights?.trendSeries)
        ? (screeningInsights.trendSeries.filter(isRecord) as ScreeningDashboardInsights["trendSeries"])
        : [],
    [screeningInsights],
  );
  const trendRows = useMemo(
    () =>
      Array.isArray(screeningInsights?.trend)
        ? (screeningInsights.trend.filter(isRecord) as ScreeningDashboardInsights["trend"])
        : [],
    [screeningInsights],
  );
  const screeningInsightsIsLoading = Boolean(screeningInsights?.isLoading);
  const screeningInsightsHasError = Boolean(screeningInsights?.hasError);
  const effectiveMessageAnalyticsLoading =
    Boolean(messageAnalyticsIsLoading) || screeningInsightsIsLoading;
  const effectiveMessageAnalyticsHasError = Boolean(messageAnalyticsHasError);
  const totalScreeningValue = toSafeNumber(screeningInsights?.totalScreeningValue);
  const indicatorCount = toSafeNumber(screeningInsights?.indicatorCount);
  const reportingOrganizationsCount = toSafeNumber(screeningInsights?.reportingOrganizationsCount);
  const navigateHref = (href: string) => href;
  const openAggregatesEditor = useCallback(
    (searchText?: string) => {
      const params = new URLSearchParams();
      if (aggregateFilterContext?.projectId) params.set("project", aggregateFilterContext.projectId);
      if (aggregateFilterContext?.coordinatorId) params.set("coordinator", aggregateFilterContext.coordinatorId);
      if (aggregateFilterContext?.organizationId) params.set("organizations", aggregateFilterContext.organizationId);
      if (aggregateFilterContext?.dateFrom) params.set("date_from", aggregateFilterContext.dateFrom);
      if (aggregateFilterContext?.dateTo) params.set("date_to", aggregateFilterContext.dateTo);
      if (searchText && searchText.trim()) params.set("search", searchText.trim());
      const query = params.toString();
      router.push(query ? `/aggregates?${query}` : "/aggregates");
    },
    [aggregateFilterContext, router],
  );
  const upcomingDeadlines = useMemo(
    () => safeDeadlines.slice(0, deadlineSliceCount),
    [safeDeadlines],
  );
  const projectOverview = useMemo(
    () =>
      safeActiveProjects.map((project) => {
        const metrics = getProjectMetrics(project);
        return {
          code: project.code,
          daysRemaining: metrics.daysRemaining,
          durationDays: metrics.durationDays,
          endDate: project.end_date,
          id: project.id,
          indicatorsCount: project.indicators_count ?? 0,
          label: shortenLabel(project.name, project.code),
          name: project.name,
          scheduleProgress: metrics.scheduleProgress,
          startDate: project.start_date,
          tasksCount: project.tasks_count ?? 0,
        };
      }),
    [safeActiveProjects],
  );

  const boardMetrics = useMemo(
    () =>
      [
        ...safeVisibleSummaryCards.map((card) => ({
          icon: card.icon,
          id: card.id,
          label: card.label,
          note: card.note,
          value: card.value,
        })),
        {
          icon: Clock3,
          id: "deadline-window",
          label: "Upcoming deadlines",
          note: "reporting items due soon",
          value: safeDeadlines.length,
        },
      ],
    [safeDeadlines.length, safeVisibleSummaryCards],
  );

  const updateCounts = useMemo<Record<UpdatesTab, number>>(
    () => ({
      activity: safeRecentActivity.length,
      deadlines: safeDeadlines.length,
      projects: safeActiveProjects.length,
    }),
    [safeActiveProjects.length, safeDeadlines.length, safeRecentActivity.length],
  );

  const showRightRail = (showFavoritesPanel && safeVisibleQuickLinks.length > 0) || showSpotlightPanel;
  const showBoard =
    (showSummaryStrip && boardMetrics.length > 0) || showUpdatesBoard || showRightRail;
  const hasHivTestingComparisonData = useMemo(
    () => hivTestingComparison.some((entry) => entry.actual > 0 || entry.target > 0),
    [hivTestingComparison],
  );
  const hasHivMessageTypeData = useMemo(
    () =>
      hivPreventionMessageTypeRows.length > 0 &&
      hivPreventionMessageTypeSeries.length > 0,
    [hivPreventionMessageTypeRows.length, hivPreventionMessageTypeSeries.length],
  );
  const indicatorMetricsById = useMemo(
    () => new Map(indicatorMetrics.map((metric) => [metric.indicatorId, metric])),
    [indicatorMetrics],
  );
  const resolvedCustomWidgets = useMemo(
    () =>
      safeCustomWidgets
        .map((widget) => ({
          ...widget,
          indicatorIds: Array.isArray(widget.indicatorIds) ? widget.indicatorIds : [],
          metrics: (customWidgetMetricsById[widget.id] ||
            (Array.isArray(widget.indicatorIds) ? widget.indicatorIds : [])
              .map((indicatorId) => indicatorMetricsById.get(indicatorId))
              .filter(
                (metric): metric is ScreeningDashboardInsights["indicatorMetrics"][number] =>
                  Boolean(metric),
              ))
            .slice(0, chartLikeCustomWidgetTypes.has(widget.type) ? 6 : 8),
        }))
        .filter((widget) => widget.metrics.length > 0),
    [customWidgetMetricsById, safeCustomWidgets, indicatorMetricsById],
  );
  const visibleTrendSeries = useMemo(
    () => trendSeries.slice(0, safeChartPreferences.trendSeriesLimit),
    [safeChartPreferences.trendSeriesLimit, trendSeries],
  );
  const trendData = useMemo(
    () =>
      trendRows.map((row) => {
        const nextRow: Record<string, number | string> = { period: row.period };
        visibleTrendSeries.forEach((series) => {
          nextRow[series.key] = row[series.key] ?? 0;
        });
        return nextRow;
      }),
    [trendRows, visibleTrendSeries],
  );
  const hasTrendData = trendData.length > 0 && visibleTrendSeries.length > 0;

  if (!showBoard) {
    return (
      <div className="rounded-[2rem] border-2 border-dashed border-border bg-card px-6 py-14 text-center shadow-sm">
        <h2 className="text-2xl font-semibold text-foreground">Your dashboard is currently empty</h2>
        <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
          Open Customize Dashboard to turn sections back on and build the dashboard layout you want to see first.
        </p>
      </div>
    );
  }

  return (
    <div className="min-w-0 w-full max-w-full space-y-6 overflow-x-hidden pb-8">
      {showBoard ? (
        <section className="min-w-0 w-full max-w-full overflow-hidden rounded-2xl border border-border bg-card p-4 text-foreground shadow-sm sm:p-5">
          <div
            className={cn(
              "relative grid min-w-0 w-full max-w-full gap-4",
              showRightRail ? "xl:grid-cols-[minmax(0,1fr)_220px]" : "xl:grid-cols-[minmax(0,1fr)]",
            )}
          >
            <div className="min-w-0 w-full max-w-full space-y-4">
              {showSummaryStrip && boardMetrics.length > 0 ? (
                <section
                  className={cn(
                    "grid gap-px overflow-hidden rounded-[1.5rem] border border-border bg-card",
                    boardMetrics.length >= 6
                      ? "lg:grid-cols-6"
                      : boardMetrics.length === 5
                        ? "lg:grid-cols-5"
                        : boardMetrics.length === 4
                          ? "lg:grid-cols-4"
                          : boardMetrics.length === 3
                            ? "lg:grid-cols-3"
                            : "xl:grid-cols-2",
                  )}
                >
                  {boardMetrics.map((metric) => (
                    <div key={metric.id} className="min-w-0 max-w-full bg-card px-4 py-4">
                      {(() => {
                        const MetricIcon = isRenderableIcon(metric.icon) ? metric.icon : CircleHelp;
                        return (
                      <div className="flex min-w-0 items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                            {metric.label}
                          </p>
                          <p className="mt-3 text-3xl font-bold tracking-tight text-foreground">
                            {formatCompactNumber(metric.value)}
                          </p>
                          <p className="mt-2 break-words text-xs leading-5 text-muted-foreground">{metric.note}</p>
                        </div>
                        <div className="rounded-2xl border border-border bg-card p-3 text-muted-foreground">
                          <MetricIcon className="h-5 w-5" />
                        </div>
                      </div>
                        );
                      })()}
                    </div>
                  ))}
                </section>
              ) : null}

              {showUpdatesBoard ? (
                <>
                  {/*
                    Hardcoded HIV/NCD message + HIV testing themed cards were
                    removed here; the home dashboard surfaces org "home" dashboard
                    charts shared from the Analysis Visualizer instead (rendered by
                    the dashboard page). Service pathway cards are kept, but only
                    shown when the current filter actually has data so an org that
                    doesn't do them never sees an empty placeholder.
                  */}
                  <ServicePathwayCardsPanel
                    hasError={screeningInsightsHasError}
                    isLoading={screeningInsightsIsLoading}
                    items={servicePathways}
                    onEditData={onConfigureServicePathways}
                  />

                  <div className="grid min-w-0 w-full max-w-full grid-cols-1 items-start gap-4 xl:grid-cols-2">
                    {resolvedCustomWidgets.map((widget) => {
                      const subtitle = getCustomWidgetSubtitle(widget);
                      return (
                        <CustomWidgetShell
                          key={widget.id}
                          onDelete={() => onDeleteCustomWidget(widget.id)}
                          onEdit={() => onEditCustomWidget(widget.id)}
                        >
                          <DashboardWidgetRenderer
                            type={widget.type}
                            metrics={widget.metrics}
                            subtitle={subtitle}
                            title={widget.title}
                          />
                        </CustomWidgetShell>
                      );
                    })}
                    <AddCardTile onClick={onOpenCustomizeDashboard} />
                  </div>

                  <div className="grid gap-4 xl:grid-cols-3">
                    <MetricBarsPanel
                      className="xl:col-span-2"
                      eyebrow="Screening Breakdown"
                      emptyCopy="Screening indicator totals will appear here as aggregate reports come in."
                      items={topIndicators}
                      title="Top screening indicators"
                    />
                    <MetricBarsPanel
                      eyebrow="Project Scope"
                      emptyCopy="Projects contributing screening totals will be listed once active-project reporting is available."
                      items={projectMetrics}
                      title="Projects with screening totals"
                    />
                  </div>

                  <DashboardPanel eyebrow="Trend" title="Monthly reporting graph">
                    {screeningInsightsIsLoading ? (
                        <div className="rounded-xl border border-dashed border-border bg-muted/20 px-4 py-8 text-sm text-muted-foreground">
                          Loading monthly reporting trend.
                        </div>
                      ) : screeningInsightsHasError ? (
                        <div className="rounded-xl border border-dashed border-border bg-muted/20 px-4 py-8 text-sm text-muted-foreground">
                          Monthly reporting trend is temporarily unavailable.
                        </div>
                      ) : !hasTrendData ? (
                        <div className="rounded-xl border border-dashed border-border bg-muted/20 px-4 py-8 text-sm text-muted-foreground">
                          Monthly reporting bars will appear once aggregate periods are available.
                        </div>
                      ) : (
                      <div className="space-y-4">
                        <div className="h-[320px] w-full min-w-0 overflow-hidden">
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart
                              data={trendData}
                              margin={{ top: 8, right: 12, left: 0, bottom: 8 }}
                              barCategoryGap="18%"
                            >
                              <CartesianGrid vertical={false} stroke="hsl(var(--border) / 0.65)" />
                              <XAxis
                                axisLine={false}
                                dataKey="period"
                                tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
                                tickLine={false}
                              />
                              <YAxis
                                axisLine={false}
                                tickFormatter={(value: number) => formatWholeNumber(value)}
                                tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
                                tickLine={false}
                                width={96}
                              />
                              <Tooltip
                                contentStyle={{
                                  backgroundColor: "hsl(var(--card))",
                                  border: "1px solid hsl(var(--border))",
                                  borderRadius: "16px",
                                  color: "hsl(var(--foreground))",
                                }}
                                cursor={{ fill: "hsl(var(--muted) / 0.35)" }}
                                formatter={(value: number, name: string) => [
                                  formatWholeNumber(value),
                                  visibleTrendSeries.find((series) => series.key === name)?.label || name,
                                ]}
                              />
                              {visibleTrendSeries.map((series) => (
                                <Bar
                                  key={series.key}
                                  dataKey={series.key}
                                  fill={series.color}
                                  radius={safeChartPreferences.trendLayout === "grouped" ? [8, 8, 0, 0] : [0, 0, 0, 0]}
                                  stackId={safeChartPreferences.trendLayout === "stacked" ? "trend" : undefined}
                                  minPointSize={4}
                                >
                                  <LabelList
                                    dataKey={series.key}
                                    position="top"
                                    formatter={renderBarValueLabel}
                                    fill="hsl(var(--foreground))"
                                    fontSize={11}
                                  />
                                </Bar>
                              ))}
                            </BarChart>
                          </ResponsiveContainer>
                        </div>

                        {safeChartPreferences.showTrendLegend ? (
                          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                            {visibleTrendSeries.map((series) => (
                              <div
                                key={`legend-${series.key}`}
                                className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1"
                              >
                                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: series.color }} />
                                <span>{series.label}</span>
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    )}
                  </DashboardPanel>

                  <Tabs value={activeUpdatesTab} onValueChange={(value) => onActiveUpdatesTabChange(value as UpdatesTab)}>
                    <DashboardPanel eyebrow="Details" title="Operations matrix">
                      <div className="flex min-w-0 flex-wrap gap-4 lg:items-center lg:justify-between">
                        <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                          {screeningInsightsIsLoading ? (
                            <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5">
                              Loading screening summary...
                            </div>
                          ) : (
                            <>
                              <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5">
                                Screening total: {formatWholeNumber(totalScreeningValue)}
                              </div>
                              <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5">
                                Indicators: {formatWholeNumber(indicatorCount)}
                              </div>
                              <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5">
                                Orgs reporting: {formatWholeNumber(reportingOrganizationsCount)}
                              </div>
                            </>
                          )}
                        </div>

                        <TabsList className="h-auto flex-wrap justify-start rounded-full border border-border bg-card p-1">
                          {(["activity", "deadlines", "projects"] as UpdatesTab[]).map((tab) => (
                            <TabsTrigger
                              key={tab}
                              value={tab}
                              className="rounded-full px-4 py-2 text-sm capitalize text-muted-foreground data-[state=active]:bg-card data-[state=active]:text-foreground"
                            >
                              {tab}
                              <span className="ml-2 rounded-full bg-muted/50 px-2 py-0.5 text-[11px] data-[state=active]:bg-muted">
                                {updateCounts[tab]}
                              </span>
                            </TabsTrigger>
                          ))}
                        </TabsList>
                      </div>

                      <div className="mt-4 w-full max-w-full overflow-x-auto rounded-[1.1rem] border border-border bg-card">
                        <TabsContent value="activity" className="m-0">
                          <table className="w-full min-w-[720px] text-sm">
                            <thead className="bg-card text-left text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                              <tr>
                                <th className="px-4 py-3">Activity</th>
                                <th className="px-4 py-3">Type</th>
                                <th className="px-4 py-3">Logged</th>
                                <th className="px-4 py-3">Freshness</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                              {safeRecentActivity.length === 0 ? (
                                <tr>
                                  <td className="px-4 py-6 text-muted-foreground" colSpan={4}>
                                    No recent activity is available yet.
                                  </td>
                                </tr>
                              ) : (
                                safeRecentActivity.slice(0, 15).map((item, index) => (
                                  <tr key={`${item.timestamp}-${index}`} className="text-foreground">
                                    <td className="px-4 py-3">
                                      <div className="max-w-[28rem] min-w-0 break-words font-medium">{item.description}</div>
                                    </td>
                                    <td className="px-4 py-3 text-muted-foreground">{item.type || "system"}</td>
                                    <td className="px-4 py-3 text-muted-foreground">{formatFullDate(item.timestamp)}</td>
                                    <td className="px-4 py-3 text-muted-foreground">{formatRelativeDate(item.timestamp)}</td>
                                  </tr>
                                ))
                              )}
                            </tbody>
                          </table>
                        </TabsContent>

                        <TabsContent value="deadlines" className="m-0">
                          <table className="w-full min-w-[720px] text-sm">
                            <thead className="bg-card text-left text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                              <tr>
                                <th className="px-4 py-3">Deadline</th>
                                <th className="px-4 py-3">Project</th>
                                <th className="px-4 py-3">Due</th>
                                <th className="px-4 py-3">Window</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                              {upcomingDeadlines.length === 0 ? (
                                <tr>
                                  <td className="px-4 py-6 text-muted-foreground" colSpan={4}>
                                    No deadline records are currently queued.
                                  </td>
                                </tr>
                              ) : (
                                upcomingDeadlines.map((deadline) => {
                                  const daysUntil = getDaysUntil(deadline.due_date);
                                  return (
                                    <tr key={deadline.id} className="text-foreground">
                                      <td className="px-4 py-3 font-medium">{deadline.name}</td>
                                      <td className="px-4 py-3 text-muted-foreground">
                                        {deadline.project_name || "Project not specified"}
                                      </td>
                                      <td className="px-4 py-3 text-muted-foreground">{formatFullDate(deadline.due_date)}</td>
                                      <td className="px-4 py-3">
                                        <span className={cn("inline-flex rounded-full px-3 py-1 text-xs font-medium", getDeadlineBadgeClass(daysUntil))}>
                                          {daysUntil === null
                                            ? "No date"
                                            : daysUntil < 0
                                              ? `${Math.abs(daysUntil)} day${Math.abs(daysUntil) === 1 ? "" : "s"} overdue`
                                              : `${daysUntil} day${daysUntil === 1 ? "" : "s"} left`}
                                        </span>
                                      </td>
                                    </tr>
                                  );
                                })
                              )}
                            </tbody>
                          </table>
                        </TabsContent>

                        <TabsContent value="projects" className="m-0">
                          <table className="w-full min-w-[720px] text-sm">
                            <thead className="bg-card text-left text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                              <tr>
                                <th className="px-4 py-3">Project</th>
                                <th className="px-4 py-3">Dates</th>
                                <th className="px-4 py-3">Indicators</th>
                                <th className="px-4 py-3">Schedule</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                              {projectOverview.length === 0 ? (
                                <tr>
                                  <td className="px-4 py-6 text-muted-foreground" colSpan={4}>
                                    No active projects are available for this account yet.
                                  </td>
                                </tr>
                              ) : (
                                projectOverview.map((project) => (
                                  <tr key={project.id} className="text-foreground">
                                    <td className="px-4 py-3 font-medium">{project.name}</td>
                                    <td className="px-4 py-3 text-muted-foreground">
                                      {formatMonthDay(project.startDate)} - {formatMonthDay(project.endDate)}
                                    </td>
                                    <td className="px-4 py-3 text-muted-foreground">{formatWholeNumber(project.indicatorsCount)}</td>
                                    <td className="px-4 py-3">
                                      <div className="flex min-w-0 items-center gap-3">
                                        <div className="h-2.5 w-full max-w-[6rem] overflow-hidden rounded-full bg-muted">
                                          <div
                                            className="h-full max-w-full rounded-full bg-primary/70"
                                            style={{ width: `${Math.min(project.scheduleProgress, 100)}%` }}
                                          />
                                        </div>
                                        <span className="text-muted-foreground">{project.scheduleProgress}%</span>
                                      </div>
                                    </td>
                                  </tr>
                                ))
                              )}
                            </tbody>
                          </table>
                        </TabsContent>
                      </div>
                    </DashboardPanel>
                  </Tabs>
                </>
              ) : (
                <DashboardPanel eyebrow="Overview" title="Operational overview">
                  <div className="rounded-xl border border-dashed border-border bg-muted/20 px-4 py-8 text-sm text-muted-foreground">
                    Turn on the Updates Board in Customize Dashboard to restore charts and the operations matrix.
                  </div>
                </DashboardPanel>
              )}
            </div>

            {showRightRail ? (
              <aside className="min-w-0 w-full max-w-full space-y-4">
                {showFavoritesPanel ? (
                  <DashboardPanel eyebrow="Shortcuts" title="Favorites">
                    {safeVisibleQuickLinks.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-border bg-muted/20 px-4 py-8 text-sm text-muted-foreground">
                        No quick links are selected right now.
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {safeVisibleQuickLinks.map((link) => {
                          const LinkIcon = isRenderableIcon(link.icon) ? link.icon : CircleHelp;
                          return (
                            <a
                              key={link.id}
                              href={navigateHref(link.href)}
                              className="flex min-w-0 items-start justify-between gap-3 rounded-[1.1rem] border border-border bg-card px-4 py-4 transition-colors hover:bg-muted"
                            >
                              <div className="flex min-w-0 items-start gap-3">
                                <div className="rounded-2xl border border-border bg-card p-2.5 text-muted-foreground">
                                  <LinkIcon className="h-4 w-4" />
                                </div>
                                <div className="min-w-0">
                                  <p className="font-semibold text-foreground">{link.label}</p>
                                  <p className="mt-1 break-words text-sm leading-5 text-muted-foreground">{link.description}</p>
                                </div>
                              </div>
                              <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
                            </a>
                          );
                        })}
                      </div>
                    )}
                  </DashboardPanel>
                ) : null}

                {showSpotlightPanel ? (
                  <DashboardPanel eyebrow="Spotlight" title="Current focus">
                    {safeActiveProjects.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-border bg-muted/20 px-4 py-8 text-sm text-muted-foreground">
                        No active project spotlight is available right now.
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {safeActiveProjects.slice(0, 6).map((project) => {
                          const metrics = getProjectMetrics(project);
                          return (
                            <a
                              key={project.id}
                              href={navigateHref(`/projects/${project.id}`)}
                              className="block rounded-[1.1rem] border border-border bg-card px-4 py-4 transition-colors hover:bg-muted"
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <p className="font-semibold text-foreground">{project.name}</p>
                                  <p className="mt-1 text-sm text-muted-foreground">
                                    Ends {formatMonthDay(project.end_date)}
                                  </p>
                                </div>
                                <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
                              </div>
                              <div className="mt-4 flex min-w-0 items-center gap-3">
                                <div className="h-2.5 w-full flex-1 overflow-hidden rounded-full bg-muted">
                                  <div
                                    className="h-full max-w-full rounded-full bg-primary/70"
                                    style={{ width: `${Math.min(metrics.scheduleProgress, 100)}%` }}
                                  />
                                </div>
                                <span className="text-sm text-muted-foreground">{metrics.scheduleProgress}%</span>
                              </div>
                            </a>
                          );
                        })}
                      </div>
                    )}
                  </DashboardPanel>
                ) : null}
              </aside>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}




