"use client";

/**
 * Explore workbench (Phase 1) — a self-service canvas where a user builds any
 * visualization from their indicators, laid out to use the full viewport, with
 * click-through drill-down.
 *
 * Deliberately built ON the existing, proven pieces so numbers stay consistent
 * with the rest of the app:
 *   • charts        → the shared widget registry (DashboardWidgetRenderer)
 *   • RAG colouring → the canonical performance-status SSoT (performanceColors)
 *   • drill-down    → the existing PerformanceDetailPanel (org/project breakdown)
 *
 * Presentational + prop-driven so it unit-tests without any network: the page
 * (`app/(dashboard)/explore/page.tsx`) feeds it real data via `useExploreData`.
 */
import { useMemo, useState } from "react";
import { Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DashboardWidgetRenderer } from "@/components/dashboard/widgets/widget-registry";
import { PerformanceDetailPanel } from "@/components/dashboard/components/performance-detail-panel";
import {
  DASHBOARD_CUSTOM_WIDGET_STYLE_OPTIONS,
  DEFAULT_DASHBOARD_CUSTOM_WIDGET_TYPE,
  type DashboardCustomWidgetType,
  type WidgetMetricCollection,
} from "@/components/dashboard/engine/types";
import type { ScreeningDashboardInsights } from "@/lib/dashboard/screening-insights";

export type ExploreWorkbenchProps = {
  indicatorMetrics: WidgetMetricCollection;
  organizations: ScreeningDashboardInsights["organizations"];
  projects: ScreeningDashboardInsights["projects"];
  isLoading?: boolean;
  error?: boolean;
};

type GroupBy = "indicator" | "organization" | "project";

const GROUP_BY_OPTIONS: ReadonlyArray<{ value: GroupBy; label: string }> = [
  { value: "indicator", label: "Indicator" },
  { value: "organization", label: "Organisation" },
  { value: "project", label: "Project" },
];

type ExploreCard = {
  id: string;
  type: DashboardCustomWidgetType;
  groupBy: GroupBy;
  indicatorIds: string[];
  title: string;
};

type Density = "comfortable" | "compact";

type DimensionRow = { label: string; value: number; target: number; percentage: number };

/** Adapt a dimension breakdown (org/project) into the widget metric row shape. */
export function dimensionMetrics(rows: readonly DimensionRow[]): WidgetMetricCollection {
  return rows.map((row, index) => ({
    indicatorId: `dim-${index}-${row.label}`,
    label: row.label,
    value: row.value,
    target: row.target,
    percentage: row.percentage,
  }));
}

let cardSeq = 0;

