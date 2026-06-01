"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";

import type { CustomAnalysisState } from "@/components/analysis/custom-analysis-builder";
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
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  dashboardSettingsService,
  type DashboardSetting,
  type IndicatorChartSetting,
} from "@/lib/api";
import {
  useAllIndicators,
  useAllOrganizations,
  useAllProjects,
  useDashboardMeta,
} from "@/lib/hooks/use-api";

type AnalysisTemplateMode = "standard" | "custom";
type LegacyChartType = "bar" | "line" | "pie";

type DashboardChartSettingsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dashboard: DashboardSetting | null;
  existing?: IndicatorChartSetting | null;
  initialCustomAnalysis?: Partial<CustomAnalysisState> | null;
  onSaved: (dashboardId?: number) => Promise<void> | void;
};

type FieldOption = {
  value: string;
  label: string;
};

type LegacyIndicatorReference = { id?: string | number | null } | string | number | null | undefined;
type IndicatorDimension = { key?: string | null; label?: string | null };
type IndicatorLike = {
  id?: string | number | null;
  name?: string | null;
  type?: string | null;
  aggregate_disaggregation_config?: { dimensions?: IndicatorDimension[] | null } | null;
};
type SelectOption = { value: string; label: string };
type EntityWithId = { id?: string | number | null };
type LegacyExistingChart = IndicatorChartSetting & {
  template_mode?: AnalysisTemplateMode;
  indicator_ids?: Array<string | number> | null;
  indicators?: LegacyIndicatorReference[];
  target?: boolean;
  trendline?: boolean;
  date_from?: string | null;
  date_to?: string | null;
  filters?: unknown[];
};
type DashboardWithBreakdowns = DashboardSetting & { breakdowns?: unknown[] };

const EMPTY_ITEMS: IndicatorLike[] = [];
const EMPTY_ENTITIES: EntityWithId[] = [];
const DEFAULT_CHART_TYPES: Array<{ value: LegacyChartType; label: string }> = [
  { value: "bar", label: "Bar" },
  { value: "line", label: "Line" },
  { value: "pie", label: "Pie" },
];
const DEFAULT_AXES = [
  { value: "quarter", label: "Quarter" },
  { value: "month", label: "Month" },
];

function normalizeArray(values?: Array<string | number> | null): number[] {
  return (values ?? [])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
}

function toLegacyIndicatorId(value: LegacyIndicatorReference): string | number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "object") {
    return value.id ?? null;
  }
  return value;
}

function inferExistingMode(
  existing?: IndicatorChartSetting | null,
  initialCustomAnalysis?: Partial<CustomAnalysisState> | null,
): AnalysisTemplateMode {
  if (initialCustomAnalysis) return "custom";
  const explicitMode = (existing as LegacyExistingChart | null | undefined)?.template_mode;
  if (explicitMode === "custom" || explicitMode === "standard") return explicitMode;
  return "standard";
}

function buildExistingCustomState(
  existing?: IndicatorChartSetting | null,
  initialCustomAnalysis?: Partial<CustomAnalysisState> | null,
): Partial<CustomAnalysisState> {
  if (initialCustomAnalysis) {
    return initialCustomAnalysis;
  }

  if (!existing) {
    return {};
  }

  const existingChart = existing as LegacyExistingChart;
  const rawChartType = String(existingChart.chart_type ?? "bar");
  const showAs: CustomAnalysisState["showAs"] =
    rawChartType === "line"
      ? "line"
      : rawChartType === "pie"
        ? "donut"
        : Boolean(existingChart.tabular)
          ? "table"
          : "bar";

  return {
    indicatorIds: normalizeArray(
      existingChart.indicator_ids ??
        existingChart.indicators?.map((indicator) => toLegacyIndicatorId(indicator)).filter(
          (indicator): indicator is string | number => indicator !== null,
        ),
    ).map((value) => String(value)),
    showAs,
    calculateUsing: Boolean(existingChart.average) ? "average" : "sum",
    breakDownBy: existingChart.legend ?? "none",
    secondaryBreakdown: existingChart.stack ?? "none",
    targetLine: Boolean(existingChart.target),
    includeDataTable: Boolean(existingChart.tabular),
    trendLine: Boolean(existingChart.trendline),
    dateFrom: existingChart.date_from ?? "",
    dateTo: existingChart.date_to ?? "",
  };
}

