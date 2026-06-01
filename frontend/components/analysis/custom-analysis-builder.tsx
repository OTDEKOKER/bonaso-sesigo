"use client";

import { useEffect, useMemo, useState } from "react";

import { OrganizationMultiSelect } from "@/components/shared/organization-multi-select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { ChartFieldName, DashboardChartRequest, DashboardSetting } from "@/lib/api";
import {
  METRIC_FILTER_FLAG_APPLY_TREND_LINE,
  METRIC_FILTER_FLAG_COMPARE_BY_COORDINATOR,
  METRIC_FILTER_FLAG_COMPARE_BY_ORGANIZATION,
} from "@/lib/analytics/chart-filter-flags";
import type { AnalyticsScopeMode } from "@/lib/analytics/org-scope";
import type { Indicator, Organization } from "@/lib/types";

type SelectOption = {
  value: string;
  label: string;
};

export type CustomAnalysisShowAs =
  | "kpi"
  | "bar"
  | "stacked-bar"
  | "line"
  | "area"
  | "donut"
  | "table"
  | "matrix"
  | "heatmap"
  | "progress";

export type CustomAnalysisState = {
  title: string;
  indicatorId: string;
  indicatorIds: string[];
  showAs: CustomAnalysisShowAs;
  calculateUsing: "sum" | "average" | "count" | "latest";
  compareBy: "none" | "period" | "organization" | "coordinator" | "indicator";
  breakDownBy: string;
  secondaryBreakdown: string;
  compareWith: string;
  useDashboardFilters: boolean;
  projectId: string;
  periodMode: "quarter" | "month" | "date-range";
  selectedPeriods: string[];
  dateFrom: string;
  dateTo: string;
  scopeMode: AnalyticsScopeMode;
  parentOrgId: string;
  selectedOrgIds: string[];
  showTotals: boolean;
  showLegend: boolean;
  includeDataTable: boolean;
  showPercentages: boolean;
  sortOrder: "ascending" | "descending";
  topN: string;
  targetLine: boolean;
  trendLine: boolean;
};

type ValidationIssue = {
  level: "error" | "warning";
  message: string;
};

type BreakdownFieldOption = {
  value: ChartFieldName | "none";
  label: string;
};

type CustomAnalysisBuilderProps = {
  value: CustomAnalysisState;
  onChange: (next: CustomAnalysisState) => void;
  dashboard: DashboardSetting | null;
  indicators: Indicator[];
  projects: Array<{ id: string | number; name?: string }>;
  organizations: Organization[];
  breakdownFields: BreakdownFieldOption[];
  parentOrganizations: Organization[];
};

const SHOW_AS_OPTIONS: Array<{ value: CustomAnalysisShowAs; label: string }> = [
  { value: "kpi", label: "KPI Card" },
  { value: "bar", label: "Bar Chart" },
  { value: "stacked-bar", label: "Stacked Bar" },
  { value: "line", label: "Line Chart" },
  { value: "area", label: "Area Chart" },
  { value: "donut", label: "Pie Chart" },
  { value: "table", label: "Table" },
  { value: "matrix", label: "Matrix" },
  { value: "heatmap", label: "Heatmap" },
  { value: "progress", label: "Progress Card" },
];

const CALCULATION_OPTIONS: Array<SelectOption> = [
  { value: "sum", label: "Sum" },
  { value: "average", label: "Average" },
  { value: "count", label: "Count" },
  { value: "latest", label: "Latest value" },
];

const COMPARE_BY_OPTIONS: Array<SelectOption> = [
  { value: "none", label: "None" },
  { value: "period", label: "Period" },
  { value: "indicator", label: "Indicators" },
  { value: "organization", label: "Organization" },
  { value: "coordinator", label: "Coordinator" },
];

const COMPARE_WITH_OPTIONS: Array<SelectOption> = [
  { value: "none", label: "Nothing else" },
  { value: "target", label: "Target line" },
  { value: "secondary_breakdown", label: "Secondary breakdown" },
];