export function ExploreWorkbench({
  indicatorMetrics,
  organizations,
  projects,
  isLoading = false,
  error = false,
}: ExploreWorkbenchProps) {
  const metricsById = useMemo(() => {
    const map = new Map<string, WidgetMetricCollection[number]>();
    for (const metric of indicatorMetrics) map.set(String(metric.indicatorId), metric);
    return map;
  }, [indicatorMetrics]);

  const [cards, setCards] = useState<ExploreCard[]>([]);
  const [density, setDensity] = useState<Density>("comfortable");
  const [builderOpen, setBuilderOpen] = useState(false);
  const [drillCard, setDrillCard] = useState<ExploreCard | null>(null);

  const [draftType, setDraftType] = useState<DashboardCustomWidgetType>(DEFAULT_DASHBOARD_CUSTOM_WIDGET_TYPE);
  const [draftGroupBy, setDraftGroupBy] = useState<GroupBy>("indicator");
  const [draftIndicatorIds, setDraftIndicatorIds] = useState<string[]>([]);
  const [draftTitle, setDraftTitle] = useState("");
  const [search, setSearch] = useState("");

  const pickable = useMemo(() => {
    const query = search.trim().toLowerCase();
    return indicatorMetrics
      .map((metric) => ({ id: String(metric.indicatorId), label: metric.label }))
      .filter((option) => !query || option.label.toLowerCase().includes(query));
  }, [indicatorMetrics, search]);

  const toggleDraftIndicator = (id: string) =>
    setDraftIndicatorIds((prev) => (prev.includes(id) ? prev.filter((existing) => existing !== id) : [...prev, id]));

  const metricsForCard = (card: ExploreCard): WidgetMetricCollection => {
    if (card.groupBy === "organization") return dimensionMetrics(organizations);
    if (card.groupBy === "project") return dimensionMetrics(projects);
    return card.indicatorIds
      .map((id) => metricsById.get(id))
      .filter((metric): metric is WidgetMetricCollection[number] => Boolean(metric));
  };

  const isDimensionGrouping = draftGroupBy !== "indicator";
  const canAddCard = isDimensionGrouping || draftIndicatorIds.length > 0;

  const addCard = () => {
    if (!canAddCard) return;
    const first = metricsById.get(draftIndicatorIds[0]);
    const autoTitle =
      draftGroupBy === "organization"
        ? "By organisation"
        : draftGroupBy === "project"
          ? "By project"
          : draftIndicatorIds.length === 1
            ? first?.label ?? "Visualization"
            : `${draftIndicatorIds.length} indicators`;
    cardSeq += 1;
    setCards((prev) => [
      ...prev,
      {
        id: `card-${cardSeq}`,
        type: draftType,
        groupBy: draftGroupBy,
        indicatorIds: [...draftIndicatorIds],
        title: draftTitle.trim() || autoTitle,
      },
    ]);
    setBuilderOpen(false);
    setDraftGroupBy("indicator");
    setDraftIndicatorIds([]);
    setDraftTitle("");
    setSearch("");
  };

  const removeCard = (id: string) => setCards((prev) => prev.filter((card) => card.id !== id));

  const cardMinHeight = density === "compact" ? "min-h-[240px]" : "min-h-[340px]";
  const gridGap = density === "compact" ? "gap-3" : "gap-4";

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col gap-3 p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">Explore</h1>
          <p className="text-xs text-muted-foreground">
            Build any visualization from your indicators — drill down, no limits.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-md border border-border p-0.5" role="group" aria-label="Card density">
            <Button
              variant={density === "comfortable" ? "secondary" : "ghost"}
              size="sm"
              className="h-7 px-2 text-xs"
              aria-pressed={density === "comfortable"}
              onClick={() => setDensity("comfortable")}
            >
              Comfortable
            </Button>
            <Button
              variant={density === "compact" ? "secondary" : "ghost"}
              size="sm"
              className="h-7 px-2 text-xs"
              aria-pressed={density === "compact"}
              onClick={() => setDensity("compact")}
            >
              Compact
            </Button>
          </div>
          <Button size="sm" onClick={() => setBuilderOpen(true)} disabled={isLoading || error}>
            <Plus className="mr-1 h-4 w-4" />
            Add visualization
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Loading your data…
          </div>
        ) : error ? (
          <div className="flex h-full items-center justify-center text-sm text-destructive">
            Could not load your data.
          </div>
        ) : cards.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border text-center">
            <p className="text-sm text-muted-foreground">
              Your canvas is empty. Build any chart from your indicators.
            </p>
            <Button size="sm" onClick={() => setBuilderOpen(true)}>
              <Plus className="mr-1 h-4 w-4" />
              Add your first visualization
            </Button>
          </div>
        ) : (
          <div className={`grid ${gridGap} grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4`}>
            {cards.map((card) => (
              <div
                key={card.id}
                className={`flex ${cardMinHeight} flex-col rounded-xl border border-border bg-card p-3 shadow-sm`}
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium" title={card.title}>
                    {card.title}
                  </span>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-1.5 text-[11px]"
                      onClick={() => setDrillCard(card)}
                    >
                      Drill down
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0"
                      aria-label={`Remove ${card.title}`}
                      onClick={() => removeCard(card.id)}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                <div className="min-h-0 flex-1">
                  <DashboardWidgetRenderer
                    type={card.type}
                    metrics={metricsForCard(card)}
                    title={card.title}
                    performanceColors
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Dialog open={builderOpen} onOpenChange={setBuilderOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New visualization</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Group by</label>
                <Select value={draftGroupBy} onValueChange={(value) => setDraftGroupBy(value as GroupBy)}>
                  <SelectTrigger aria-label="Group by">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {GROUP_BY_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Chart type</label>
                <Select value={draftType} onValueChange={(value) => setDraftType(value as DashboardCustomWidgetType)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DASHBOARD_CUSTOM_WIDGET_STYLE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {isDimensionGrouping ? (
              <p className="rounded-md border border-dashed border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                Showing achieved vs target across all your{" "}
                {draftGroupBy === "organization" ? "organisations" : "projects"} for the selected chart type.
              </p>
            ) : (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  Indicators ({draftIndicatorIds.length} selected)
                </label>
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search indicators…"
                  aria-label="Search indicators"
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                />
                <ScrollArea className="h-52 rounded-md border border-border">
                  <div className="p-1">
                    {pickable.map((option) => (
                      <label
                        key={option.id}
                        className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-muted"
                      >
                        <input
                          type="checkbox"
                          checked={draftIndicatorIds.includes(option.id)}
                          onChange={() => toggleDraftIndicator(option.id)}
                        />
                        <span className="truncate">{option.label}</span>
                      </label>
                    ))}
                    {pickable.length === 0 && (
                      <p className="p-2 text-xs text-muted-foreground">No indicators match your search.</p>
                    )}
                  </div>
                </ScrollArea>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Title (optional)</label>
              <input
                value={draftTitle}
                onChange={(event) => setDraftTitle(event.target.value)}
                placeholder="Auto from indicator"
                aria-label="Visualization title"
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
              />
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setBuilderOpen(false)}>
                Cancel
              </Button>
              <Button onClick={addCard} disabled={!canAddCard}>
                Add to canvas
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={drillCard !== null} onOpenChange={(open) => !open && setDrillCard(null)}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Drill down — {drillCard?.title}</DialogTitle>
          </DialogHeader>
          {drillCard && (
            <PerformanceDetailPanel
              metrics={metricsForCard(drillCard)}
              organizations={organizations}
              projects={projects}
              performanceColors
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
