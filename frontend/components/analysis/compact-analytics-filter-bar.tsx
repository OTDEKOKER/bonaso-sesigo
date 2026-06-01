"use client";

import { useState } from "react";
import { ChevronDown, RotateCcw, Settings2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AnalyticsFilterState } from "@/hooks/use-analytics-filters";
import type { AnalyticsScopeMode } from "@/lib/analytics/org-scope";
import type { Indicator, Organization } from "@/lib/types";

type CompactAnalyticsFilterBarProps = {
  filters: AnalyticsFilterState;
  projects: Array<{ id: string | number; name?: string }>;
  organizations: Organization[];
  indicators: Indicator[];
  periodOptions: string[];
  indicatorGroupOptions: Array<{ value: string; label: string }>;
  parentOrganizations: Organization[];
  onChangeFilters: (next: Partial<AnalyticsFilterState>) => void;
  onResetFilters: () => void;
  loading?: boolean;
  recordCount?: number;
};

const COMPARISON_MODE_OPTIONS = [
  { value: "period", label: "Period" },
  { value: "indicator", label: "Indicator" },
  { value: "organization", label: "Organization" },
  { value: "coordinator", label: "Coordinator" },
  { value: "disaggregate", label: "Disaggregate" },
  { value: "none", label: "None" },
] as const;

const SCOPE_LABELS: Record<string, string> = {
  all_orgs: "All organizations",
  parent_org: "Parent + sub-grantees",
  selected_orgs: "Selected organizations",
  self_only: "My organization only",
};