const PERIOD_MODE_OPTIONS: Array<SelectOption> = [
  { value: "quarter", label: "Quarter" },
  { value: "month", label: "Month" },
  { value: "date-range", label: "Date range" },
];

const ORG_SCOPE_OPTIONS: Array<{ value: AnalyticsScopeMode; label: string }> = [
  { value: "all_orgs", label: "All organizations" },
  { value: "parent_org", label: "Parent + descendants" },
  { value: "selected_orgs", label: "Selected sub-grantees" },
  { value: "self_only", label: "Self only" },
];

function buildGeneratedPeriodOptions(mode: CustomAnalysisState["periodMode"]) {
  const now = new Date();
  const currentYear = now.getFullYear();

  if (mode === "month") {
    return Array.from({ length: 12 }, (_, index) => {
      const date = new Date(currentYear, index, 1);
      const label = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" }).format(date);
      return { value: label, label };
    });
  }

  return [currentYear - 1, currentYear, currentYear + 1].flatMap((year) =>
    [1, 2, 3, 4].map((quarter) => ({
      value: `Q${quarter} ${year}`,
      label: `Q${quarter} ${year}`,
    })),
  );
}

function cloneState(state: CustomAnalysisState): CustomAnalysisState {
  return {
    ...state,
    indicatorIds: [...state.indicatorIds],
    selectedPeriods: [...state.selectedPeriods],
    selectedOrgIds: [...state.selectedOrgIds],
  };
}

export function getCustomAnalysisIndicatorIds(
  state: Pick<CustomAnalysisState, "indicatorId" | "indicatorIds">,
) {
  return Array.from(
    new Set(
      [...state.indicatorIds, state.indicatorId]
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
    ),
  );
}

export function createDefaultCustomAnalysisState(dashboard: DashboardSetting | null): CustomAnalysisState {
  return {
    title: "",
    indicatorId: "",
    indicatorIds: [],
    showAs: "bar",
    calculateUsing: "sum",
    compareBy: "none",
    breakDownBy: "none",
    secondaryBreakdown: "none",
    compareWith: "none",
    useDashboardFilters: true,
    projectId: dashboard?.project ? String(dashboard.project) : "all",
    periodMode: "quarter",
    selectedPeriods: [],
    dateFrom: "",
    dateTo: "",
    scopeMode: dashboard?.organization ? (dashboard.cascade_organization ? "parent_org" : "selected_orgs") : "all_orgs",
    parentOrgId: dashboard?.cascade_organization && dashboard.organization ? String(dashboard.organization) : "",
    selectedOrgIds: dashboard?.organization && !dashboard.cascade_organization ? [String(dashboard.organization)] : [],
    showTotals: true,
    showLegend: true,
    includeDataTable: false,
    showPercentages: false,
    sortOrder: "descending",
    topN: "",
    targetLine: false,
    trendLine: false,
  };
}

export function applyCustomAnalysisSmartDefaults(state: CustomAnalysisState): CustomAnalysisState {
  const next = cloneState(state);

  if ((next.showAs === "line" || next.showAs === "area") && next.compareBy === "none") {
    next.compareBy = "period";
  }

  if (next.showAs === "kpi") {
    next.compareBy = "none";
    next.breakDownBy = "none";
    next.secondaryBreakdown = "none";
    next.showLegend = false;
    next.showTotals = true;
  }

  if (next.compareBy === "organization" || next.compareBy === "coordinator") next.sortOrder = "descending";
  if (next.compareBy === "indicator") {
    next.breakDownBy = "none";
    next.secondaryBreakdown = "none";
  }
  if (next.compareWith === "target") next.targetLine = true;
  if (next.showAs !== "line" && next.showAs !== "area") next.trendLine = false;
  if (next.periodMode === "date-range") next.selectedPeriods = [];
  if (next.showAs !== "stacked-bar" && next.compareWith !== "secondary_breakdown") {
    next.secondaryBreakdown = next.showAs === "kpi" ? "none" : next.secondaryBreakdown;
  }

  return next;
}

