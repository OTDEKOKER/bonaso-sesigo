"use client";

import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";

import {
  CustomAnalysisBuilder,
  MultiSelectField,
  PERIOD_MODE_OPTIONS,
  ORG_SCOPE_OPTIONS,
  buildGeneratedPeriodOptions,
  getCustomAnalysisIndicatorIds,
  type CustomAnalysisState,
} from "@/components/analysis/custom-analysis-builder";
import {
  SIMPLE_CHART_TYPES,
  applySimpleSelection,
  deriveSimpleSelection,
  type SimpleChartType,
  type SimpleSelection,
} from "@/lib/analytics/chart-templates";
import { OrganizationMultiSelect } from "@/components/shared/organization-multi-select";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { AnalyticsScopeMode } from "@/lib/analytics/org-scope";
import type { ChartFieldName } from "@/lib/api";
import type { Indicator, Organization } from "@/lib/types";

type BreakdownFieldOption = { value: ChartFieldName | "none"; label: string };

type SimpleChartBuilderProps = {
  value: CustomAnalysisState;
  onChange: (next: CustomAnalysisState) => void;
  indicators: Indicator[];
  projects: Array<{ id: string | number; name?: string }>;
  organizations: Organization[];
  breakdownFields: BreakdownFieldOption[];
  parentOrganizations: Organization[];
};

const NONE = "none";

