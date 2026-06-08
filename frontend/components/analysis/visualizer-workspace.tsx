"use client";

import { useMemo, useState } from "react";
import { Download, Home, Loader2, Save } from "lucide-react";
import * as XLSX from "xlsx-js-style";

import {
  CustomAnalysisBuilder,
  createDefaultCustomAnalysisState,
  type CustomAnalysisState,
} from "@/components/analysis/custom-analysis-builder";
import { KPIGrid } from "@/components/analysis/kpi-grid";
import { SmartChartRenderer } from "@/components/analysis/smart-chart-renderer";
import { ConsolidatedMatrixTable } from "@/components/analysis/consolidated-matrix-table";
import { RawRecordsTable } from "@/components/analysis/raw-records-table";
import { triggerBlobDownload } from "@/components/analysis/analytics-utils";
import { appendWorksheetFromRows, toExcelCellValue, type ExcelRow } from "@/components/analysis/chart-card-export";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/contexts/auth-context";
import { getUserOrganizationId } from "@/lib/utils/organization";
import {
  useAllAggregates,
  useAllIndicators,
  useAllOrganizations,
  useAllProjects,
  useDashboardSettings,
} from "@/lib/hooks/use-api";
import {
  customAnalysisChartMode,
  customAnalysisStateToQuery,
  customAnalysisToDashboardChartPayload,
  getCustomAnalysisDimensions,
} from "@/lib/analytics/custom-analysis-adapter";
import { buildAnalyticsFacts, buildConsolidatedMatrix } from "@/lib/analytics/query-builder";
import { buildVisualizationResult } from "@/lib/visualization/engine";
import { resolveOrgScope } from "@/lib/analytics/org-scope";
import { getDisaggregationLabel, getUnionDisaggregationKeys } from "@/lib/analytics/disaggregation";
import { dashboardSettingsService } from "@/lib/api";
import type { ChartFieldName } from "@/lib/api";
import type { Indicator, Organization } from "@/lib/types";

const EMPTY_INDICATORS: Indicator[] = [];

function buildVisualizerInitialState(): CustomAnalysisState {
  return {
    ...createDefaultCustomAnalysisState(null),
    useDashboardFilters: false,
    scopeMode: "all_orgs",
  };
}

