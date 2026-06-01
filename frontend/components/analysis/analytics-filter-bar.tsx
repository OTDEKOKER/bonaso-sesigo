"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ChevronDown, RotateCcw, Save } from "lucide-react";

import { OrganizationMultiSelect } from "@/components/shared/organization-multi-select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { AnalyticsFilterState } from "@/hooks/use-analytics-filters";
import type { AnalyticsScopeMode } from "@/lib/analytics/org-scope";
import type { Indicator, Organization } from "@/lib/types";

type Option = {
  value: string;
  label: string;
};

type MultiSelectProps = {
  options: Option[];
  selectedValues: string[];
  onChange: (nextValues: string[]) => void;
  placeholder: string;
  disabled?: boolean;
  maxSelections?: number;
};

type AnalyticsFilterBarProps = {
  filters: AnalyticsFilterState;
  projects: Array<{ id: string | number; name?: string }>;
  organizations: Organization[];
  indicators: Indicator[];
  periodOptions: string[];
  disaggregationOptions: Array<{ key: string; label: string }>;
  indicatorGroupOptions: Option[];
  parentOrganizations: Organization[];
  scopedOrganizations: Organization[];
  onChangeFilters: (next: Partial<AnalyticsFilterState>) => void;
  onResetFilters: () => void;
  onSaveFilters: () => void;
  loading?: boolean;
};

const PERIOD_MODE_OPTIONS: Array<{ value: AnalyticsFilterState["periodMode"]; label: string }> = [
  { value: "date-range", label: "Date Range" },
  { value: "month", label: "Month" },
  { value: "quarter", label: "Quarter" },
  { value: "year", label: "Year" },
];

const SCOPE_MODE_OPTIONS: Array<{ value: AnalyticsScopeMode; label: string }> = [
  { value: "all_orgs", label: "All organizations" },
  { value: "parent_org", label: "Parent + descendants" },
  { value: "selected_orgs", label: "Selected organizations" },
  { value: "self_only", label: "Self only" },
];

const COMPARISON_MODE_OPTIONS: Array<{ value: AnalyticsFilterState["comparisonMode"]; label: string }> = [
  { value: "indicator", label: "Indicator comparison" },
  { value: "disaggregate", label: "Disaggregate comparison" },
  { value: "period", label: "Period comparison" },
  { value: "coordinator", label: "Coordinator comparison" },
  { value: "organization", label: "Organization comparison" },
  { value: "none", label: "No comparison" },
];