export function CompactAnalyticsFilterBar(props: CompactAnalyticsFilterBarProps) {
  const {
    filters,
    projects,
    organizations,
    indicators,
    periodOptions,
    indicatorGroupOptions,
    parentOrganizations,
    onChangeFilters,
    onResetFilters,
    loading,
    recordCount,
  } = props;

  const [showAdvanced, setShowAdvanced] = useState(false);

  const isFiltered =
    filters.projectId !== "all" ||
    filters.scopeMode !== "all_orgs" ||
    filters.selectedPeriods.length > 0 ||
    filters.indicatorGroup !== "all" ||
    filters.dateFrom ||
    filters.dateTo;

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm">
      {/* Primary filter row */}
      <div className="flex flex-wrap items-center gap-2 p-3">

        {/* Project */}
        <Select
          value={filters.projectId || "all"}
          onValueChange={(v) => onChangeFilters({ projectId: v })}
          disabled={loading}
        >
          <SelectTrigger className="h-8 w-44 text-xs">
            <SelectValue placeholder="All projects" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All projects</SelectItem>
            {projects.map((p) => (
              <SelectItem key={String(p.id)} value={String(p.id)}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Period */}
        <Select
          value={filters.reportingPeriodId || "all"}
          onValueChange={(v) =>
            onChangeFilters({
              reportingPeriodId: v === "all" ? "" : v,
              selectedPeriods: v === "all" ? [] : [v],
            })
          }
          disabled={loading || periodOptions.length === 0}
        >
          <SelectTrigger className="h-8 w-40 text-xs">
            <SelectValue placeholder="All periods" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All periods</SelectItem>
            {periodOptions.map((period) => (
              <SelectItem key={period} value={period}>
                {period}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Organization scope */}
        <Select
          value={filters.scopeMode}
          onValueChange={(v) =>
            onChangeFilters({
              scopeMode: v as AnalyticsScopeMode,
              parentOrgId: "",
              selectedOrgIds: [],
            })
          }
          disabled={loading}
        >
          <SelectTrigger className="h-8 w-52 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(SCOPE_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Parent org — only when scope = parent_org */}
        {filters.scopeMode === "parent_org" && (
          <Select
            value={filters.parentOrgId || ""}
            onValueChange={(v) => onChangeFilters({ parentOrgId: v })}
            disabled={loading}
          >
            <SelectTrigger className="h-8 w-52 text-xs">
              <SelectValue placeholder="Select parent org" />
            </SelectTrigger>
            <SelectContent>
              {parentOrganizations.map((org) => (
                <SelectItem key={String(org.id)} value={String(org.id)}>
                  {org.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* Compare by */}
        <Select
          value={filters.comparisonMode}
          onValueChange={(v) =>
            onChangeFilters({ comparisonMode: v as AnalyticsFilterState["comparisonMode"] })
          }
          disabled={loading}
        >
          <SelectTrigger className="h-8 w-40 text-xs">
            <SelectValue placeholder="Compare by" />
          </SelectTrigger>
          <SelectContent>
            {COMPARISON_MODE_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                Compare by: {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Indicator group */}
        <Select
          value={filters.indicatorGroup || "all"}
          onValueChange={(v) =>
            onChangeFilters({ indicatorGroup: v, indicatorIds: [] })
          }
          disabled={loading}
        >
          <SelectTrigger className="h-8 w-44 text-xs">
            <SelectValue placeholder="All indicators" />
          </SelectTrigger>
          <SelectContent>
            {indicatorGroupOptions.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="ml-auto flex items-center gap-1.5">
          {recordCount != null && (
            <span className="text-xs text-muted-foreground">{recordCount.toLocaleString()} records</span>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1 px-2 text-xs"
            onClick={() => setShowAdvanced((v) => !v)}
          >
            <Settings2 className="h-3.5 w-3.5" />
            More
            <ChevronDown className={`h-3 w-3 transition-transform ${showAdvanced ? "rotate-180" : ""}`} />
          </Button>
          {isFiltered && (
            <Button variant="ghost" size="sm" className="h-8 px-2 text-xs text-muted-foreground" onClick={onResetFilters}>
              <RotateCcw className="mr-1 h-3 w-3" />
              Reset
            </Button>
          )}
        </div>
      </div>

      {/* Advanced panel */}
      {showAdvanced && (
        <div className="border-t border-border px-3 pb-3 pt-3">
          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Period mode</Label>
              <Select
                value={filters.periodMode}
                onValueChange={(v) =>
                  onChangeFilters({
                    periodMode: v as AnalyticsFilterState["periodMode"],
                    reportingPeriodId: "",
                    selectedPeriods: [],
                    dateFrom: "",
                    dateTo: "",
                  })
                }
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="quarter">Quarter</SelectItem>
                  <SelectItem value="month">Month</SelectItem>
                  <SelectItem value="year">Year</SelectItem>
                  <SelectItem value="date-range">Date range</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {filters.periodMode === "date-range" && (
              <>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Date from</Label>
                  <Input
                    type="date"
                    className="h-8 text-xs"
                    value={filters.dateFrom}
                    onChange={(e) => onChangeFilters({ dateFrom: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Date to</Label>
                  <Input
                    type="date"
                    className="h-8 text-xs"
                    value={filters.dateTo}
                    onChange={(e) => onChangeFilters({ dateTo: e.target.value })}
                  />
                </div>
              </>
            )}

            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Active filters</Label>
              <div className="flex flex-wrap gap-1 pt-1">
                {filters.projectId !== "all" && (
                  <Badge variant="secondary" className="text-xs">Project scoped</Badge>
                )}
                {filters.scopeMode !== "all_orgs" && (
                  <Badge variant="secondary" className="text-xs">{SCOPE_LABELS[filters.scopeMode]}</Badge>
                )}
                {filters.indicatorGroup !== "all" && (
                  <Badge variant="secondary" className="text-xs">{filters.indicatorGroup}</Badge>
                )}
                {filters.selectedPeriods.length > 0 && (
                  <Badge variant="secondary" className="text-xs">{filters.selectedPeriods.length} period{filters.selectedPeriods.length !== 1 ? "s" : ""}</Badge>
                )}
                {!isFiltered && (
                  <span className="text-xs text-muted-foreground">No active filters</span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
