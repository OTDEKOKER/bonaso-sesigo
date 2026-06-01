"use client";

import { useMemo, useState } from "react";
import { Check, Loader2, Search } from "lucide-react";

import type { CoordinatorTarget, CoordinatorTargetQuarter } from "@/lib/api";
import { getCurrentFiscalYear } from "@/components/targets/coordinator-targets-utils";
import type { NamedOption } from "@/components/targets/coordinator-targets-types";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export type CoordinatorTargetFormValue = {
  project_id: number;
  coordinator_id: number;
  indicator_id: number;
  year: number;
  quarter: CoordinatorTargetQuarter;
  target_value: number;
  notes?: string;
  is_active: boolean;
};

type CoordinatorTargetFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  submitting?: boolean;
  existing?: CoordinatorTarget | null;
  projects: NamedOption[];
  coordinators: NamedOption[];
  indicators: NamedOption[];
  onSubmit: (value: CoordinatorTargetFormValue) => Promise<void> | void;
};

type FormState = {
  projectId: string;
  coordinatorId: string;
  indicatorId: string;
  year: string;
  quarter: CoordinatorTargetQuarter;
  targetValue: string;
  notes: string;
  isActive: boolean;
};

const DEFAULT_FORM: FormState = {
  projectId: "",
  coordinatorId: "",
  indicatorId: "",
  year: String(getCurrentFiscalYear()),
  quarter: "Q1",
  targetValue: "",
  notes: "",
  isActive: true,
};

function toFormState(existing?: CoordinatorTarget | null): FormState {
  if (!existing) return DEFAULT_FORM;
  return {
    projectId: String(existing.project_id),
    coordinatorId: String(existing.coordinator_id),
    indicatorId: String(existing.indicator_id),
    year: String(existing.year),
    quarter: existing.quarter,
    targetValue: String(existing.target_value ?? ""),
    notes: existing.notes || "",
    isActive: existing.is_active !== false,
  };
}