export function validateCustomAnalysisState(
  state: CustomAnalysisState,
  indicator?: Indicator | null,
  breakdownFields?: BreakdownFieldOption[],
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const selectedIndicatorIds = getCustomAnalysisIndicatorIds(state);

  if (!state.title.trim()) issues.push({ level: "error", message: "Add a title in Basic Setup." });
  if (selectedIndicatorIds.length === 0) issues.push({ level: "error", message: "Select at least one indicator before saving." });
  if (state.compareBy === "indicator" && selectedIndicatorIds.length < 2) {
    issues.push({ level: "error", message: "Indicator comparison needs at least two selected indicators." });
  }
  if (state.showAs === "matrix" && state.breakDownBy === "none") {
    issues.push({ level: "error", message: "Matrix analyses need at least one breakdown dimension." });
  }
  if (!state.useDashboardFilters && state.periodMode === "date-range" && (!state.dateFrom || !state.dateTo)) {
    issues.push({ level: "error", message: "Set both start and end dates for a custom date range." });
  }
  if (!state.useDashboardFilters && state.periodMode !== "date-range" && state.selectedPeriods.length === 0) {
    issues.push({ level: "warning", message: "No custom reporting periods selected. The analysis will use all available periods." });
  }
  if (state.breakDownBy !== "none" && state.secondaryBreakdown !== "none" && state.breakDownBy === state.secondaryBreakdown) {
    issues.push({ level: "error", message: "Break down by and Secondary breakdown must be different." });
  }
  if (state.compareWith === "secondary_breakdown" && state.secondaryBreakdown === "none") {
    issues.push({ level: "warning", message: "Choose a secondary breakdown or change Compare with." });
  }
  if (state.showAs === "donut" && state.breakDownBy !== "none" && indicator?.aggregate_disaggregation_config?.dimensions) {
    const matching = indicator.aggregate_disaggregation_config.dimensions.find(
      (dimension) => String(dimension.key) === state.breakDownBy,
    );
    if ((matching?.values?.length || 0) > 8) {
      issues.push({ level: "warning", message: "Pie charts become hard to read with many categories. Consider a bar chart or Top N." });
    }
  }
  if (state.breakDownBy !== "none" && breakdownFields && !breakdownFields.some((field) => field.value === state.breakDownBy)) {
    issues.push({ level: "warning", message: "The selected breakdown is not available for this indicator." });
  }

  return issues;
}

export function buildCustomAnalysisSummarySentence(
  state: CustomAnalysisState,
  indicator?: Indicator | null,
  breakdownFields?: BreakdownFieldOption[],
) {
  const selectedIndicatorIds = getCustomAnalysisIndicatorIds(state);
  const indicatorName =
    selectedIndicatorIds.length > 1
      ? `${selectedIndicatorIds.length} indicators`
      : indicator?.name || "the selected indicator";
  const showAsLabel = SHOW_AS_OPTIONS.find((option) => option.value === state.showAs)?.label || "analysis";
  const compareByLabel = COMPARE_BY_OPTIONS.find((option) => option.value === state.compareBy)?.label.toLowerCase() || "none";
  const breakDownLabel = breakdownFields?.find((field) => field.value === state.breakDownBy)?.label || "no breakdown";

  const parts = [
    `Create a ${showAsLabel.toLowerCase()} for ${indicatorName}`,
    state.compareBy !== "none" ? `compare by ${compareByLabel}` : null,
    state.breakDownBy !== "none" ? `break down by ${breakDownLabel.toLowerCase()}` : null,
    state.useDashboardFilters ? "using dashboard filters" : "using custom overrides",
  ].filter(Boolean);

  return `${parts.join(", ")}.`;
}

