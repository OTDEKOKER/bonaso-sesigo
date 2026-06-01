"use client";

import { Calculator, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type OptionItem = {
  id: string | number;
  name: string;
  code?: string;
  type?: string;
};

type AggregateAutoCalcDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCalculate: () => void;
  isSubmitting: boolean;
  computedValue: number | null;
  projects: OptionItem[];
  organizations: OptionItem[];
  indicators: OptionItem[];
  isOrganizationSelectionLocked: boolean;
  autoProject: string;
  setAutoProject: (value: string) => void;
  autoOrganization: string;
  setAutoOrganization: (value: string) => void;
  autoOutputIndicator: string;
  setAutoOutputIndicator: (value: string) => void;
  autoSourceIndicator: string;
  setAutoSourceIndicator: (value: string) => void;
  autoOperator: "equals" | "not_equals" | "contains";
  setAutoOperator: (value: "equals" | "not_equals" | "contains") => void;
  autoMatchValue: string;
  setAutoMatchValue: (value: string) => void;
  autoCountDistinct: "respondent" | "interaction";
  setAutoCountDistinct: (value: "respondent" | "interaction") => void;
  autoPeriodStart: string;
  setAutoPeriodStart: (value: string) => void;
  autoPeriodEnd: string;
  setAutoPeriodEnd: (value: string) => void;
  autoSaveRule: boolean;
  setAutoSaveRule: (value: boolean) => void;
  autoSaveAggregate: boolean;
  setAutoSaveAggregate: (value: boolean) => void;
};

export function AggregateAutoCalcDialog(props: AggregateAutoCalcDialogProps) {
  const {
    open,
    onOpenChange,
    onCalculate,
    isSubmitting,
    computedValue,
    projects,
    organizations,
    indicators,
    isOrganizationSelectionLocked,
    autoProject,
    setAutoProject,
    autoOrganization,
    setAutoOrganization,
    autoOutputIndicator,
    setAutoOutputIndicator,
    autoSourceIndicator,
    setAutoSourceIndicator,
    autoOperator,
    setAutoOperator,
    autoMatchValue,
    setAutoMatchValue,
    autoCountDistinct,
    setAutoCountDistinct,
    autoPeriodStart,
    setAutoPeriodStart,
    autoPeriodEnd,
    setAutoPeriodEnd,
    autoSaveRule,
    setAutoSaveRule,
    autoSaveAggregate,
    setAutoSaveAggregate,
  } = props;

  const sourceIndicator = indicators.find(
    (indicator) => String(indicator.id) === autoSourceIndicator,
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Calculator className="mr-2 h-4 w-4" />
          Auto-calculate
        </Button>
      </DialogTrigger>
      <DialogContent className="w-[95vw] max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Auto-calculate Aggregate</DialogTitle>
          <DialogDescription>
            Create/update a derivation rule and compute an aggregate from interaction responses.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="space-y-2">
            <Label>Project</Label>
            <Select value={autoProject} onValueChange={setAutoProject}>
              <SelectTrigger>
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

          <div className="space-y-2">
            <Label>Organization</Label>
            <Select value={autoOrganization} onValueChange={setAutoOrganization}>
              <SelectTrigger disabled={isOrganizationSelectionLocked}>
                <SelectValue placeholder="Select organization" />
              </SelectTrigger>
              <SelectContent>
                {organizations.map((organization) => (
                  <SelectItem key={organization.id} value={String(organization.id)}>
                    {organization.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Output Indicator (the number you report)</Label>
            <Select value={autoOutputIndicator} onValueChange={setAutoOutputIndicator}>
              <SelectTrigger>
                <SelectValue placeholder="Select output indicator" />
              </SelectTrigger>
              <SelectContent>
                {indicators
                  .filter((indicator) => indicator.type === "number" || indicator.type === "percentage")
                  .map((indicator) => (
                    <SelectItem key={indicator.id} value={String(indicator.id)}>
                      {indicator.name} ({indicator.code})
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Source Indicator (screening indicator)</Label>
            <Select value={autoSourceIndicator} onValueChange={setAutoSourceIndicator}>
              <SelectTrigger>
                <SelectValue placeholder="Select source indicator" />
              </SelectTrigger>
              <SelectContent>
                {indicators.map((indicator) => (
                  <SelectItem key={indicator.id} value={String(indicator.id)}>
                    {indicator.name} ({indicator.code})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label>Operator</Label>
              <Select
                value={autoOperator}
                onValueChange={(value) =>
                  setAutoOperator(value as "equals" | "not_equals" | "contains")
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="equals">Equals</SelectItem>
                  <SelectItem value="not_equals">Not equals</SelectItem>
                  <SelectItem value="contains">Contains</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label>Match value</Label>
              {sourceIndicator?.type === "yes_no" ? (
                <Select value={autoMatchValue} onValueChange={setAutoMatchValue}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="yes">Yes</SelectItem>
                    <SelectItem value="no">No</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  value={autoMatchValue}
                  onChange={(event) => setAutoMatchValue(event.target.value)}
                  placeholder="e.g., yes"
                />
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Count distinct</Label>
            <Select
              value={autoCountDistinct}
              onValueChange={(value) =>
                setAutoCountDistinct(value as "respondent" | "interaction")
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="respondent">Respondent (people)</SelectItem>
                <SelectItem value="interaction">Interaction (services)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Period start</Label>
              <Input
                type="date"
                value={autoPeriodStart}
                onChange={(event) => setAutoPeriodStart(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Period end</Label>
              <Input
                type="date"
                value={autoPeriodEnd}
                onChange={(event) => setAutoPeriodEnd(event.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-6">
            <div className="flex items-center gap-2">
              <Checkbox
                checked={autoSaveRule}
                onCheckedChange={(value) => setAutoSaveRule(value === true)}
              />
              <span className="text-sm">Save mapping rule</span>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                checked={autoSaveAggregate}
                onCheckedChange={(value) => setAutoSaveAggregate(value === true)}
              />
              <span className="text-sm">Save aggregate record</span>
            </div>
          </div>

          {computedValue !== null ? (
            <div className="rounded-lg border border-border bg-secondary/30 p-3 text-sm">
              Computed value: <span className="font-medium">{computedValue}</span>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            Close
          </Button>
          <Button onClick={onCalculate} disabled={isSubmitting}>
            {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Calculate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
