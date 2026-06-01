"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  ChevronDown,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";

import { DashboardAnalyticsSurface } from "@/components/analysis/dashboard-analytics-surface";
import { DashboardChartCard } from "@/components/analysis/dashboard-chart-card";
import { DashboardChartSettingsDialog } from "@/components/analysis/dashboard-chart-settings-dialog";
import type { CustomAnalysisState } from "@/components/analysis/custom-analysis-builder";
import { DashboardSettingsDialog } from "@/components/analysis/dashboard-settings-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  AnalyticsFiltersProvider,
  defaultAnalyticsFilters,
  type AnalyticsFilterState,
} from "@/hooks/use-analytics-filters";
import {
  dashboardSettingsService,
  type DashboardSetting,
  type IndicatorChartSetting,
} from "@/lib/api";
import { useDashboardSetting, useDashboardSettings } from "@/lib/hooks/use-api";

const EMPTY_DASHBOARDS: DashboardSetting[] = [];

function buildInitialAnalyticsState(
  dashboard: DashboardSetting | null,
): Partial<AnalyticsFilterState> {
  if (!dashboard) return defaultAnalyticsFilters;
  const dashboardOrgId = dashboard.organization ? String(dashboard.organization) : "";
  return {
    ...defaultAnalyticsFilters,
    projectId: dashboard.project ? String(dashboard.project) : "all",
    scopeMode: dashboardOrgId
      ? dashboard.cascade_organization ? "parent_org" : "selected_orgs"
      : "all_orgs",
    parentOrgId: dashboard.cascade_organization ? dashboardOrgId : "",
    selectedOrgIds: dashboard.cascade_organization || !dashboardOrgId ? [] : [dashboardOrgId],
    cascadeOrganization: Boolean(dashboard.cascade_organization),
  };
}