function buildFieldOptions(selectedIndicators: IndicatorLike[]): FieldOption[] {
  const seen = new Map<string, string>();

  for (const indicator of selectedIndicators) {
    const dimensions = indicator?.aggregate_disaggregation_config?.dimensions ?? [];
    for (const dimension of dimensions) {
      const key = String(dimension?.key ?? "").trim();
      const label = String(dimension?.label ?? key).trim();
      if (!key || seen.has(key)) continue;
      seen.set(key, label || key);
    }
  }

  return Array.from(seen.entries()).map(([value, label]) => ({ value, label }));
}

export function DashboardChartSettingsDialog(
  props: DashboardChartSettingsDialogProps,
) {
  const { open, onOpenChange, dashboard, existing, initialCustomAnalysis, onSaved } = props;
  const { toast } = useToast();

  const { data: indicatorsData } = useAllIndicators();
  const { data: projectsData } = useAllProjects();
  const { data: organizationsData } = useAllOrganizations();
  const { data: dashboardMeta } = useDashboardMeta();

  const indicators = indicatorsData ?? EMPTY_ITEMS;
  const projects: EntityWithId[] = (projectsData?.results as EntityWithId[] | undefined) ?? EMPTY_ENTITIES;
  const organizations: EntityWithId[] =
    (organizationsData?.results as EntityWithId[] | undefined) ?? EMPTY_ENTITIES;
  const chartTypes: SelectOption[] = (dashboardMeta?.chart_types as SelectOption[] | undefined) ?? DEFAULT_CHART_TYPES;
  const axes: SelectOption[] = (dashboardMeta?.axes as SelectOption[] | undefined) ?? DEFAULT_AXES;
  const dashboardBreakdowns =
    dashboardMeta?.dashboard_breakdowns ??
    dashboardMeta?.breakdowns ??
    (dashboard as DashboardWithBreakdowns | null)?.breakdowns ??
    [];

  const [saving, setSaving] = useState(false);

  const [analysisTemplate, setAnalysisTemplate] = useState<AnalysisTemplateMode>("standard");
  const [name, setName] = useState("");
  const [indicatorSearch, setIndicatorSearch] = useState("");
  const [selectedIndicatorIds, setSelectedIndicatorIds] = useState<number[]>([]);
  const [chartType, setChartType] = useState<LegacyChartType>("bar");
  const [axis, setAxis] = useState<"quarter" | "month">("quarter");
  const [legend, setLegend] = useState<string | "none">("none");
  const [stack, setStack] = useState<string | "none">("none");
  const [useTarget, setUseTarget] = useState(false);
  const [average, setAverage] = useState(false);
  const [tabular, setTabular] = useState(false);
  const [useTrendLine, setUseTrendLine] = useState(false);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [customJson, setCustomJson] = useState("{}");

  useEffect(() => {
    if (!open) return;

    const mode = inferExistingMode(existing, initialCustomAnalysis);
    const customState = buildExistingCustomState(existing, initialCustomAnalysis);
    const existingChart = existing as LegacyExistingChart | null | undefined;

    setAnalysisTemplate(mode);
    setName(existingChart?.name ?? "");
    setSelectedIndicatorIds(
      normalizeArray(
        existingChart?.indicator_ids ??
          existingChart?.indicators?.map((indicator) => toLegacyIndicatorId(indicator)).filter(
            (indicator): indicator is string | number => indicator !== null,
          ),
      ),
    );
    setChartType(existingChart?.chart_type ?? "bar");
    setAxis((existingChart?.axis as "quarter" | "month" | undefined) ?? "quarter");
    setLegend(existingChart?.legend ?? "none");
    setStack(existingChart?.stack ?? "none");
    setUseTarget(Boolean(existingChart?.target));
    setAverage(Boolean(existingChart?.average));
    setTabular(Boolean(existingChart?.tabular));
    setUseTrendLine(Boolean(existingChart?.trendline));
    setStart(existingChart?.date_from ?? "");
    setEnd(existingChart?.date_to ?? "");
    setIndicatorSearch("");
    setCustomJson(JSON.stringify(customState, null, 2));
  }, [existing, initialCustomAnalysis, open]);

  const filteredIndicators = useMemo(() => {
    const query = indicatorSearch.trim().toLowerCase();
    if (!query) return indicators;
    return indicators.filter((indicator) =>
      String(indicator?.name ?? "").toLowerCase().includes(query),
    );
  }, [indicatorSearch, indicators]);

  const selectedIndicators = useMemo(
    () =>
      indicators.filter((indicator) =>
        selectedIndicatorIds.includes(Number(indicator?.id)),
      ),
    [indicators, selectedIndicatorIds],
  );

  const fieldOptions = useMemo(
    () => buildFieldOptions(selectedIndicators),
    [selectedIndicators],
  );

  const canAverage =
    selectedIndicatorIds.length === 1 &&
    String(selectedIndicators[0]?.type ?? "").toLowerCase() === "number" &&
    chartType !== "pie";

  const canSetAxis = chartType !== "pie";
  const canUseTargets = chartType !== "pie";
  const legendDisabled = fieldOptions.length === 0;
  const stackDisabled = chartType !== "bar" || fieldOptions.length === 0;

  useEffect(() => {
    const validFields = new Set(fieldOptions.map((field) => field.value));

    if (legend !== "none" && !validFields.has(legend)) {
      setLegend("none");
    }

    if (stack !== "none" && !validFields.has(stack)) {
      setStack("none");
    }

    if (!canAverage && average) {
      setAverage(false);
    }

    if (!canSetAxis && axis !== "quarter") {
      setAxis("quarter");
    }

    if (!canUseTargets && useTarget) {
      setUseTarget(false);
    }

    if (chartType !== "line" && useTrendLine) {
      setUseTrendLine(false);
    }
  }, [
    average,
    axis,
    canAverage,
    canSetAxis,
    canUseTargets,
    chartType,
    fieldOptions,
    legend,
    stack,
    useTarget,
    useTrendLine,
  ]);

  const toggleIndicator = (indicatorId: number) => {
    setSelectedIndicatorIds((current) =>
      current.includes(indicatorId)
        ? current.filter((value) => value !== indicatorId)
        : [...current, indicatorId],
    );
  };

  const handleSave = async () => {
    if (saving || !dashboard?.id) return;

    if (analysisTemplate === "standard" && selectedIndicatorIds.length === 0) {
      toast({
        title: "Indicator required",
        description: "Choose at least one indicator.",
        variant: "destructive",
      });
      return;
    }

    if (
      analysisTemplate === "standard" &&
      chartType === "pie" &&
      selectedIndicatorIds.length === 1 &&
      legend === "none"
    ) {
      toast({
        title: "Legend required",
        description: "Single-indicator pie charts require a legend/disaggregate.",
        variant: "destructive",
      });
      return;
    }

    if (analysisTemplate === "standard" && legend !== "none" && legend === stack) {
      toast({
        title: "Invalid configuration",
        description: "Legend and stacking cannot use the same field.",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    try {
      const chartService = dashboardSettingsService as unknown as {
        updateChart: (dashboardId: number, chartId: number, request: Record<string, unknown>) => Promise<unknown>;
        saveChart: (dashboardId: number, request: Record<string, unknown>) => Promise<unknown>;
      };

      if (analysisTemplate === "custom") {
        let parsedCustomState: Record<string, unknown>;
        try {
          parsedCustomState = JSON.parse(customJson);
        } catch {
          toast({
            title: "Invalid custom JSON",
            description: "Custom analysis JSON is not valid.",
            variant: "destructive",
          });
          setSaving(false);
          return;
        }

        const payload = {
          ...(existing ?? {}),
          name: name.trim() || (existing as LegacyExistingChart | null | undefined)?.name || "Custom analysis",
          template_mode: "custom",
          custom_analysis: parsedCustomState,
        };

        if (existing?.id) {
          await chartService.updateChart(dashboard.id, existing.id, payload);
        } else {
          await chartService.saveChart(dashboard.id, payload);
        }
      } else {
        const payload = {
          ...(existing ?? {}),
          name: name.trim(),
          chart_type: chartType,
          axis: canSetAxis ? axis : null,
          legend: legend === "none" ? null : legend,
          stack: stack === "none" ? null : stack,
          target: canUseTargets ? useTarget : false,
          average: canAverage ? average : false,
          tabular,
          trendline: chartType === "line" ? useTrendLine : false,
          date_from: start || null,
          date_to: end || null,
          indicator_ids: selectedIndicatorIds,
          project_ids: projects.map((project) => Number(project.id)),
          organization_ids: organizations.map((organization) => Number(organization.id)),
          dashboard_breakdowns: dashboardBreakdowns,
          template_mode: "standard",
        };

        if (existing?.id) {
          await chartService.updateChart(dashboard.id, existing.id, payload);
        } else {
          await chartService.saveChart(dashboard.id, payload);
        }
      }

      await onSaved(dashboard.id);
      onOpenChange(false);

      toast({
        title: existing?.id ? "Analysis updated" : "Analysis added",
        description:
          analysisTemplate === "custom"
            ? "Custom analysis saved."
            : "Dashboard analysis saved.",
      });
    } catch (error) {
      console.error("Failed to save chart", error);
      toast({
        title: "Save failed",
        description: "Unable to save this analysis.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[60rem]">
        <DialogHeader>
          <DialogTitle>{existing?.id ? "Edit Analysis" : "Add Analysis"}</DialogTitle>
          <DialogDescription>
            Configure a saved analysis for this dashboard.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="analysis-name">Analysis name</Label>
            <Input
              id="analysis-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Quarterly HIV prevention coverage"
            />
          </div>

          <Tabs
            value={analysisTemplate}
            onValueChange={(value) => setAnalysisTemplate(value as AnalysisTemplateMode)}
          >
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="standard">Standard</TabsTrigger>
              <TabsTrigger value="custom">Custom</TabsTrigger>
            </TabsList>

            <TabsContent value="standard" className="space-y-4 pt-4">
              <div className="grid gap-2">
                <Label htmlFor="indicator-search">Indicators</Label>
                <Input
                  id="indicator-search"
                  value={indicatorSearch}
                  onChange={(event) => setIndicatorSearch(event.target.value)}
                  placeholder="Search indicators"
                />
                <div className="max-h-56 overflow-auto rounded-xl border p-2">
                  <div className="grid gap-2">
                    {filteredIndicators.map((indicator) => (
                      <label
                        key={indicator.id}
                        className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm"
                      >
                        <span className="min-w-0 truncate">{indicator.name}</span>
                        <input
                          type="checkbox"
                          checked={selectedIndicatorIds.includes(Number(indicator.id))}
                          onChange={() => toggleIndicator(Number(indicator.id))}
                        />
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="grid gap-2">
                  <Label>Show as</Label>
                  <Select
                    value={chartType}
                    onValueChange={(value) => setChartType(value as LegacyChartType)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select chart type" />
                    </SelectTrigger>
                    <SelectContent>
                      {chartTypes.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid gap-2">
                  <Label>Compare by period</Label>
                  <Select
                    value={axis}
                    onValueChange={(value) => setAxis(value as "quarter" | "month")}
                    disabled={!canSetAxis}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select axis" />
                    </SelectTrigger>
                    <SelectContent>
                      {axes.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="grid gap-2">
                  <Label>Legend disaggregate</Label>
                  <Select
                    value={legend}
                    onValueChange={(value) => setLegend(value)}
                    disabled={legendDisabled}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="No legend" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {fieldOptions.map((field) => (
                        <SelectItem key={field.value} value={field.value}>
                          {field.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid gap-2">
                  <Label>Stacking</Label>
                  <Select
                    value={stack}
                    onValueChange={(value) => setStack(value)}
                    disabled={stackDisabled}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="No stack" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {fieldOptions.map((field) => (
                        <SelectItem key={field.value} value={field.value}>
                          {field.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <label className="flex items-center justify-between rounded-xl border px-4 py-3 text-sm">
                  <span>Targets vs achieved</span>
                  <Switch
                    checked={useTarget}
                    onCheckedChange={setUseTarget}
                    disabled={!canUseTargets}
                  />
                </label>

                <label className="flex items-center justify-between rounded-xl border px-4 py-3 text-sm">
                  <span>Use average</span>
                  <Switch
                    checked={average}
                    onCheckedChange={setAverage}
                    disabled={!canAverage}
                  />
                </label>

                <label className="flex items-center justify-between rounded-xl border px-4 py-3 text-sm">
                  <span>Include data table</span>
                  <Switch checked={tabular} onCheckedChange={setTabular} />
                </label>

                <label className="flex items-center justify-between rounded-xl border px-4 py-3 text-sm">
                  <span>Trend line</span>
                  <Switch
                    checked={useTrendLine}
                    onCheckedChange={setUseTrendLine}
                    disabled={chartType !== "line"}
                  />
                </label>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="grid gap-2">
                  <Label>Start date</Label>
                  <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
                </div>
                <div className="grid gap-2">
                  <Label>End date</Label>
                  <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
                </div>
              </div>
            </TabsContent>

            <TabsContent value="custom" className="space-y-4 pt-4">
              <div className="grid gap-2">
                <Label htmlFor="custom-analysis-json">Custom analysis JSON</Label>
                <Textarea
                  id="custom-analysis-json"
                  value={customJson}
                  onChange={(event) => setCustomJson(event.target.value)}
                  className="min-h-[22rem] font-mono text-xs"
                />
              </div>
            </TabsContent>
          </Tabs>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || !dashboard?.id}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save Analysis
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
