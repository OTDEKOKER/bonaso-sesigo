"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

import type { CoordinatorTargetBulkAssignRequest, CoordinatorTargetQuarter } from "@/lib/api";
import { getCurrentFiscalYear } from "@/components/targets/coordinator-targets-utils";
import type { NamedOption } from "@/components/targets/coordinator-targets-types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

type CoordinatorTargetBulkAssignDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  submitting?: boolean;
  projects: NamedOption[];
  coordinators: NamedOption[];
  indicators: NamedOption[];
  preselectedIndicatorId?: string | null;
  onSubmit: (request: CoordinatorTargetBulkAssignRequest) => Promise<void> | void;
};

type FormState = {
  projectId: string;
  coordinatorIds: string[];
  indicatorIds: string[];
  year: string;
  quarter: CoordinatorTargetQuarter;
  targetValue: string;
  notes: string;
  isActive: boolean;
};

const DEFAULT_FORM: FormState = {
  projectId: "",
  coordinatorIds: [],
  indicatorIds: [],
  year: String(getCurrentFiscalYear()),
  quarter: "Q1",
  targetValue: "",
  notes: "",
  isActive: true,
};

function toggleListValue(values: string[], value: string, checked: boolean): string[] {
  if (checked) {
    if (values.includes(value)) return values;
    return [...values, value];
  }
  return values.filter((item) => item !== value);
}

export function CoordinatorTargetBulkAssignDialog(props: CoordinatorTargetBulkAssignDialogProps) {
  const {
    open,
    onOpenChange,
    submitting = false,
    projects,
    coordinators,
    indicators,
    preselectedIndicatorId,
    onSubmit,
  } = props;
  const [form, setForm] = useState<FormState>(() => ({
    ...DEFAULT_FORM,
    indicatorIds: preselectedIndicatorId ? [preselectedIndicatorId] : [],
  }));
  const [errorMessage, setErrorMessage] = useState("");

  const canSubmit = Boolean(
    form.projectId &&
      form.coordinatorIds.length > 0 &&
      form.indicatorIds.length > 0 &&
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
      coordinator_ids: form.coordinatorIds.map((value) => Number(value)),
      indicator_ids: form.indicatorIds.map((value) => Number(value)),
      year: parsedYear,
      quarter: form.quarter,
      target_value: parsedTargetValue,
      notes: form.notes.trim() || undefined,
      is_active: form.isActive,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !submitting && onOpenChange(nextOpen)}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Bulk Assign Coordinator Targets</DialogTitle>
          <DialogDescription>
            Create or update targets for multiple coordinators and indicators in one action.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-1">
          <div className="grid gap-2">
            <Label>Project</Label>
            <Select value={form.projectId} onValueChange={(value) => setForm((current) => ({ ...current, projectId: value }))}>
              <SelectTrigger>
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

          <div className="grid gap-4 md:grid-cols-2">
            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <Label>Coordinators</Label>
                <Badge variant="outline">{form.coordinatorIds.length} selected</Badge>
              </div>
              <ScrollArea className="h-44 rounded-md border border-border p-2">
                <div className="grid gap-1.5">
                  {coordinators.map((option) => (
                    <label key={option.value} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/40">
                      <Checkbox
                        checked={form.coordinatorIds.includes(option.value)}
                        onCheckedChange={(checked) =>
                          setForm((current) => ({
                            ...current,
                            coordinatorIds: toggleListValue(current.coordinatorIds, option.value, checked === true),
                          }))
                        }
                      />
                      <span className="text-sm">{option.label}</span>
                    </label>
                  ))}
                </div>
              </ScrollArea>
            </div>

            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <Label>Indicators</Label>
                <Badge variant="outline">{form.indicatorIds.length} selected</Badge>
              </div>
              <ScrollArea className="h-44 rounded-md border border-border p-2">
                <div className="grid gap-1.5">
                  {indicators.map((option) => (
                    <label key={option.value} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/40">
                      <Checkbox
                        checked={form.indicatorIds.includes(option.value)}
                        onCheckedChange={(checked) =>
                          setForm((current) => ({
                            ...current,
                            indicatorIds: toggleListValue(current.indicatorIds, option.value, checked === true),
                          }))
                        }
                      />
                      <span className="text-sm">{option.label}</span>
                    </label>
                  ))}
                </div>
              </ScrollArea>
            </div>
          </div>

          <div className="grid gap-2 md:grid-cols-3">
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
                <SelectTrigger>
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

            <div className="grid gap-2">
              <Label>Target Value</Label>
              <Input
                type="number"
                inputMode="decimal"
                value={form.targetValue}
                onChange={(event) => setForm((current) => ({ ...current, targetValue: event.target.value }))}
                placeholder="0"
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label>Notes</Label>
            <Textarea
              value={form.notes}
              onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
              placeholder="Optional notes for this batch"
            />
          </div>

          <label className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
            <span className="text-sm">Mark assigned targets as active</span>
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
          <Button onClick={() => void submit()} disabled={submitting || !canSubmit}>
            {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Assign Targets
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