function MultiSelect(props: MultiSelectProps) {
  const { options, selectedValues, onChange, placeholder, disabled = false, maxSelections } = props;
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const selectedSet = useMemo(() => new Set(selectedValues), [selectedValues]);
  const filteredOptions = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    if (!normalizedSearch) return options;
    return options.filter((option) => option.label.toLowerCase().includes(normalizedSearch));
  }, [options, search]);

  const summary = useMemo(() => {
    if (selectedValues.length === 0) return placeholder;
    if (selectedValues.length === 1) {
      return options.find((option) => option.value === selectedValues[0])?.label || placeholder;
    }
    return `${selectedValues.length} selected`;
  }, [options, placeholder, selectedValues]);

  const toggleValue = (value: string) => {
    if (selectedSet.has(value)) {
      onChange(selectedValues.filter((entry) => entry !== value));
      return;
    }
    if (maxSelections && selectedValues.length >= maxSelections) return;
    onChange([...selectedValues, value]);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className="flex h-11 w-full items-center justify-between rounded-xl border border-border/60 bg-background px-3.5 text-sm text-foreground shadow-sm transition-colors hover:bg-muted/30 disabled:pointer-events-none disabled:opacity-50"
        >
          <span className="truncate text-left">{summary}</span>
          <span className="ml-3 flex items-center gap-2">
            <span className="rounded-full border border-border/60 bg-muted/30 px-2 py-0.5 text-xs font-medium text-muted-foreground">
              {selectedValues.length}
            </span>
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="z-[70] w-[var(--radix-popover-trigger-width)] rounded-2xl border-border/60 p-0 shadow-lg">
        <Command>
          <CommandInput placeholder="Search..." value={search} onValueChange={setSearch} />
          <CommandList>
            <CommandEmpty>No options found.</CommandEmpty>
            <CommandGroup>
              {filteredOptions.map((option) => (
                <CommandItem
                  key={option.value}
                  value={`${option.label}-${option.value}`}
                  onSelect={() => toggleValue(option.value)}
                >
                  <Checkbox checked={selectedSet.has(option.value)} className="mr-2 pointer-events-none" />
                  <span className="truncate">{option.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function FilterSection(props: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-3 rounded-2xl border border-border/60 bg-muted/10 p-4">
      <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">{props.title}</div>
      {props.children}
    </div>
  );
}

export function AnalyticsFilterBar(props: AnalyticsFilterBarProps) {
  const {
    filters,
    projects,
    organizations,
    indicators,
    periodOptions,
    disaggregationOptions,
    indicatorGroupOptions,
    parentOrganizations,
    scopedOrganizations,
    onChangeFilters,
    onResetFilters,
    onSaveFilters,
    loading = false,
  } = props;

  const projectOptions = useMemo<Option[]>(
    () =>
      projects.map((project) => ({
        value: String(project.id),
        label: project.name || `Project ${project.id}`,
      })),
    [projects],
  );

  const indicatorOptions = useMemo<Option[]>(
    () =>
      indicators.map((indicator) => ({
        value: String(indicator.id),
        label: indicator.name,
      })),
    [indicators],
  );

  const disaggregationSelectOptions = useMemo<Option[]>(
    () =>
      disaggregationOptions.map((dimension) => ({
        value: dimension.key,
        label: dimension.label,
      })),
    [disaggregationOptions],
  );

  const periodSelectOptions = useMemo<Option[]>(
    () =>
      periodOptions.map((period) => ({
        value: period,
        label: period,
      })),
    [periodOptions],
  );

  const applySelectedPeriods = (nextPeriods: string[]) => {
    onChangeFilters({
      selectedPeriods: nextPeriods,
      reportingPeriodId: nextPeriods.length === 1 ? nextPeriods[0] : "",
    });
  };

  const indicatorGroupValue = filters.indicatorGroup || "all";
  const filteredIndicatorOptions = useMemo(() => {
    if (indicatorGroupValue === "all") return indicatorOptions;
    const searchLabel = indicatorGroupValue.toLowerCase();
    return indicatorOptions.filter((option) => option.label.toLowerCase().includes(searchLabel));
  }, [indicatorGroupValue, indicatorOptions]);

  return (
    <section className="sticky top-0 z-40 rounded-2xl border border-border/60 bg-card/95 p-4 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-card/90">
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="text-base font-semibold tracking-[-0.02em] text-foreground">Analytics filters</div>
            <p className="text-sm text-muted-foreground">
              Refine project scope, reporting periods, organization coverage, and indicator focus.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{periodSelectOptions.length} periods</Badge>
            <Badge variant="outline">{filteredIndicatorOptions.length} indicators</Badge>
            <Badge variant="outline">{filters.selectedOrgIds.length || organizations.length} orgs</Badge>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <FilterSection title="Reporting scope">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="grid gap-1.5">
                <Label className="text-xs font-medium text-muted-foreground">Project</Label>
                <Select
                  value={filters.projectId || "all"}
                  onValueChange={(value) => onChangeFilters({ projectId: value })}
                  disabled={loading}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="All projects" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All projects</SelectItem>
                    {projectOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-1.5">
                <Label className="text-xs font-medium text-muted-foreground">Period mode</Label>
                <Select
                  value={filters.periodMode}
                  onValueChange={(value) =>
                    onChangeFilters({
                      periodMode: value as AnalyticsFilterState["periodMode"],
                      reportingPeriodId: "",
                      selectedPeriods: [],
                    })
                  }
                  disabled={loading}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Period mode" />
                  </SelectTrigger>
                  <SelectContent>
                    {PERIOD_MODE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-1.5">
                <Label className="text-xs font-medium text-muted-foreground">Primary reporting period</Label>
                <Select
                  value={filters.reportingPeriodId || "all"}
                  onValueChange={(value) =>
                    onChangeFilters({
                      reportingPeriodId: value === "all" ? "" : value,
                      selectedPeriods: value === "all" ? [] : [value],
                    })
                  }
                  disabled={loading || filters.periodMode === "date-range" || periodSelectOptions.length === 0}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="All periods with data" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All periods with data</SelectItem>
                    {periodSelectOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-1.5">
                <Label className="text-xs font-medium text-muted-foreground">Compare periods</Label>
                <MultiSelect
                  options={periodSelectOptions}
                  selectedValues={filters.selectedPeriods}
                  onChange={applySelectedPeriods}
                  placeholder="Select periods"
                  disabled={loading || filters.periodMode === "date-range" || periodSelectOptions.length === 0}
                />
              </div>

              <div className="grid gap-1.5">
                <Label className="text-xs font-medium text-muted-foreground">Date from</Label>
                <Input
                  type="date"
                  value={filters.dateFrom}
                  onChange={(event) => onChangeFilters({ dateFrom: event.target.value })}
                  disabled={loading || filters.periodMode !== "date-range"}
                />
              </div>

              <div className="grid gap-1.5">
                <Label className="text-xs font-medium text-muted-foreground">Date to</Label>
                <Input
                  type="date"
                  value={filters.dateTo}
                  onChange={(event) => onChangeFilters({ dateTo: event.target.value })}
                  disabled={loading || filters.periodMode !== "date-range"}
                />
              </div>

              <div className="grid gap-1.5">
                <Label className="text-xs font-medium text-muted-foreground">Organization scope</Label>
                <Select
                  value={filters.scopeMode}
                  onValueChange={(value) =>
                    onChangeFilters({
                      scopeMode: value as AnalyticsScopeMode,
                      selectedOrgIds: value === "selected_orgs" ? filters.selectedOrgIds : [],
                    })
                  }
                  disabled={loading}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Scope" />
                  </SelectTrigger>
                  <SelectContent>
                    {SCOPE_MODE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-1.5">
                <Label className="text-xs font-medium text-muted-foreground">Parent organization</Label>
                <Select
                  value={filters.parentOrgId || "none"}
                  onValueChange={(value) => onChangeFilters({ parentOrgId: value === "none" ? "" : value })}
                  disabled={loading || filters.scopeMode !== "parent_org"}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Choose parent organization" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Default allowed parent</SelectItem>
                    {parentOrganizations.map((organization) => (
                      <SelectItem key={organization.id} value={String(organization.id)}>
                        {organization.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </FilterSection>

          <FilterSection title="Indicator focus">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="grid gap-1.5 md:col-span-2">
                <Label className="text-xs font-medium text-muted-foreground">Selected sub-grantees</Label>
                <OrganizationMultiSelect
                  organizations={scopedOrganizations}
                  selectedIds={filters.selectedOrgIds}
                  onChange={(nextValues) => onChangeFilters({ selectedOrgIds: nextValues })}
                  placeholder="Select organizations"
                  disabled={loading || filters.scopeMode !== "selected_orgs"}
                />
              </div>

              <div className="grid gap-1.5">
                <Label className="text-xs font-medium text-muted-foreground">Indicator group</Label>
                <Select
                  value={indicatorGroupValue}
                  onValueChange={(value) => onChangeFilters({ indicatorGroup: value, indicatorIds: [] })}
                  disabled={loading}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="All groups" />
                  </SelectTrigger>
                  <SelectContent>
                    {indicatorGroupOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-1.5">
                <Label className="text-xs font-medium text-muted-foreground">Comparison mode</Label>
                <Select
                  value={filters.comparisonMode}
                  onValueChange={(value) =>
                    onChangeFilters({ comparisonMode: value as AnalyticsFilterState["comparisonMode"] })
                  }
                  disabled={loading}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Comparison mode" />
                  </SelectTrigger>
                  <SelectContent>
                    {COMPARISON_MODE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-1.5">
                <Label className="text-xs font-medium text-muted-foreground">Indicators</Label>
                <MultiSelect
                  options={filteredIndicatorOptions}
                  selectedValues={filters.indicatorIds}
                  onChange={(nextValues) => onChangeFilters({ indicatorIds: nextValues })}
                  placeholder="All indicators"
                  disabled={loading}
                />
              </div>

              <div className="grid gap-1.5">
                <Label className="text-xs font-medium text-muted-foreground">Disaggregates</Label>
                <MultiSelect
                  options={disaggregationSelectOptions}
                  selectedValues={filters.disaggregationKeys}
                  onChange={(nextValues) => onChangeFilters({ disaggregationKeys: nextValues })}
                  placeholder="Auto from indicator"
                  disabled={loading || disaggregationSelectOptions.length === 0}
                />
              </div>

              <div className="flex items-end">
                <div className="flex h-11 w-full items-center justify-between rounded-xl border border-border/60 bg-background px-3.5 shadow-sm">
                  <div className="text-xs font-medium text-muted-foreground">Include descendants</div>
                  <Switch
                    checked={filters.cascadeOrganization}
                    onCheckedChange={(value) => onChangeFilters({ cascadeOrganization: value })}
                    disabled={loading}
                  />
                </div>
              </div>

              <div className="grid gap-1.5">
                <Label className="text-xs font-medium text-muted-foreground">Parent org options</Label>
                <div className="flex h-11 items-center rounded-xl border border-border/60 bg-background px-3.5 text-sm text-muted-foreground shadow-sm">
                  {parentOrganizations.length} available
                </div>
              </div>

              <div className="grid gap-1.5">
                <Label className="text-xs font-medium text-muted-foreground">Org count in filter</Label>
                <div className="flex h-11 items-center rounded-xl border border-border/60 bg-background px-3.5 text-sm text-muted-foreground shadow-sm">
                  {filters.selectedOrgIds.length > 0 ? `${filters.selectedOrgIds.length} selected` : `${organizations.length} total`}
                </div>
              </div>
            </div>
          </FilterSection>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border/50 pt-4">
          <Button type="button" variant="outline" onClick={onResetFilters} disabled={loading}>
            <RotateCcw className="mr-2 h-4 w-4" />
            Reset filters
          </Button>
          <Button type="button" onClick={onSaveFilters} disabled={loading}>
            <Save className="mr-2 h-4 w-4" />
            Save filters to dashboard
          </Button>
        </div>
      </div>
    </section>
  );
}