export function mapCustomAnalysisToDashboardChartRequest(state: CustomAnalysisState): DashboardChartRequest {
  const selectedIndicatorIds = getCustomAnalysisIndicatorIds(state);
  const chartType =
    state.showAs === "line" || state.showAs === "area"
      ? "line"
      : state.showAs === "donut"
        ? "pie"
        : "bar";
  const axis = state.periodMode === "month" ? "month" : "quarter";
  const legend =
    state.showAs === "kpi"
      ? null
      : state.compareBy === "indicator"
        ? null
        : state.breakDownBy !== "none"
        ? (state.breakDownBy as ChartFieldName)
        : state.compareBy === "organization" || state.compareBy === "coordinator"
          ? ("organization" as ChartFieldName)
          : null;
  const stack =
    state.showAs === "stacked-bar" || state.compareWith === "secondary_breakdown"
      ? ((state.secondaryBreakdown !== "none" ? state.secondaryBreakdown : state.breakDownBy) as ChartFieldName)
      : null;

  const organizationFilters =
    !state.useDashboardFilters && state.scopeMode === "selected_orgs"
      ? state.selectedOrgIds.map((organizationId) => ({
          field_detail: {
            name: "organization" as ChartFieldName,
            label: "Organization",
          },
          value: organizationId,
        }))
      : [];
  const comparisonModeFilters =
    state.compareBy === "coordinator"
      ? [
          {
            field_detail: {
              name: "metric" as ChartFieldName,
              label: "Metric",
            },
            value: METRIC_FILTER_FLAG_COMPARE_BY_COORDINATOR,
          },
        ]
      : state.compareBy === "organization"
        ? [
            {
              field_detail: {
                name: "metric" as ChartFieldName,
                label: "Metric",
              },
              value: METRIC_FILTER_FLAG_COMPARE_BY_ORGANIZATION,
            },
          ]
      : [];
  const trendLineModeFilters =
    state.trendLine
      ? [
          {
            field_detail: {
              name: "metric" as ChartFieldName,
              label: "Metric",
            },
            value: METRIC_FILTER_FLAG_APPLY_TREND_LINE,
          },
        ]
      : [];

  return {
    name: state.title.trim() || null,
    indicators: selectedIndicatorIds.map((indicatorId) => Number(indicatorId)),
    chart_type: chartType,
    axis: chartType === "pie" ? null : axis,
    tabular:
      state.includeDataTable ||
      state.showAs === "table" ||
      state.showAs === "matrix" ||
      state.showAs === "heatmap",
    legend,
    stack,
    use_target: state.targetLine || state.compareWith === "target" || state.showAs === "progress",
    filters: [...organizationFilters, ...comparisonModeFilters, ...trendLineModeFilters],
    average: state.calculateUsing === "average",
    repeat_only: false,
    repeat_n: state.topN.trim() ? Number(state.topN) || null : null,
    start: !state.useDashboardFilters && state.periodMode === "date-range" ? state.dateFrom || null : null,
    end: !state.useDashboardFilters && state.periodMode === "date-range" ? state.dateTo || null : null,
  };
}