export function SimpleChartBuilder(props: SimpleChartBuilderProps) {
  const { value, onChange, indicators, projects, organizations, breakdownFields, parentOrganizations } = props;
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const selection = useMemo(() => deriveSimpleSelection(value), [value]);
  const selectedIndicatorIds = getCustomAnalysisIndicatorIds(value);

  const updateSelection = (partial: Partial<SimpleSelection>) => {
    onChange(applySimpleSelection(value, { ...selection, ...partial }));
  };

  const indicatorOptions = useMemo(
    () => indicators.map((indicator) => ({ value: String(indicator.id), label: indicator.name })),
    [indicators],
  );

  const dimensionOptions = useMemo(() => {
    const options: Array<{ value: string; label: string }> = [
      { value: "period", label: "Reporting period" },
      { value: "organization", label: "Organisation" },
      { value: "coordinator", label: "Coordinator" },
    ];
    if (selectedIndicatorIds.length > 1) options.push({ value: "indicator", label: "Indicator" });
    for (const field of breakdownFields) {
      if (field.value !== "none") options.push({ value: field.value, label: field.label });
    }
    return options;
  }, [breakdownFields, selectedIndicatorIds.length]);

  const periodOptions = useMemo(() => buildGeneratedPeriodOptions(value.periodMode), [value.periodMode]);
  const projectOptions = projects.map((project) => ({ value: String(project.id), label: project.name || `Project ${project.id}` }));
  const parentOrgOptions = parentOrganizations.map((organization) => ({ value: String(organization.id), label: organization.name }));

  const isKpi = selection.chartType === "kpi";

  return (
    <div className="min-w-0 space-y-4">
      {/* Data */}
      <section className="rounded-[1.5rem] border border-border bg-[#fbfdff] p-4 shadow-sm">
        <h3 className="mb-3 text-base font-semibold text-foreground">Data</h3>
        <div className="space-y-4">
          <div className="grid gap-2">
            <Label>Indicators</Label>
            <MultiSelectField
              options={indicatorOptions}
              values={selectedIndicatorIds}
              onChange={(nextValues) => onChange({ ...value, indicatorId: nextValues[0] ?? "", indicatorIds: nextValues })}
              placeholder="Select indicators"
            />
          </div>
          <div className="grid gap-2">
            <Label>Chart type</Label>
            <div className="grid grid-cols-3 gap-2">
              {SIMPLE_CHART_TYPES.map((option) => {
                const Icon = option.icon;
                const active = selection.chartType === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => updateSelection({ chartType: option.value as SimpleChartType })}
                    aria-pressed={active}
                    className={cn(
                      "flex flex-col items-center gap-1 rounded-lg border px-2 py-3 text-xs font-medium transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      active
                        ? "border-primary bg-primary/5 text-primary"
                        : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground",
                    )}
                  >
                    <Icon className="h-5 w-5" />
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* How to split */}
      <section className="rounded-[1.5rem] border border-border bg-[#fbfdff] p-4 shadow-sm">
        <h3 className="mb-1 text-base font-semibold text-foreground">How to break it down</h3>
        <p className="mb-3 text-sm text-muted-foreground">Choose the bars/points, then an optional second series.</p>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label>Group by</Label>
            <Select
              value={selection.groupBy || NONE}
              onValueChange={(nextValue) => updateSelection({ groupBy: nextValue === NONE ? "" : nextValue })}
              disabled={isKpi}
            >
              <SelectTrigger><SelectValue placeholder="Single total" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Single total</SelectItem>
                {dimensionOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label>Split each by (optional)</Label>
            <Select
              value={selection.splitBy || NONE}
              onValueChange={(nextValue) => updateSelection({ splitBy: nextValue === NONE ? "" : nextValue })}
              disabled={isKpi}
            >
              <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>None</SelectItem>
                {dimensionOptions
                  .filter((option) => option.value !== selection.groupBy)
                  .map((option) => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <label className="flex items-center justify-between rounded-[1.2rem] border border-border bg-white px-4 py-3 text-sm">
            <span>
              Compare with target
              <span className="block text-xs text-muted-foreground">Overlays the indicator target where one is set.</span>
            </span>
            <Switch checked={selection.withTarget} onCheckedChange={(checked) => updateSelection({ withTarget: checked })} />
          </label>
        </div>
      </section>

      {/* Scope & period */}
      <section className="rounded-[1.5rem] border border-border bg-[#fbfdff] p-4 shadow-sm">
        <h3 className="mb-3 text-base font-semibold text-foreground">Scope &amp; period</h3>
        <div className="grid gap-4 md:grid-cols-2">
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
              <SelectTrigger><SelectValue placeholder="Select period" /></SelectTrigger>
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
                placeholder="All available periods"
              />
            </div>
          )}
          <div className="grid gap-2">
            <Label>Organisation scope</Label>
            <Select value={value.scopeMode} onValueChange={(nextValue) => onChange({ ...value, scopeMode: nextValue as AnalyticsScopeMode })}>
              <SelectTrigger><SelectValue placeholder="Select scope" /></SelectTrigger>
              <SelectContent>
                {ORG_SCOPE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {value.scopeMode === "parent_org" ? (
            <div className="grid gap-2">
              <Label>Parent organisation</Label>
              <Select
                value={value.parentOrgId || NONE}
                onValueChange={(nextValue) => onChange({ ...value, parentOrgId: nextValue === NONE ? "" : nextValue })}
              >
                <SelectTrigger><SelectValue placeholder="Select parent organisation" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Select parent organisation</SelectItem>
                  {parentOrgOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          {value.scopeMode === "selected_orgs" ? (
            <div className="grid gap-2 md:col-span-2">
              <Label>Selected sub-grantees</Label>
              <OrganizationMultiSelect
                organizations={organizations}
                selectedIds={value.selectedOrgIds}
                onChange={(nextValues) => onChange({ ...value, selectedOrgIds: nextValues })}
                placeholder="Choose selected sub-grantees"
              />
            </div>
          ) : null}
        </div>
      </section>

      {/* Advanced escape hatch — the full original builder, nothing removed. */}
      <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen} className="space-y-4">
        <CollapsibleTrigger asChild>
          <Button variant="outline" className="w-full justify-between">
            <span>Advanced options</span>
            <ChevronDown className={cn("h-4 w-4 transition-transform", advancedOpen && "rotate-180")} />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CustomAnalysisBuilder
            value={value}
            onChange={onChange}
            dashboard={null}
            indicators={indicators}
            projects={projects}
            organizations={organizations}
            breakdownFields={breakdownFields}
            parentOrganizations={parentOrganizations}
            standalone
          />
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
