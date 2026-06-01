"use client";

import { Loader2, Search, X } from "lucide-react";

import type { CoordinatorTargetQuarter } from "@/lib/api";
import type {
  CoordinatorTargetsFilterState,
  NamedOption,
} from "@/components/targets/coordinator-targets-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type CoordinatorTargetsFilterBarProps = {
  filters: CoordinatorTargetsFilterState;
  onFiltersChange: (patch: Partial<CoordinatorTargetsFilterState>) => void;
  projects: NamedOption[];
  coordinators: NamedOption[];
  indicators: NamedOption[];
  years: number[];
  pending?: boolean;
};

const quarterOptions: Array<CoordinatorTargetQuarter | "all"> = ["all", "Q1", "Q2", "Q3", "Q4"];
const activeOptions: Array<"all" | "true" | "false"> = ["all", "true", "false"];

export function CoordinatorTargetsFilterBar(props: CoordinatorTargetsFilterBarProps) {
  const { filters, onFiltersChange, projects, coordinators, indicators, years, pending = false } = props;
  const constrainedSelectContentClassName = "w-[var(--radix-select-trigger-width)] max-w-[min(90vw,26rem)]";

  const resetFilters = () => {
    onFiltersChange({
      search: "",
      projectId: "all",
      coordinatorId: "all",
      indicatorId: "all",
      year: "all",
      quarter: "all",
      isActive: "all",
    });
  };

  return (
    <div className="space-y-3 rounded-xl border border-border/70 bg-muted/20 p-4">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={filters.search}
          onChange={(event) => onFiltersChange({ search: event.target.value })}
          placeholder="Search by coordinator, indicator, or notes..."
          className="pl-9 pr-9"
        />
        {pending ? (
          <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        ) : null}
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
        <Select value={filters.projectId} onValueChange={(value) => onFiltersChange({ projectId: value })}>
          <SelectTrigger>
            <SelectValue placeholder="Project" />
          </SelectTrigger>
          <SelectContent className={constrainedSelectContentClassName}>
            <SelectItem value="all">All projects</SelectItem>
            {projects.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                <span className="block truncate" title={option.label}>
                  {option.label}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filters.coordinatorId} onValueChange={(value) => onFiltersChange({ coordinatorId: value })}>
          <SelectTrigger>
            <SelectValue placeholder="Coordinator" />
          </SelectTrigger>
          <SelectContent className={constrainedSelectContentClassName}>
            <SelectItem value="all">All coordinators</SelectItem>
            {coordinators.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                <span className="block truncate" title={option.label}>
                  {option.label}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filters.indicatorId} onValueChange={(value) => onFiltersChange({ indicatorId: value })}>
          <SelectTrigger>
            <SelectValue placeholder="Indicator" />
          </SelectTrigger>
          <SelectContent className={constrainedSelectContentClassName}>
            <SelectItem value="all">All indicators</SelectItem>
            {indicators.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                <span className="block truncate" title={option.label}>
                  {option.label}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filters.year} onValueChange={(value) => onFiltersChange({ year: value })}>
          <SelectTrigger>
            <SelectValue placeholder="Year" />
          </SelectTrigger>
          <SelectContent className={constrainedSelectContentClassName}>
            <SelectItem value="all">All years</SelectItem>
            {years.map((year) => (
              <SelectItem key={year} value={String(year)}>
                {year}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filters.quarter}
          onValueChange={(value) => onFiltersChange({ quarter: value as CoordinatorTargetQuarter | "all" })}
        >
          <SelectTrigger>
            <SelectValue placeholder="Quarter" />
          </SelectTrigger>
          <SelectContent className={constrainedSelectContentClassName}>
            {quarterOptions.map((option) => (
              <SelectItem key={option} value={option}>
                {option === "all" ? "All quarters" : option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filters.isActive} onValueChange={(value) => onFiltersChange({ isActive: value as "all" | "true" | "false" })}>
          <SelectTrigger>
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent className={constrainedSelectContentClassName}>
            {activeOptions.map((option) => (
              <SelectItem key={option} value={option}>
                {option === "all" ? "All statuses" : option === "true" ? "Active only" : "Inactive only"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex justify-end">
        <Button type="button" variant="outline" size="sm" onClick={resetFilters}>
          <X className="mr-2 h-4 w-4" />
          Reset Filters
        </Button>
      </div>
    </div>
  );
}