export function VisualizerWorkspace() {
  const { toast } = useToast();
  const { user } = useAuth();

  const [state, setState] = useState<CustomAnalysisState>(buildVisualizerInitialState);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saveDashboardId, setSaveDashboardId] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [savingHome, setSavingHome] = useState(false);

  const { data: indicatorsData } = useAllIndicators();
  const { data: projectsData } = useAllProjects();
  const { data: organizationsData } = useAllOrganizations();
  const { data: dashboardSettingsData } = useDashboardSettings({ page: 1 });

  const aggregateFilters = useMemo(
    () => ({
      project: state.projectId && state.projectId !== "all" ? state.projectId : undefined,
      date_from: state.dateFrom || undefined,
      date_to: state.dateTo || undefined,
      status: "approved",
    }),
    [state.dateFrom, state.dateTo, state.projectId],
  );

  const { data: aggregates = [], isLoading } = useAllAggregates(aggregateFilters);

  const indicators = useMemo<Indicator[]>(() => (indicatorsData ?? EMPTY_INDICATORS) as Indicator[], [indicatorsData]);
  const projects = useMemo(
    () => (projectsData?.results || []) as Array<{ id: string | number; name?: string }>,
    [projectsData?.results],
  );
  const organizations = useMemo<Organization[]>(
    () => (organizationsData?.results || []) as Organization[],
    [organizationsData?.results],
  );
  const dashboards = dashboardSettingsData?.results ?? [];

  const organizationsById = useMemo(
    () => new Map(organizations.map((org) => [String(org.id), org])),
    [organizations],
  );
  const indicatorsById = useMemo(
    () => new Map(indicators.map((indicator) => [String(indicator.id), indicator])),
    [indicators],
  );

  const selectedIndicators = useMemo(
    () => indicators.filter((indicator) => state.indicatorIds.includes(String(indicator.id))),
    [indicators, state.indicatorIds],
  );

  const breakdownFields = useMemo(() => {
    const source = selectedIndicators.length > 0 ? selectedIndicators : indicators;
    return getUnionDisaggregationKeys(source).map((key) => ({
      value: key as ChartFieldName,
      label: getDisaggregationLabel(key, source),
    }));
  }, [indicators, selectedIndicators]);

  const parentOrganizations = useMemo(
    () =>
      organizations.filter((organization) =>
        organizations.some((candidate) => candidate.parentId === organization.id),
      ),
    [organizations],
  );

  const userOrgId = useMemo(() => String(getUserOrganizationId(user) ?? ""), [user]);

  const scope = useMemo(
    () =>
      resolveOrgScope({
        organizations,
        scopeMode: state.scopeMode,
        currentUserOrgId: userOrgId || null,
        parentOrgId: state.parentOrgId || null,
        selectedOrgIds: state.selectedOrgIds,
      }),
    [organizations, state.parentOrgId, state.scopeMode, state.selectedOrgIds, userOrgId],
  );

  const query = useMemo(() => customAnalysisStateToQuery(state), [state]);

  const facts = useMemo(
    () =>
      buildAnalyticsFacts({
        aggregates,
        organizationsById,
        indicatorsById,
        query,
        scopedOrgIds: scope.resolvedOrgIds,
      }),
    [aggregates, indicatorsById, organizationsById, query, scope.resolvedOrgIds],
  );

  const selectedPeriods = useMemo(() => {
    if (state.periodMode === "date-range") {
      return ["Selected Range"];
    }
    if (state.selectedPeriods.length > 0) return state.selectedPeriods;
    return Array.from(new Set(facts.map((fact) => fact.periodLabel)));
  }, [facts, state.periodMode, state.selectedPeriods]);

  const dimensions = useMemo(() => getCustomAnalysisDimensions(state), [state]);

  const visualization = useMemo(
    () =>
      buildVisualizationResult({
        records: facts,
        dimensions,
        indicators: selectedIndicators,
        organizations,
        scopedOrgIds: scope.resolvedOrgIds,
        selectedPeriods,
        periodMode: state.periodMode,
        projectId: query.project_id,
        comparisonMode: state.compareBy,
        chartMode: customAnalysisChartMode(state.showAs),
      }),
    [
      dimensions,
      facts,
      organizations,
      query.project_id,
      scope.resolvedOrgIds,
      selectedIndicators,
      selectedPeriods,
      state.compareBy,
      state.periodMode,
      state.showAs,
    ],
  );

  const pivotMatrix = useMemo(() => {
    if (state.showAs !== "matrix") return null;
    return buildConsolidatedMatrix({
      facts,
      rowDimensionKey: dimensions[0] || "organization",
      columnDimensionKey: dimensions[1] || "sex",
    });
  }, [dimensions, facts, state.showAs]);

  const hasIndicators = state.indicatorIds.length > 0;
  const hasData = facts.length > 0;

  const downloadRows = useMemo<ExcelRow[]>(() => {
    const header: ExcelRow = ["Organization", "Indicator", "Period", "Disaggregation", "Value", "Notes"];
    const rows = visualization.table.rawRows.map((row) => [
      row.organization,
      row.indicator,
      row.period,
      row.disaggregationLabels,
      toExcelCellValue(row.submittedValue),
      row.notes,
    ]);
    return [header, ...rows];
  }, [visualization.table.rawRows]);

  const exportName = (state.title?.trim() || "data-visualizer").replace(/[^a-z0-9-_]+/gi, "-");

  const handleDownloadCsv = () => {
    const csv = downloadRows
      .map((row) =>
        row
          .map((cell) => {
            const text = cell === null || cell === undefined ? "" : String(cell);
            return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
          })
          .join(","),
      )
      .join("\n");
    triggerBlobDownload(new Blob([csv], { type: "text/csv;charset=utf-8" }), `${exportName}.csv`);
  };

  const handleDownloadExcel = () => {
    const workbook = XLSX.utils.book_new();
    appendWorksheetFromRows(workbook, "Data", downloadRows, "Data");
    const out = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
    triggerBlobDownload(
      new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
      `${exportName}.xlsx`,
    );
  };

  const handleSaveToDashboard = async () => {
    if (!saveDashboardId) {
      toast({ title: "Pick a dashboard", description: "Choose a dashboard to save this analysis to.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const chartService = dashboardSettingsService as unknown as {
        saveChart: (dashboardId: number, request: Record<string, unknown>) => Promise<unknown>;
      };
      await chartService.saveChart(
        Number(saveDashboardId),
        customAnalysisToDashboardChartPayload(state, saveName || state.title),
      );
      toast({ title: "Saved to dashboard", description: "Open the dashboard to view it." });
      setSaveOpen(false);
      setSaveName("");
    } catch (error) {
      console.error("Failed to save visualization", error);
      toast({ title: "Save failed", description: "Unable to save this analysis.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  // DHIS2-style "Add to dashboard": pin the current chart straight to the
  // organization's home dashboard (get-or-created server-side) so it appears on
  // /dashboard for everyone in the org.
  const handleAddToHomeDashboard = async () => {
    setSavingHome(true);
    try {
      const home = await dashboardSettingsService.getHome(user?.organizationId ?? undefined);
      const chartService = dashboardSettingsService as unknown as {
        saveChart: (dashboardId: number, request: Record<string, unknown>) => Promise<unknown>;
      };
      await chartService.saveChart(
        Number(home.id),
        customAnalysisToDashboardChartPayload(state, saveName || state.title),
      );
      toast({
        title: "Added to home dashboard",
        description: "This chart now shows on the home dashboard for your organization.",
      });
    } catch (error) {
      console.error("Failed to add to home dashboard", error);
      toast({
        title: "Couldn’t add to home dashboard",
        description: "Unable to share this chart. Confirm your organization scope and try again.",
        variant: "destructive",
      });
    } finally {
      setSavingHome(false);
    }
  };

  const renderPreview = () => {
    if (!hasIndicators) {
      return (
        <div className="rounded-[1.5rem] border border-dashed border-border bg-card px-6 py-16 text-center text-sm text-muted-foreground">
          Choose one or more indicators on the left to build a visualization.
        </div>
      );
    }
    if (isLoading) {
      return (
        <div className="flex h-64 items-center justify-center rounded-[1.5rem] border border-border bg-card">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      );
    }
    if (!hasData) {
      return (
        <div className="rounded-[1.5rem] border border-dashed border-border bg-card px-6 py-16 text-center text-sm text-muted-foreground">
          No approved aggregates match the current data, period, and organisation scope.
        </div>
      );
    }

    if (state.showAs === "kpi" || state.showAs === "progress") {
      return <KPIGrid items={visualization.kpis} />;
    }
    if (state.showAs === "table") {
      return <RawRecordsTable title="Data table" records={visualization.table.rawRows} />;
    }
    if (state.showAs === "matrix") {
      return <ConsolidatedMatrixTable title="Pivot table" matrix={pivotMatrix} />;
    }
    return <SmartChartRenderer chart={visualization.recommendedChart} />;
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(320px,380px)_1fr]">
      {/* Control panel */}
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Build a visualization</h2>
          <p className="text-sm text-muted-foreground">
            Pick your data, period, organisation scope, and how to break it down — the preview updates live.
          </p>
        </div>
        <CustomAnalysisBuilder
          value={state}
          onChange={setState}
          dashboard={null}
          indicators={indicators}
          projects={projects}
          organizations={organizations}
          breakdownFields={breakdownFields}
          parentOrganizations={parentOrganizations}
          standalone
        />
      </div>

      {/* Preview */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Badge variant="secondary">{selectedIndicators.length} indicator{selectedIndicators.length === 1 ? "" : "s"}</Badge>
            <Badge variant="outline">{scope.resolvedOrgIds.length} org{scope.resolvedOrgIds.length === 1 ? "" : "s"} in scope</Badge>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleDownloadCsv} disabled={!hasData}>
              <Download className="mr-2 h-4 w-4" />
              CSV
            </Button>
            <Button variant="outline" size="sm" onClick={handleDownloadExcel} disabled={!hasData}>
              <Download className="mr-2 h-4 w-4" />
              Excel
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleAddToHomeDashboard}
              disabled={!hasIndicators || savingHome}
            >
              {savingHome ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Home className="mr-2 h-4 w-4" />}
              Add to home dashboard
            </Button>
            <Button size="sm" onClick={() => setSaveOpen(true)} disabled={!hasIndicators}>
              <Save className="mr-2 h-4 w-4" />
              Save to dashboard
            </Button>
          </div>
        </div>

        <div className="rounded-[1.5rem] border border-border bg-card p-4 shadow-sm">{renderPreview()}</div>
      </div>

      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Save to dashboard</DialogTitle>
            <DialogDescription>Add this visualization as a chart on a dashboard.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-2">
              <Label>Dashboard</Label>
              <Select value={saveDashboardId} onValueChange={setSaveDashboardId}>
                <SelectTrigger>
                  <SelectValue placeholder={dashboards.length ? "Select a dashboard" : "No dashboards yet"} />
                </SelectTrigger>
                <SelectContent>
                  {dashboards.map((dashboard) => (
                    <SelectItem key={dashboard.id} value={String(dashboard.id)}>
                      {dashboard.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="visualizer-save-name">Chart name</Label>
              <Input
                id="visualizer-save-name"
                value={saveName}
                onChange={(event) => setSaveName(event.target.value)}
                placeholder={state.title || "Custom analysis"}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveToDashboard} disabled={saving || !saveDashboardId}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
