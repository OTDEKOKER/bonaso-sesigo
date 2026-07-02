"use client";

import { useMemo, useState } from "react";
import { Check, ChevronsUpDown, Loader2, Search, X } from "lucide-react";

import type { CoordinatorTargetQuarter } from "@/lib/api";
import type {
  CoordinatorTargetsFilterState,
  NamedOption,
} from "@/components/targets/coordinator-targets-types";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

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

  // Indicator filter is a searchable combobox — a plain dropdown of every
  // project indicator is unusable at ~200+ entries.
  const [indicatorSearchOpen, setIndicatorSearchOpen] = useState(false);
  const [indicatorSearch, setIndicatorSearch] = useState("");

  const filteredIndicators = useMemo(() => {
    const query = indicatorSearch.trim().toLowerCase();
    if (!query) return indicators;
    return indicators.filter((option) => option.label.toLowerCase().includes(query));
  }, [indicatorSearch, indicators]);

  const selectedIndicatorLabel = useMemo(() => {
    if (filters.indicatorId === "all") return "All indicators";
    return indicators.find((option) => option.value === filters.indicatorId)?.label ?? "All indicators";
  }, [filters.indicatorId, indicators]);

  const handleIndicatorSelect = (value: string) => {
    onFiltersChange({ indicatorId: value });
    setIndicatorSearch("");
    setIndicatorSearchOpen(false);
  };

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

      <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
        <Select value={filters.projectId} onValueChange={(value) => onFiltersChange({ projectId: value })}>
          <SelectTrigger className="w-full min-w-0 [&>span]:truncate">
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
          <SelectTrigger className="w-full min-w-0 [&>span]:truncate">
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

        <Popover open={indicatorSearchOpen} onOpenChange={setIndicatorSearchOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              role="combobox"
              aria-expanded={indicatorSearchOpen}
              className="w-full min-w-0 justify-between px-3 font-normal"
            >
              <span className="truncate" title={selectedIndicatorLabel}>
                {selectedIndicatorLabel}
              </span>
              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="z-[60] w-[min(90vw,24rem)] p-0">
            <Command shouldFilter={false}>
              <CommandInput
                placeholder="Search indicators..."
                value={indicatorSearch}
                onValueChange={setIndicatorSearch}
              />
              <CommandList className="max-h-[320px]">
                <CommandEmpty>No indicators found.</CommandEmpty>
                <CommandGroup>
                  <CommandItem value="__all__" onSelect={() => handleIndicatorSelect("all")}>
                    <span className="flex-1">All indicators</span>
                    <Check
                      className={cn(
                        "ml-2 h-4 w-4 shrink-0",
                        filters.indicatorId === "all" ? "opacity-100" : "opacity-0",
                      )}
                    />
                  </CommandItem>
                  {filteredIndicators.map((option) => (
                    <CommandItem
                      key={option.value}
                      value={option.value}
                      onSelect={() => handleIndicatorSelect(option.value)}
                      className="flex items-start justify-between gap-2"
                    >
                      <span className="min-w-0 flex-1 truncate" title={option.label}>
                        {option.label}
                      </span>
                      <Check
                        className={cn(
                          "mt-0.5 h-4 w-4 shrink-0",
                          filters.indicatorId === option.value ? "opacity-100" : "opacity-0",
                        )}
                      />
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

        <Select value={filters.year} onValueChange={(value) => onFiltersChange({ year: value })}>
          <SelectTrigger className="w-full min-w-0 [&>span]:truncate">
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
          <SelectTrigger className="w-full min-w-0 [&>span]:truncate">
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
          <SelectTrigger className="w-full min-w-0 [&>span]:truncate">
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
