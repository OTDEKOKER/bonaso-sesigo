"use client";

import { useMemo, useState } from "react";
import { Check, Loader2, Plus } from "lucide-react";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OrganizationSelect } from "@/components/shared/organization-select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  computeEntryMatrixTotal,
  type AggregateEntryMatrixConfig,
  type MatrixInputValues,
} from "@/lib/aggregates/aggregate-helpers";
import { cn } from "@/lib/utils";

type OptionItem = {
  id: string | number;
  name: string;
  code?: string;
};

type IndicatorDraft = {
  total: string;
  matrixValues: MatrixInputValues;
};

type PeriodType = "custom" | "monthly" | "quarterly" | "yearly";

type AggregateEntryDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: () => void;
  isSubmitting: boolean;
  projects: OptionItem[];
  availableOrganizations: OptionItem[];
  availableIndicators: OptionItem[];
  isOrganizationSelectionLocked: boolean;
  formProject: string;
  setFormProject: (value: string) => void;
  formOrganization: string;
  setFormOrganization: (value: string) => void;
  selectedIndicatorIds: string[];
  onToggleIndicator: (value: string) => void;
  indicatorDrafts: Record<string, IndicatorDraft>;
  indicatorConfigs: Record<string, AggregateEntryMatrixConfig>;
  onTotalChange: (indicatorId: string, value: string) => void;
  onMatrixCellChange: (
    indicatorId: string,
    primaryValue: string,
    secondaryValue: string,
    bandValue: string,
    value: string,
  ) => void;
  formPeriodStart: string;
  setFormPeriodStart: (value: string) => void;
  formPeriodEnd: string;
  setFormPeriodEnd: (value: string) => void;
  formDataSource: string;
  setFormDataSource: (value: string) => void;
  formNotes: string;
  setFormNotes: (value: string) => void;
};