export function CoordinatorTargetFormDialog(props: CoordinatorTargetFormDialogProps) {
  const { open, onOpenChange, submitting = false, existing, projects, coordinators, indicators, onSubmit } = props;
  const [form, setForm] = useState<FormState>(() => toFormState(existing));
  const [errorMessage, setErrorMessage] = useState("");
  const [indicatorSearchOpen, setIndicatorSearchOpen] = useState(false);
  const [indicatorSearch, setIndicatorSearch] = useState("");

  const filteredIndicators = useMemo(() => {
    const query = indicatorSearch.trim().toLowerCase();
    if (!query) return indicators;

    return indicators.filter((indicator) =>
      `${indicator.label} ${indicator.hint || ""} ${indicator.searchText || ""}`.toLowerCase().includes(query),
    );
  }, [indicatorSearch, indicators]);

  const selectedIndicator = useMemo(
    () => indicators.find((indicator) => indicator.value === form.indicatorId) || null,
    [form.indicatorId, indicators],
  );

  const canSubmit = Boolean(
    form.projectId &&
      form.coordinatorId &&
      form.indicatorId &&
      form.year &&
      form.quarter &&
      form.targetValue.trim(),
  );

  const submit = async () => {
    setErrorMessage("");
    const parsedTargetValue = Number(form.targetValue);
    const parsedYear = Number(form.year);

    if (!Number.isFinite(parsedTargetValue)) {
      setErrorMessage("Target value must be a valid number.");
      return;
    }
    if (!Number.isFinite(parsedYear) || parsedYear < 2000 || parsedYear > 2100) {
      setErrorMessage("Year must be a valid fiscal year.");
      return;
    }

    await onSubmit({
      project_id: Number(form.projectId),
      coordinator_id: Number(form.coordinatorId),
      indicator_id: Number(form.indicatorId),
      year: parsedYear,
      quarter: form.quarter,
      target_value: parsedTargetValue,
      notes: form.notes.trim() || undefined,
      is_active: form.isActive,
    });
  };

  const handleIndicatorSelect = (value: string) => {
    setForm((current) => ({ ...current, indicatorId: value }));
    setIndicatorSearch("");
    setIndicatorSearchOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !submitting && onOpenChange(nextOpen)}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{existing ? "Edit Coordinator Target" : "New Coordinator Target"}</DialogTitle>
          <DialogDescription>
            Targets are unique per project, coordinator, indicator, fiscal year, and quarter.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-1">
          <div className="grid gap-2 md:grid-cols-2">
            <div className="grid gap-2">
              <Label>Project</Label>
              <Select value={form.projectId} onValueChange={(value) => setForm((current) => ({ ...current, projectId: value }))}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select project" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((project) => (
                    <SelectItem key={project.value} value={project.value}>
                      {project.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label>Coordinator</Label>
              <Select
                value={form.coordinatorId}
                onValueChange={(value) => setForm((current) => ({ ...current, coordinatorId: value }))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select coordinator" />
                </SelectTrigger>
                <SelectContent>
                  {coordinators.map((coordinator) => (
                    <SelectItem key={coordinator.value} value={coordinator.value}>
                      {coordinator.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_200px] md:items-start">
            <div className="grid gap-2 min-w-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label>Indicator</Label>
                <Popover open={indicatorSearchOpen} onOpenChange={setIndicatorSearchOpen}>
                  <PopoverTrigger asChild>
                    <Button type="button" variant="outline" size="sm" className="shrink-0" disabled={indicators.length === 0}>
                      <Search className="h-4 w-4" />
                      Search Indicator
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="z-[60] w-[calc(100vw-3rem)] p-0 sm:w-[540px]">
                    <Command shouldFilter={false}>
                      <CommandInput
                        placeholder="Search indicators..."
                        value={indicatorSearch}
                        onValueChange={setIndicatorSearch}
                      />
                      <CommandList className="max-h-[320px]">
                        <CommandEmpty>No indicators found.</CommandEmpty>
                        <CommandGroup heading="Indicators">
                          {filteredIndicators.map((indicator) => (
                            <CommandItem
                              key={indicator.value}
                              value={indicator.searchText || indicator.label}
                              onSelect={() => handleIndicatorSelect(indicator.value)}
                              className="flex items-start justify-between gap-3"
                            >
                              <div className="min-w-0">
                                <div className="truncate">{indicator.label}</div>
                                {indicator.hint ? (
                                  <div className="truncate text-xs text-muted-foreground">{indicator.hint}</div>
                                ) : null}
                              </div>
                              <Check
                                className={cn(
                                  "mt-0.5 h-4 w-4 shrink-0",
                                  indicator.value === form.indicatorId ? "opacity-100" : "opacity-0",
                                )}
                              />
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>
              <div className="grid gap-2">
                <Select
                  value={form.indicatorId}
                  onValueChange={(value) => setForm((current) => ({ ...current, indicatorId: value }))}
                >
                  <SelectTrigger className="w-full min-w-0 [&>span]:truncate">
                    <SelectValue placeholder="Select indicator" className="truncate" />
                  </SelectTrigger>
                  <SelectContent>
                    {indicators.map((indicator) => (
                      <SelectItem key={indicator.value} value={indicator.value}>
                        {indicator.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedIndicator?.hint ? (
                  <p className="text-xs text-muted-foreground">{selectedIndicator.hint}</p>
                ) : null}
              </div>
            </div>

            <div className="grid gap-2 min-w-0">
              <Label>Target Value</Label>
              <Input
                className="w-full"
                type="number"
                inputMode="decimal"
                value={form.targetValue}
                onChange={(event) => setForm((current) => ({ ...current, targetValue: event.target.value }))}
                placeholder="0"
              />
            </div>
          </div>

          <div className="grid gap-2 md:grid-cols-2">
            <div className="grid gap-2">
              <Label>Fiscal Year</Label>
              <Input
                type="number"
                value={form.year}
                onChange={(event) => setForm((current) => ({ ...current, year: event.target.value }))}
              />
            </div>

            <div className="grid gap-2">
              <Label>Quarter</Label>
              <Select
                value={form.quarter}
                onValueChange={(value) => setForm((current) => ({ ...current, quarter: value as CoordinatorTargetQuarter }))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select quarter" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Q1">Q1</SelectItem>
                  <SelectItem value="Q2">Q2</SelectItem>
                  <SelectItem value="Q3">Q3</SelectItem>
                  <SelectItem value="Q4">Q4</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-2">
            <Label>Notes</Label>
            <Textarea
              value={form.notes}
              onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
              placeholder="Optional implementation notes"
            />
          </div>

          <label className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
            <span className="text-sm">Active target</span>
            <Switch
              checked={form.isActive}
              onCheckedChange={(checked) => setForm((current) => ({ ...current, isActive: checked === true }))}
            />
          </label>

          {errorMessage ? <p className="text-sm text-destructive">{errorMessage}</p> : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void submit()} disabled={submitting || !canSubmit}>
            {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {existing ? "Save Changes" : "Create Target"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
