"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Loader2, Search } from "lucide-react";

import { coordinatorTargetsService, type CoordinatorTarget, type CoordinatorTargetQuarter } from "@/lib/api";
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

// One upsert per quarter. `id` present => update that existing target, else
// create a new one. The dialog edits all four quarters on a single page.
export type CoordinatorTargetSaveItem = CoordinatorTargetFormValue & { id?: number };

const QUARTERS: CoordinatorTargetQuarter[] = ["Q1", "Q2", "Q3", "Q4"];

function emptyQuarterValues(): Record<CoordinatorTargetQuarter, string> {
  return { Q1: "", Q2: "", Q3: "", Q4: "" };
}

type CoordinatorTargetFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  submitting?: boolean;
  existing?: CoordinatorTarget | null;
  projects: NamedOption[];
  coordinators: NamedOption[];
  indicators: NamedOption[];
  /** Project from the page context; pre-fills a new target so it can't be
   * created under a different project than the one the user is working in. */
  defaultProjectId?: string;
  onSubmit: (items: CoordinatorTargetSaveItem[]) => Promise<void> | void;
};

type FormState = {
  projectId: string;
  coordinatorId: string;
  indicatorId: string;
  year: string;
  quarterValues: Record<CoordinatorTargetQuarter, string>;
  notes: string;
  isActive: boolean;
};

const DEFAULT_FORM: FormState = {
  projectId: "",
  coordinatorId: "",
  indicatorId: "",
  year: String(getCurrentFiscalYear()),
  quarterValues: emptyQuarterValues(),
  notes: "",
  isActive: true,
};

function toFormState(existing?: CoordinatorTarget | null, defaultProjectId?: string): FormState {
  if (!existing) {
    return { ...DEFAULT_FORM, projectId: defaultProjectId || "", quarterValues: emptyQuarterValues() };
  }
  const quarterValues = emptyQuarterValues();
  quarterValues[existing.quarter] = String(existing.target_value ?? "");
  return {
    projectId: String(existing.project_id),
    coordinatorId: String(existing.coordinator_id),
    indicatorId: String(existing.indicator_id),
    year: String(existing.year),
    quarterValues,
    notes: existing.notes || "",
    isActive: existing.is_active !== false,
  };
}

export function CoordinatorTargetFormDialog(props: CoordinatorTargetFormDialogProps) {
  const { open, onOpenChange, submitting = false, existing, projects, coordinators, indicators, defaultProjectId, onSubmit } = props;
  const [form, setForm] = useState<FormState>(() => toFormState(existing, defaultProjectId));
  const [errorMessage, setErrorMessage] = useState("");
  const [indicatorSearchOpen, setIndicatorSearchOpen] = useState(false);
  const [indicatorSearch, setIndicatorSearch] = useState("");
  // Existing target row per quarter (id => update, absent => create) for the
  // currently-selected project + coordinator + indicator + year.
  const [quarterMeta, setQuarterMeta] = useState<Partial<Record<CoordinatorTargetQuarter, { id: number }>>>({});
  const [loadingQuarters, setLoadingQuarters] = useState(false);

  const { projectId, coordinatorId, indicatorId, year } = form;

  // Load the existing quarterly targets whenever the key fields are all set, so
  // every quarter shows its current value and saves route to update vs create.
  useEffect(() => {
    if (!open || !projectId || !coordinatorId || !indicatorId || !year) {
      setQuarterMeta({});
      return;
    }
    let cancelled = false;
    setLoadingQuarters(true);
    coordinatorTargetsService
      .list({ project_id: projectId, coordinator_id: coordinatorId, indicator_id: indicatorId, year, page_size: "10" })
      .then((response) => {
        if (cancelled) return;
        const meta: Partial<Record<CoordinatorTargetQuarter, { id: number }>> = {};
        const values = emptyQuarterValues();
        for (const target of response.results || []) {
          meta[target.quarter] = { id: target.id };
          values[target.quarter] = String(target.target_value ?? "");
        }
        setQuarterMeta(meta);
        setForm((current) => ({ ...current, quarterValues: values }));
      })
      .catch(() => {
        if (!cancelled) setQuarterMeta({});
      })
      .finally(() => {
        if (!cancelled) setLoadingQuarters(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, projectId, coordinatorId, indicatorId, year]);

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
      QUARTERS.some((quarter) => form.quarterValues[quarter].trim() !== ""),
  );

  const submit = async () => {
    setErrorMessage("");
    const parsedYear = Number(form.year);

    if (!Number.isFinite(parsedYear) || parsedYear < 2000 || parsedYear > 2100) {
      setErrorMessage("Year must be a valid fiscal year.");
      return;
    }

    const items: CoordinatorTargetSaveItem[] = [];
    for (const quarter of QUARTERS) {
      const raw = form.quarterValues[quarter].trim();
      if (raw === "") continue; // Blank quarter => leave unchanged.
      const value = Number(raw);
      if (!Number.isFinite(value)) {
        setErrorMessage(`Target for ${quarter} must be a valid number.`);
        return;
      }
      items.push({
        id: quarterMeta[quarter]?.id,
        project_id: Number(form.projectId),
        coordinator_id: Number(form.coordinatorId),
        indicator_id: Number(form.indicatorId),
        year: parsedYear,
        quarter,
        target_value: value,
        notes: form.notes.trim() || undefined,
        is_active: form.isActive,
      });
    }

    if (items.length === 0) {
      setErrorMessage("Enter a target for at least one quarter.");
      return;
    }

    await onSubmit(items);
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
          <DialogTitle>{existing ? "Edit Coordinator Targets" : "New Coordinator Targets"}</DialogTitle>
          <DialogDescription>
            Set targets for all four quarters of a coordinator + indicator + fiscal year on one page.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-1">
          <div className="grid gap-2 md:grid-cols-2">
            <div className="grid gap-2 min-w-0">
              <Label>Project</Label>
              <Select value={form.projectId} onValueChange={(value) => setForm((current) => ({ ...current, projectId: value }))}>
                <SelectTrigger className="w-full min-w-0 [&>span]:truncate">
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

            <div className="grid gap-2 min-w-0">
              <Label>Coordinator</Label>
              <Select
                value={form.coordinatorId}
                onValueChange={(value) => setForm((current) => ({ ...current, coordinatorId: value }))}
              >
                <SelectTrigger className="w-full min-w-0 [&>span]:truncate">
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

          <div className="grid gap-3">
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
          </div>

          <div className="grid gap-2 sm:max-w-[220px]">
            <Label>Fiscal Year</Label>
            <Input
              type="number"
              value={form.year}
              onChange={(event) => setForm((current) => ({ ...current, year: event.target.value }))}
            />
          </div>

          <div className="grid gap-2">
            <div className="flex items-center gap-2">
              <Label>Quarterly Targets</Label>
              {loadingQuarters ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" /> : null}
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {QUARTERS.map((quarter) => (
                <div key={quarter} className="grid gap-1.5">
                  <Label className="text-xs font-normal text-muted-foreground">{quarter}</Label>
                  <Input
                    type="number"
                    inputMode="decimal"
                    value={form.quarterValues[quarter]}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        quarterValues: { ...current.quarterValues, [quarter]: event.target.value },
                      }))
                    }
                    placeholder="0"
                  />
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Leave a quarter blank to leave it unchanged. Filled quarters are created or updated on save.
            </p>
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