export function AggregateEntryDialog(props: AggregateEntryDialogProps) {
  const {
    open,
    onOpenChange,
    onSave,
    isSubmitting,
    projects,
    availableOrganizations,
    availableIndicators,
    isOrganizationSelectionLocked,
    formProject,
    setFormProject,
    formOrganization,
    setFormOrganization,
    selectedIndicatorIds,
    onToggleIndicator,
    indicatorDrafts,
    indicatorConfigs,
    onTotalChange,
    onMatrixCellChange,
    formPeriodStart,
    setFormPeriodStart,
    formPeriodEnd,
    setFormPeriodEnd,
    formDataSource,
    setFormDataSource,
    formNotes,
    setFormNotes,
  } = props;

  const [indicatorSearch, setIndicatorSearch] = useState("");
  const [periodType, setPeriodType] = useState<PeriodType>("custom");
  const [periodMonth, setPeriodMonth] = useState("");
  const [periodQuarter, setPeriodQuarter] = useState("Q1");
  const [periodYear, setPeriodYear] = useState(String(new Date().getFullYear()));

  const resetLocalPeriodState = () => {
    setPeriodType("custom");
    setPeriodMonth("");
    setPeriodQuarter("Q1");
    setPeriodYear(String(new Date().getFullYear()));
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      resetLocalPeriodState();
    }
    onOpenChange(nextOpen);
  };

  const applyMonthlyPeriod = (value: string) => {
    setPeriodMonth(value);
    if (!value) {
      setFormPeriodStart("");
      setFormPeriodEnd("");
      return;
    }

    const [yearValue, monthValue] = value.split("-");
    const year = Number(yearValue);
    const month = Number(monthValue);
    if (!year || !month) return;

    const lastDay = new Date(year, month, 0).getDate();
    setFormPeriodStart(`${value}-01`);
    setFormPeriodEnd(`${value}-${String(lastDay).padStart(2, "0")}`);
  };

  const applyQuarterlyPeriod = (yearValue: string, quarterValue: string) => {
    setPeriodYear(yearValue);
    setPeriodQuarter(quarterValue);

    const year = Number(yearValue);
    const quarterMonthMap: Record<string, [string, string]> = {
      Q1: ["01", "03"],
      Q2: ["04", "06"],
      Q3: ["07", "09"],
      Q4: ["10", "12"],
    };
    const months = quarterMonthMap[quarterValue];

    if (!year || !months) {
      setFormPeriodStart("");
      setFormPeriodEnd("");
      return;
    }

    const [startMonth, endMonth] = months;
    const lastDay = new Date(year, Number(endMonth), 0).getDate();
    setFormPeriodStart(`${year}-${startMonth}-01`);
    setFormPeriodEnd(`${year}-${endMonth}-${String(lastDay).padStart(2, "0")}`);
  };

  const applyYearlyPeriod = (yearValue: string) => {
    setPeriodYear(yearValue);
    const year = Number(yearValue);

    if (!year) {
      setFormPeriodStart("");
      setFormPeriodEnd("");
      return;
    }

    setFormPeriodStart(`${year}-01-01`);
    setFormPeriodEnd(`${year}-12-31`);
  };

  const handlePeriodTypeChange = (value: PeriodType) => {
    setPeriodType(value);
    setFormPeriodStart("");
    setFormPeriodEnd("");

    if (value === "custom") {
      return;
    }

    if (value === "monthly") {
      applyMonthlyPeriod(periodMonth);
      return;
    }

    if (value === "quarterly") {
      applyQuarterlyPeriod(periodYear, periodQuarter);
      return;
    }

    applyYearlyPeriod(periodYear);
  };

  const filteredIndicators = useMemo(() => {
    const term = indicatorSearch.trim().toLowerCase();
    if (!term) return availableIndicators;
    return availableIndicators.filter((indicator) => {
      const name = indicator.name.toLowerCase();
      const code = String(indicator.code || "").toLowerCase();
      return name.includes(term) || code.includes(term);
    });
  }, [availableIndicators, indicatorSearch]);

  const selectedIndicators = useMemo(
    () =>
      selectedIndicatorIds
        .map((indicatorId) =>
          availableIndicators.find((indicator) => String(indicator.id) === indicatorId),
        )
        .filter((indicator): indicator is OptionItem => Boolean(indicator)),
    [availableIndicators, selectedIndicatorIds],
  );

  const selectedIndicatorsLabel = useMemo(() => {
    if (selectedIndicatorIds.length === 0) return "Select indicators";
    if (selectedIndicatorIds.length === 1) {
      return selectedIndicators[0]?.name || "1 indicator selected";
    }
    return `${selectedIndicatorIds.length} indicators selected`;
  }, [selectedIndicatorIds.length, selectedIndicators]);

  const canSelectIndicators = Boolean(formProject && formOrganization);
  const strongFieldClass = "border-2 bg-background shadow-sm";
  const fieldBlockClass = "space-y-1.5";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 h-4 w-4" /> Add Entry
        </Button>
      </DialogTrigger>
      <DialogContent className="fixed inset-0 !top-0 !left-0 !translate-x-0 !translate-y-0 !max-w-none !w-screen !h-screen overflow-hidden rounded-none p-0">
        <DialogHeader className="border-b border-border/70 px-5 py-4">
          <DialogTitle>Add Aggregate Entries</DialogTitle>
          <DialogDescription>
            Select a project, organization, and one or more indicators. Each indicator will render the entry table its disaggregates require.
          </DialogDescription>
        </DialogHeader>

        <div className="grid h-[calc(100vh-138px)] gap-4 overflow-y-auto px-5 py-4">
          <div className="grid gap-x-3 gap-y-2 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,0.9fr)_minmax(0,1.5fr)] lg:items-end">
            <div className={fieldBlockClass}>
              <Label htmlFor="agg-project">Project</Label>
              <Select value={formProject} onValueChange={setFormProject}>
                <SelectTrigger id="agg-project" className={strongFieldClass}>
                  <SelectValue placeholder="Select project" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((project) => (
                    <SelectItem key={project.id} value={String(project.id)}>
                      {project.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className={fieldBlockClass}>
              <Label htmlFor="agg-org">Organization</Label>
              <OrganizationSelect
                organizations={availableOrganizations}
                value={formOrganization}
                onChange={setFormOrganization}
                className={strongFieldClass}
                placeholder={
                  formProject ? "Select organization" : "Select project first"
                }
                disabled={
                  !formProject ||
                  availableOrganizations.length === 0 ||
                  isOrganizationSelectionLocked
                }
              />
            </div>

            <div className={fieldBlockClass}>
              <Label>Indicators</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn("w-full justify-between border-2 bg-background shadow-sm", strongFieldClass)}
                    disabled={!canSelectIndicators || availableIndicators.length === 0}
                  >
                    <span className="truncate text-left">{selectedIndicatorsLabel}</span>
                    <span className="ml-3 text-xs text-muted-foreground">
                      {selectedIndicatorIds.length}
                    </span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-[calc(100vw-2rem)] p-0 sm:w-[520px]">
                  <Command>
                    <CommandInput
                      placeholder="Search indicators..."
                      value={indicatorSearch}
                      onValueChange={setIndicatorSearch}
                    />
                    <CommandList>
                      <CommandEmpty>No indicators found.</CommandEmpty>
                      <CommandGroup heading="Indicators">
                        {filteredIndicators.map((indicator) => {
                          const indicatorId = String(indicator.id);
                          const checked = selectedIndicatorIds.includes(indicatorId);
                          return (
                            <CommandItem
                              key={indicator.id}
                              value={`${indicator.name} ${indicator.code || ""}`}
                              onSelect={() => onToggleIndicator(indicatorId)}
                              className="flex items-center justify-between gap-3"
                            >
                              <div className="min-w-0">
                                <div className="truncate">{indicator.name}</div>
                                {indicator.code ? (
                                  <div className="text-xs text-muted-foreground">
                                    {indicator.code}
                                  </div>
                                ) : null}
                              </div>
                              <Check
                                className={cn("h-4 w-4 shrink-0", checked ? "opacity-100" : "opacity-0")}
                              />
                            </CommandItem>
                          );
                        })}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            {!formProject ? (
              <p className="text-xs text-muted-foreground lg:col-span-3">
                Select a project first. Its attached organizations will determine which indicators can be reported.
              </p>
            ) : null}
            {formProject && !formOrganization ? (
              <p className="text-xs text-muted-foreground lg:col-span-3">
                Select an organization to load its reportable indicators.
              </p>
            ) : null}
          </div>

          <div className="grid gap-x-3 gap-y-2 md:grid-cols-[minmax(0,160px)_minmax(0,0.8fr)_minmax(0,0.8fr)] md:items-end">
            <div className={fieldBlockClass}>
              <Label htmlFor="agg-period-type">Period Type</Label>
              <Select value={periodType} onValueChange={(value) => handlePeriodTypeChange(value as PeriodType)}>
                <SelectTrigger id="agg-period-type" className={cn("h-9", strongFieldClass)}>
                  <SelectValue placeholder="Select period type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="custom">Custom</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="quarterly">Quarterly</SelectItem>
                  <SelectItem value="yearly">Yearly</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {periodType === "custom" ? (
              <>
                <div className={fieldBlockClass}>
                  <Label htmlFor="agg-period-start">Period Start</Label>
                  <Input
                    id="agg-period-start"
                    type="date"
                    className={cn("h-9 max-w-[180px]", strongFieldClass)}
                    value={formPeriodStart}
                    onChange={(event) => setFormPeriodStart(event.target.value)}
                  />
                </div>
                <div className={fieldBlockClass}>
                  <Label htmlFor="agg-period-end">Period End</Label>
                  <Input
                    id="agg-period-end"
                    type="date"
                    className={cn("h-9 max-w-[180px]", strongFieldClass)}
                    value={formPeriodEnd}
                    onChange={(event) => setFormPeriodEnd(event.target.value)}
                  />
                </div>
              </>
            ) : null}

            {periodType === "monthly" ? (
              <>
                <div className={fieldBlockClass}>
                  <Label htmlFor="agg-period-month">Month</Label>
                  <Input
                    id="agg-period-month"
                    type="month"
                    className={cn("h-9 max-w-[180px]", strongFieldClass)}
                    value={periodMonth}
                    onChange={(event) => applyMonthlyPeriod(event.target.value)}
                  />
                </div>
                <div className={fieldBlockClass}>
                  <Label>Range</Label>
                  <div className="flex h-9 items-center rounded-md border-2 border-input bg-background px-3 text-sm text-muted-foreground shadow-sm">
                    {formPeriodStart && formPeriodEnd
                      ? `${formPeriodStart} to ${formPeriodEnd}`
                      : "Choose month"}
                  </div>
                </div>
              </>
            ) : null}

            {periodType === "quarterly" ? (
              <>
                <div className={fieldBlockClass}>
                  <Label htmlFor="agg-period-year">Year</Label>
                  <Input
                    id="agg-period-year"
                    type="number"
                    inputMode="numeric"
                    min="2000"
                    max="2100"
                    className={cn("h-9 max-w-[120px]", strongFieldClass)}
                    value={periodYear}
                    onChange={(event) => applyQuarterlyPeriod(event.target.value, periodQuarter)}
                  />
                </div>
                <div className={fieldBlockClass}>
                  <Label htmlFor="agg-period-quarter">Quarter</Label>
                  <Select
                    value={periodQuarter}
                    onValueChange={(value) => applyQuarterlyPeriod(periodYear, value)}
                  >
                    <SelectTrigger
                      id="agg-period-quarter"
                      className={cn("h-9 max-w-[140px]", strongFieldClass)}
                    >
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
              </>
            ) : null}

            {periodType === "yearly" ? (
              <>
                <div className={fieldBlockClass}>
                  <Label htmlFor="agg-period-year-only">Year</Label>
                  <Input
                    id="agg-period-year-only"
                    type="number"
                    inputMode="numeric"
                    min="2000"
                    max="2100"
                    className={cn("h-9 max-w-[120px]", strongFieldClass)}
                    value={periodYear}
                    onChange={(event) => applyYearlyPeriod(event.target.value)}
                  />
                </div>
                <div className={fieldBlockClass}>
                  <Label>Range</Label>
                  <div className="flex h-9 items-center rounded-md border-2 border-input bg-background px-3 text-sm text-muted-foreground shadow-sm">
                    {formPeriodStart && formPeriodEnd
                      ? `${formPeriodStart} to ${formPeriodEnd}`
                      : "Choose year"}
                  </div>
                </div>
              </>
            ) : null}
          </div>

          {selectedIndicators.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
              Select one or more indicators to build their aggregate entry tables.
            </div>
          ) : (
            <div className="space-y-4">
              {selectedIndicators.map((indicator) => {
                const indicatorId = String(indicator.id);
                const config = indicatorConfigs[indicatorId];
                const draft = indicatorDrafts[indicatorId];

                if (!config || !draft) return null;

                const showSecondaryColumn = !(
                  config.secondaryValues.length === 1 && config.secondaryValues[0] === "All"
                );
                const matrixTotal = computeEntryMatrixTotal(draft.matrixValues, config);

                return (
                  <div key={indicator.id} className="rounded-xl border border-border bg-card p-3">
                    <div className="mb-2.5 flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <h3 className="text-base font-semibold">{indicator.name}</h3>
                        {indicator.code ? (
                          <p className="text-sm text-muted-foreground">{indicator.code}</p>
                        ) : null}
                      </div>
                      <div className="rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">
                        {config.hasDisaggregates ? "Disaggregated entry" : "Total only"}
                      </div>
                    </div>

                    {config.hasDisaggregates ? (
                      <div className="space-y-2">
                        <p className="text-xs text-muted-foreground">
                          Enter values by {config.primaryLabel}
                          {showSecondaryColumn ? `, ${config.secondaryLabel}` : ""}
                          {config.bandValues[0] !== "Value" ? `, and ${config.bandLabel}` : ""}.
                        </p>

                        <div className="w-full max-w-full overflow-x-auto overflow-y-auto rounded-lg border border-border overscroll-x-contain">
                          <table className="w-full min-w-[680px] border-separate border-spacing-0 text-xs">
                            <thead>
                              <tr>
                                <th className="sticky top-0 z-20 border-b border-r border-border bg-muted/90 px-1.5 py-1 text-left">
                                  {config.primaryLabel}
                                </th>
                                {showSecondaryColumn ? (
                                  <th className="sticky top-0 z-20 border-b border-r border-border bg-muted/90 px-1.5 py-1 text-left">
                                    {config.secondaryLabel}
                                  </th>
                                ) : null}
                                {config.bandValues.map((bandValue) => (
                                  <th
                                    key={bandValue}
                                    className="sticky top-0 z-10 border-b border-r border-border bg-muted/90 px-1.5 py-1 text-center whitespace-nowrap"
                                  >
                                    {bandValue}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {config.primaryValues.map((primaryValue) =>
                                config.secondaryValues.map((secondaryValue) => (
                                  <tr
                                    key={`${indicatorId}-${primaryValue}-${secondaryValue}`}
                                    className="bg-background"
                                  >
                                    <td className="border-b border-r border-border px-1.5 py-1 font-medium whitespace-nowrap">
                                      {primaryValue}
                                    </td>
                                    {showSecondaryColumn ? (
                                      <td className="border-b border-r border-border px-1.5 py-1 whitespace-nowrap">
                                        {secondaryValue}
                                      </td>
                                    ) : null}
                                    {config.bandValues.map((bandValue) => (
                                      <td
                                        key={`${indicatorId}-${primaryValue}-${secondaryValue}-${bandValue}`}
                                        className="border-b border-r border-border px-1 py-0.5"
                                      >
                                        <Input
                                          type="number"
                                          className={cn("h-7 min-w-[64px] border-2 px-2 text-center shadow-sm sm:min-w-[76px]", strongFieldClass)}
                                          value={
                                            draft.matrixValues[primaryValue]?.[secondaryValue]?.[bandValue] ??
                                            ""
                                          }
                                          onChange={(event) =>
                                            onMatrixCellChange(
                                              indicatorId,
                                              primaryValue,
                                              secondaryValue,
                                              bandValue,
                                              event.target.value,
                                            )
                                          }
                                        />
                                      </td>
                                    ))}
                                  </tr>
                                )),
                              )}
                            </tbody>
                          </table>
                        </div>

                        <div className="text-xs text-muted-foreground">
                          Total:{" "}
                          <span className="font-semibold text-foreground">
                            {matrixTotal.toLocaleString()}
                          </span>
                        </div>
                      </div>
                    ) : (
                      <div className="grid gap-1.5 sm:max-w-[220px]">
                        <Label htmlFor={`agg-total-${indicatorId}`}>Total</Label>
                        <Input
                          id={`agg-total-${indicatorId}`}
                          type="number"
                          placeholder="0"
                          className={cn("h-8", strongFieldClass)}
                          value={draft.total}
                          onChange={(event) => onTotalChange(indicatorId, event.target.value)}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div className="grid gap-3">
            <div className={fieldBlockClass}>
              <Label htmlFor="agg-source">Data Source</Label>
              <Input
                id="agg-source"
                placeholder="e.g. DHIS2 report, Excel, routine register"
                className={cn("h-9", strongFieldClass)}
                value={formDataSource}
                onChange={(event) => setFormDataSource(event.target.value)}
              />
            </div>

            <div className={fieldBlockClass}>
              <Label htmlFor="agg-notes">Notes</Label>
              <Textarea
                id="agg-notes"
                placeholder="Optional notes"
                rows={4}
                className={cn("min-h-28 resize-y", strongFieldClass)}
                value={formNotes}
                onChange={(event) => setFormNotes(event.target.value)}
              />
            </div>
          </div>
        </div>

        <DialogFooter className="border-t border-border/70 px-5 py-4">
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onSave} disabled={isSubmitting}>
            {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save Entries
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