export function DashboardWorkspace() {
  const { toast } = useToast();

  const [activeDashboardId, setActiveDashboardId] = useState<number | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [chartDialogOpen, setChartDialogOpen] = useState(false);
  const [editingChart, setEditingChart] = useState<IndicatorChartSetting | null>(null);
  const [chartDraft, setChartDraft] = useState<Partial<CustomAnalysisState> | null>(null);
  const [deletingDashboard, setDeletingDashboard] = useState(false);
  const [deletingChartId, setDeletingChartId] = useState<number | null>(null);

  const { data: dashboardSettingsData, mutate: mutateDashboardSettings, isLoading: dashboardsLoading } =
    useDashboardSettings({ page: 1 });

  const dashboards = dashboardSettingsData?.results ?? EMPTY_DASHBOARDS;
  const totalCount = dashboardSettingsData?.count ?? 0;

  const { data: selectedDashboardDetail, mutate: mutateSelectedDashboard, isLoading: detailLoading } =
    useDashboardSetting(activeDashboardId);

  useEffect(() => {
    if (dashboards.length === 0) { setActiveDashboardId(null); return; }
    if (activeDashboardId === null || !dashboards.some((d) => d.id === activeDashboardId)) {
      setActiveDashboardId(dashboards[0].id);
    }
  }, [activeDashboardId, dashboards]);

  const currentDashboard = useMemo<DashboardSetting | null>(() => {
    if (selectedDashboardDetail?.id) return selectedDashboardDetail;
    return dashboards.find((d) => d.id === activeDashboardId) ?? null;
  }, [activeDashboardId, dashboards, selectedDashboardDetail]);

  const analyticsInitialState = useMemo(
    () => buildInitialAnalyticsState(currentDashboard),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeDashboardId],
  );

  const refreshDashboards = useCallback(async () => {
    await mutateDashboardSettings();
    if (activeDashboardId) await mutateSelectedDashboard();
  }, [activeDashboardId, mutateDashboardSettings, mutateSelectedDashboard]);

  const openAddChart = () => {
    setEditingChart(null);
    setChartDraft(null);
    setChartDialogOpen(true);
  };

  const openEditChart = (chart: IndicatorChartSetting) => {
    setEditingChart(chart);
    setChartDraft(null);
    setChartDialogOpen(true);
  };

  const openCustomDraft = (draft: Partial<CustomAnalysisState>) => {
    setEditingChart(null);
    setChartDraft(draft);
    setChartDialogOpen(true);
  };

  const handleDeleteDashboard = async () => {
    if (!currentDashboard) return;
    if (!confirm(`Delete "${currentDashboard.name}"? This cannot be undone.`)) return;
    setDeletingDashboard(true);
    try {
      await dashboardSettingsService.delete(currentDashboard.id);
      setActiveDashboardId(null);
      await mutateDashboardSettings();
      toast({ title: "Dashboard deleted" });
    } catch {
      toast({ title: "Delete failed", variant: "destructive" });
    } finally {
      setDeletingDashboard(false);
    }
  };

  const handleDeleteChart = async (chart: IndicatorChartSetting) => {
    if (!currentDashboard) return;
    setDeletingChartId(chart.id);
    try {
      await dashboardSettingsService.removeChart(currentDashboard.id, chart.id);
      await mutateSelectedDashboard();
      toast({ title: "Chart removed" });
    } catch {
      toast({ title: "Remove failed", variant: "destructive" });
    } finally {
      setDeletingChartId(null);
    }
  };

  const chartCount = currentDashboard?.charts?.length ?? 0;

  return (
    <>
      {/* Top control bar */}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        {dashboardsLoading ? (
          <div className="flex h-9 w-48 items-center gap-2 rounded-md border border-border px-3 text-sm text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading&hellip;
          </div>
        ) : dashboards.length === 0 ? (
          <p className="text-sm text-muted-foreground">No dashboards yet.</p>
        ) : (
          <Select
            value={activeDashboardId ? String(activeDashboardId) : ""}
            onValueChange={(v) => setActiveDashboardId(Number(v))}
          >
            <SelectTrigger className="w-64">
              <SelectValue placeholder="Select a dashboard" />
            </SelectTrigger>
            <SelectContent>
              {dashboards.map((d) => (
                <SelectItem key={d.id} value={String(d.id)}>
                  <span className="flex items-center gap-2">
                    <span className="truncate">{d.name}</span>
                    <Badge variant="outline" className="shrink-0 text-xs">
                      {d.charts?.length ?? 0}
                    </Badge>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <Button size="sm" variant="outline" onClick={() => setCreateOpen(true)}>
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          New
        </Button>

        {currentDashboard && (
          <>
            <Button size="sm" onClick={openAddChart}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Add chart
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="ghost" className="px-2">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setEditOpen(true)}>
                  <Pencil className="mr-2 h-4 w-4" />
                  Edit settings
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={handleDeleteDashboard}
                  disabled={deletingDashboard}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete dashboard
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}

        {totalCount > 0 && (
          <span className="ml-auto text-xs text-muted-foreground">{totalCount} dashboard{totalCount !== 1 ? "s" : ""}</span>
        )}
      </div>

      {/* Dashboard content */}
      {!currentDashboard ? (
        <div className="rounded-xl border border-dashed border-border bg-card px-6 py-16 text-center">
          <BarChart3 className="mx-auto mb-3 h-8 w-8 text-muted-foreground/50" />
          <p className="text-sm font-medium text-muted-foreground">No dashboard selected</p>
          <p className="mt-1 text-xs text-muted-foreground">Create a dashboard to start building charts.</p>
          <Button size="sm" className="mt-4" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Create dashboard
          </Button>
        </div>
      ) : (
        <AnalyticsFiltersProvider
          key={`dashboard-filters-${currentDashboard.id}`}
          dashboardId={currentDashboard.id}
          initialState={analyticsInitialState}
        >
          <div className="space-y-4">
            {/* Dashboard identity strip */}
            <div className="flex flex-wrap items-center gap-2">
              {currentDashboard.project_name || currentDashboard.project ? (
                <Badge variant="secondary">
                  Project: {currentDashboard.project_name || currentDashboard.project}
                </Badge>
              ) : null}
              {currentDashboard.organization_name || currentDashboard.organization ? (
                <Badge variant="secondary">
                  {currentDashboard.organization_name || currentDashboard.organization}
                  {currentDashboard.cascade_organization ? " + subgrantees" : ""}
                </Badge>
              ) : null}
              {currentDashboard.description ? (
                <span className="text-sm text-muted-foreground">{currentDashboard.description}</span>
              ) : null}
            </div>

            {detailLoading && !selectedDashboardDetail ? (
              <div className="flex min-h-[10rem] items-center justify-center rounded-xl border border-border bg-card">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <>
                {chartCount > 0 && (
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {currentDashboard.charts!.map((chart) => (
                      <DashboardChartCard
                        key={chart.id}
                        chart={chart}
                        dashboard={currentDashboard}
                        onEdit={() => openEditChart(chart)}
                        onDelete={() => handleDeleteChart(chart)}
                        onRefresh={() => mutateSelectedDashboard()}
                        deleteDisabled={deletingChartId === chart.id}
                      />
                    ))}
                  </div>
                )}

                <DashboardAnalyticsSurface
                  dashboard={currentDashboard}
                  onEditChart={openCustomDraft}
                />
              </>
            )}
          </div>
        </AnalyticsFiltersProvider>
      )}

      <DashboardSettingsDialog open={createOpen} onOpenChange={setCreateOpen} onSaved={refreshDashboards} />
      <DashboardSettingsDialog open={editOpen} onOpenChange={setEditOpen} existing={currentDashboard} onSaved={refreshDashboards} />
      <DashboardChartSettingsDialog
        open={chartDialogOpen}
        onOpenChange={(open) => {
          setChartDialogOpen(open);
          if (!open) { setEditingChart(null); setChartDraft(null); }
        }}
        dashboard={currentDashboard}
        existing={editingChart}
        initialCustomAnalysis={chartDraft}
        onSaved={refreshDashboards}
      />
    </>
  );
}