function MultiSelectField(props: {
  options: SelectOption[];
  values: string[];
  onChange: (nextValues: string[]) => void;
  placeholder: string;
  disabled?: boolean;
}) {
  const { options, values, onChange, placeholder, disabled = false } = props;
  const [open, setOpen] = useState(false);
  const selectedSet = useMemo(() => new Set(values), [values]);

  const summary = useMemo(() => {
    if (values.length === 0) return placeholder;
    if (values.length === 1) {
      return options.find((option) => option.value === values[0])?.label || placeholder;
    }
    return `${values.length} selected`;
  }, [options, placeholder, values]);

  const toggleValue = (value: string) => {
    if (selectedSet.has(value)) {
      onChange(values.filter((entry) => entry !== value));
      return;
    }
    onChange([...values, value]);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="h-auto min-h-11 w-full justify-between gap-3 px-3 py-2" disabled={disabled}>
          <span className="min-w-0 flex-1 text-left whitespace-normal break-words leading-snug">{summary}</span>
          <span className="shrink-0 text-xs text-muted-foreground">{values.length}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="z-[70] w-[min(48rem,calc(100vw-2rem))] min-w-[var(--radix-popover-trigger-width)] p-0">
        <Command>
          <CommandInput placeholder="Search..." />
          <CommandList className="max-h-[20rem]">
            <CommandEmpty>No options found.</CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  value={`${option.label}-${option.value}`}
                  onSelect={() => toggleValue(option.value)}
                  className="items-start gap-3 py-3"
                >
                  <Checkbox checked={selectedSet.has(option.value)} className="mt-0.5 pointer-events-none" />
                  <span className="min-w-0 flex-1 whitespace-normal break-words leading-snug">{option.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export function CustomAnalysisBuilder(props: CustomAnalysisBuilderProps) {
  const {
    value,
    onChange,
    indicators,
    projects,
    organizations,
    breakdownFields,
    parentOrganizations,
  } = props;

  const breakdownOptions = useMemo<BreakdownFieldOption[]>(
    () => [{ value: "none", label: "None" }, ...breakdownFields],
    [breakdownFields],
  );
  const periodOptions = useMemo(() => buildGeneratedPeriodOptions(value.periodMode), [value.periodMode]);

  useEffect(() => {
    const next = applyCustomAnalysisSmartDefaults(value);
    const same = JSON.stringify(next) === JSON.stringify(value);
    if (!same) onChange(next);
  }, [onChange, value]);

  const projectOptions = projects.map((project) => ({
    value: String(project.id),
    label: project.name || `Project ${project.id}`,
  }));
  const indicatorOptions = indicators.map((indicator) => ({
    value: String(indicator.id),
    label: indicator.name,
  }));
  const parentOrgOptions = parentOrganizations.map((organization) => ({
    value: String(organization.id),
    label: organization.name,
  }));
  const selectedIndicatorIds = getCustomAnalysisIndicatorIds(value);
  const trendLineEnabled = value.showAs === "line" || value.showAs === "area";
  const usesIntrinsicTableLayout =
    value.showAs === "table" || value.showAs === "matrix" || value.showAs === "heatmap";

  return (
    <div className="min-w-0 space-y-4">
        <section className="rounded-[1.5rem] border border-border bg-[#fbfdff] p-4 shadow-sm">
          <div className="mb-4 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-base font-semibold text-foreground">Basic Setup</h3>
              <p className="text-sm text-muted-foreground">Start with the title, indicator, and how the analysis should appear.</p>
            </div>
            <Badge variant="outline" className="rounded-full px-3 py-1 text-xs">Advanced</Badge>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="grid gap-2 md:col-span-2">
              <Label htmlFor="custom-analysis-title">Title</Label>
              <Input
                id="custom-analysis-title"
                value={value.title}
                onChange={(event) => onChange({ ...value, title: event.target.value })}
                placeholder="Quarterly NCD message breakdown"
              />
            </div>
            <div className="grid gap-2 md:col-span-2">
              <Label>Indicators</Label>
              <MultiSelectField
                options={indicatorOptions}
                values={selectedIndicatorIds}
                onChange={(nextValues) =>
                  onChange({
                    ...value,
                    indicatorId: nextValues[0] ?? "",
                    indicatorIds: nextValues,
                  })
                }
                placeholder="Select indicators"
              />
            </div>
            <div className="grid gap-2">
              <Label>Show as</Label>
              <Select
                value={value.showAs}
                onValueChange={(nextValue) => onChange({ ...value, showAs: nextValue as CustomAnalysisShowAs })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select analysis output" />
                </SelectTrigger>
                <SelectContent>
                  {SHOW_AS_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </section>

        <section className="rounded-[1.5rem] border border-border bg-[#fbfdff] p-4 shadow-sm">
          <div className="mb-4">
            <h3 className="text-base font-semibold text-foreground">Scope and Filters</h3>
            <p className="text-sm text-muted-foreground">Use dashboard filters or override them just for this analysis.</p>
          </div>

          <div className="flex flex-col gap-3 rounded-[1.2rem] border border-border bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-sm font-medium text-foreground">Use dashboard filters</div>
              <div className="text-xs text-muted-foreground">Keep this analysis aligned with the dashboard-wide filter bar.</div>
            </div>
            <Switch checked={value.useDashboardFilters} onCheckedChange={(checked) => onChange({ ...value, useDashboardFilters: checked })} />
          </div>

          {!value.useDashboardFilters ? (
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div className="grid gap-2">
                <Label>Project</Label>
                <Select value={value.projectId || "all"} onValueChange={(nextValue) => onChange({ ...value, projectId: nextValue })}>
                  <SelectTrigger><SelectValue placeholder="All projects" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All projects</SelectItem>
                    {projectOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Period</Label>
                <Select
                  value={value.periodMode}
                  onValueChange={(nextValue) => onChange({ ...value, periodMode: nextValue as CustomAnalysisState["periodMode"], selectedPeriods: [] })}
                >
                  <SelectTrigger><SelectValue placeholder="Select period mode" /></SelectTrigger>
                  <SelectContent>
                    {PERIOD_MODE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {value.periodMode === "date-range" ? (
                <>
                  <div className="grid gap-2">
                    <Label>Start date</Label>
                    <Input type="date" value={value.dateFrom} onChange={(event) => onChange({ ...value, dateFrom: event.target.value })} />
                  </div>
                  <div className="grid gap-2">
                    <Label>End date</Label>
                    <Input type="date" value={value.dateTo} onChange={(event) => onChange({ ...value, dateTo: event.target.value })} />
                  </div>
                </>
              ) : (
                <div className="grid gap-2 md:col-span-2">
                  <Label>Selected periods</Label>
                  <MultiSelectField
                    options={periodOptions}
                    values={value.selectedPeriods}
                    onChange={(nextValues) => onChange({ ...value, selectedPeriods: nextValues })}
                    placeholder="Choose one or more periods"
                  />
                </div>
              )}
              <div className="grid gap-2">
                <Label>Organization scope</Label>
                <Select value={value.scopeMode} onValueChange={(nextValue) => onChange({ ...value, scopeMode: nextValue as AnalyticsScopeMode })}>
                  <SelectTrigger><SelectValue placeholder="Select organization scope" /></SelectTrigger>
                  <SelectContent>
                    {ORG_SCOPE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Parent organization</Label>
                <Select
                  value={value.parentOrgId || "none"}
                  onValueChange={(nextValue) => onChange({ ...value, parentOrgId: nextValue === "none" ? "" : nextValue })}
                  disabled={value.scopeMode !== "parent_org"}
                >
                  <SelectTrigger><SelectValue placeholder="Select parent organization" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Select parent organization</SelectItem>
                    {parentOrgOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2 md:col-span-2">
                <Label>Selected sub-grantees</Label>
                <OrganizationMultiSelect
                  organizations={organizations}
                  selectedIds={value.selectedOrgIds}
                  onChange={(nextValues) => onChange({ ...value, selectedOrgIds: nextValues })}
                  placeholder="Choose selected sub-grantees"
                  disabled={value.scopeMode !== "selected_orgs"}
                />
              </div>
            </div>
          ) : (
            <div className="mt-4 rounded-[1.2rem] border border-dashed border-border bg-white px-4 py-3 text-sm text-muted-foreground">
              This analysis will inherit the current dashboard filters for project, period, and organization scope.
            </div>
          )}
        </section>

        <section className="rounded-[1.5rem] border border-border bg-[#fbfdff] p-4 shadow-sm">
          <div className="mb-4">
            <h3 className="text-base font-semibold text-foreground">Analysis Setup</h3>
            <p className="text-sm text-muted-foreground">Choose how the values should be calculated and compared.</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="grid gap-2">
              <Label>Calculate using</Label>
              <Select value={value.calculateUsing} onValueChange={(nextValue) => onChange({ ...value, calculateUsing: nextValue as CustomAnalysisState["calculateUsing"] })}>
                <SelectTrigger><SelectValue placeholder="Select calculation" /></SelectTrigger>
                <SelectContent>
                  {CALCULATION_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Compare by</Label>
              <Select value={value.compareBy} onValueChange={(nextValue) => onChange({ ...value, compareBy: nextValue as CustomAnalysisState["compareBy"] })} disabled={value.showAs === "kpi"}>
                <SelectTrigger><SelectValue placeholder="Select comparison" /></SelectTrigger>
                <SelectContent>
                  {COMPARE_BY_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Break down by</Label>
              <Select value={value.breakDownBy} onValueChange={(nextValue) => onChange({ ...value, breakDownBy: nextValue })} disabled={value.showAs === "kpi" || value.compareBy === "indicator"}>
                <SelectTrigger><SelectValue placeholder="No breakdown" /></SelectTrigger>
                <SelectContent>
                  {breakdownOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Secondary breakdown</Label>
              <Select value={value.secondaryBreakdown} onValueChange={(nextValue) => onChange({ ...value, secondaryBreakdown: nextValue })} disabled={value.showAs === "kpi" || value.compareBy === "indicator"}>
                <SelectTrigger><SelectValue placeholder="No secondary breakdown" /></SelectTrigger>
                <SelectContent>
                  {breakdownOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2 md:col-span-2">
              <Label>Compare with</Label>
              <Select value={value.compareWith} onValueChange={(nextValue) => onChange({ ...value, compareWith: nextValue })}>
                <SelectTrigger><SelectValue placeholder="Choose comparison companion" /></SelectTrigger>
                <SelectContent>
                  {COMPARE_WITH_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </section>

        <section className="rounded-[1.5rem] border border-border bg-[#fbfdff] p-4 shadow-sm">
          <div className="mb-4">
            <h3 className="text-base font-semibold text-foreground">Advanced Display Options</h3>
            <p className="text-sm text-muted-foreground">Adjust the presentation without dropping into technical settings.</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="flex items-center justify-between rounded-[1.2rem] border border-border bg-white px-4 py-3 text-sm"><span>Show totals</span><Switch checked={value.showTotals} onCheckedChange={(checked) => onChange({ ...value, showTotals: checked })} /></label>
            <label className="flex items-center justify-between rounded-[1.2rem] border border-border bg-white px-4 py-3 text-sm"><span>Show legend</span><Switch checked={value.showLegend} onCheckedChange={(checked) => onChange({ ...value, showLegend: checked })} /></label>
            <label className="flex items-center justify-between rounded-[1.2rem] border border-border bg-white px-4 py-3 text-sm">
              <span>{usesIntrinsicTableLayout ? "Data table included" : "Include data table"}</span>
              <Switch
                checked={usesIntrinsicTableLayout || value.includeDataTable}
                onCheckedChange={(checked) => onChange({ ...value, includeDataTable: checked })}
                disabled={usesIntrinsicTableLayout}
              />
            </label>
            <label className="flex items-center justify-between rounded-[1.2rem] border border-border bg-white px-4 py-3 text-sm"><span>Show percentages</span><Switch checked={value.showPercentages} onCheckedChange={(checked) => onChange({ ...value, showPercentages: checked })} /></label>
            <label className="flex items-center justify-between rounded-[1.2rem] border border-border bg-white px-4 py-3 text-sm"><span>Target line if applicable</span><Switch checked={value.targetLine} onCheckedChange={(checked) => onChange({ ...value, targetLine: checked })} /></label>
            <label className="flex items-center justify-between rounded-[1.2rem] border border-border bg-white px-4 py-3 text-sm"><span>Apply trend line</span><Switch checked={value.trendLine} onCheckedChange={(checked) => onChange({ ...value, trendLine: checked })} disabled={!trendLineEnabled} /></label>
            <div className="grid gap-2">
              <Label>Sort order</Label>
              <Select value={value.sortOrder} onValueChange={(nextValue) => onChange({ ...value, sortOrder: nextValue as CustomAnalysisState["sortOrder"] })}>
                <SelectTrigger><SelectValue placeholder="Select sort order" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="descending">Descending</SelectItem>
                  <SelectItem value="ascending">Ascending</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Top N</Label>
              <Input type="number" min="1" value={value.topN} onChange={(event) => onChange({ ...value, topN: event.target.value })} placeholder="Leave blank for all" />
            </div>
          </div>
        </section>
    </div>
  );
}
