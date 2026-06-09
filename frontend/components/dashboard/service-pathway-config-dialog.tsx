"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ConfiguredPathway } from "@/lib/dashboard/screening-insights";

export type PathwayIndicatorOption = { id: string; name: string; code?: string };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  indicators: PathwayIndicatorOption[];
  value: ConfiguredPathway[] | null;
  saving?: boolean;
  onSave: (next: ConfiguredPathway[]) => void;
};

function uid(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function cloneConfig(value: ConfiguredPathway[] | null): ConfiguredPathway[] {
  return (value ?? []).map((pathway) => ({
    id: pathway.id || uid("pathway"),
    label: pathway.label || "",
    stages: (pathway.stages || []).map((stage) => ({
      id: stage.id || uid("stage"),
      label: stage.label || "",
      color: stage.color,
      indicatorIds: [...(stage.indicatorIds || [])].map((value) => String(value)),
    })),
  }));
}

export function ServicePathwayConfigDialog({
  open,
  onOpenChange,
  indicators,
  value,
  saving,
  onSave,
}: Props) {
  const [draft, setDraft] = useState<ConfiguredPathway[]>(() => cloneConfig(value));

  // Reset the working copy whenever the dialog is (re)opened.
  useEffect(() => {
    if (open) setDraft(cloneConfig(value));
  }, [open, value]);

  const indicatorById = useMemo(
    () => new Map(indicators.map((indicator) => [String(indicator.id), indicator])),
    [indicators],
  );

  const addPathway = () =>
    setDraft((prev) => [
      ...prev,
      { id: uid("pathway"), label: "", stages: [{ id: uid("stage"), label: "", indicatorIds: [] }] },
    ]);

  const removePathway = (pathwayId: string) =>
    setDraft((prev) => prev.filter((pathway) => pathway.id !== pathwayId));

  const updatePathway = (pathwayId: string, patch: Partial<ConfiguredPathway>) =>
    setDraft((prev) => prev.map((pathway) => (pathway.id === pathwayId ? { ...pathway, ...patch } : pathway)));

  const mutateStages = (
    pathwayId: string,
    fn: (stages: ConfiguredPathway["stages"]) => ConfiguredPathway["stages"],
  ) =>
    setDraft((prev) =>
      prev.map((pathway) =>
        pathway.id === pathwayId ? { ...pathway, stages: fn(pathway.stages) } : pathway,
      ),
    );

  const addStage = (pathwayId: string) =>
    mutateStages(pathwayId, (stages) => [...stages, { id: uid("stage"), label: "", indicatorIds: [] }]);

  const removeStage = (pathwayId: string, stageId: string) =>
    mutateStages(pathwayId, (stages) => stages.filter((stage) => stage.id !== stageId));

  const updateStage = (
    pathwayId: string,
    stageId: string,
    patch: Partial<ConfiguredPathway["stages"][number]>,
  ) =>
    mutateStages(pathwayId, (stages) =>
      stages.map((stage) => (stage.id === stageId ? { ...stage, ...patch } : stage)),
    );

  const addIndicatorToStage = (pathwayId: string, stageId: string, indicatorId: string) =>
    mutateStages(pathwayId, (stages) =>
      stages.map((stage) =>
        stage.id === stageId && !stage.indicatorIds.map(String).includes(indicatorId)
          ? { ...stage, indicatorIds: [...stage.indicatorIds, indicatorId] }
          : stage,
      ),
    );

  const removeIndicatorFromStage = (pathwayId: string, stageId: string, indicatorId: string) =>
    mutateStages(pathwayId, (stages) =>
      stages.map((stage) =>
        stage.id === stageId
          ? { ...stage, indicatorIds: stage.indicatorIds.filter((id) => String(id) !== indicatorId) }
          : stage,
      ),
    );

  const handleSave = () => {
    // Drop empty pathways/stages so the dashboard doesn't render blank cards.
    const cleaned = draft
      .map((pathway) => ({
        ...pathway,
        label: pathway.label.trim() || "Pathway",
        stages: pathway.stages
          .filter((stage) => stage.indicatorIds.length > 0)
          .map((stage, index) => ({ ...stage, label: stage.label.trim() || `Stage ${index + 1}` })),
      }))
      .filter((pathway) => pathway.stages.length > 0);
    onSave(cleaned);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Configure service pathways</DialogTitle>
          <DialogDescription>
            Build each pathway as a funnel of stages, and choose which indicators feed each stage. Saved per
            organization for everyone on the home dashboard.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {draft.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
              No pathways yet. Add one to get started.
            </div>
          ) : null}

          {draft.map((pathway) => (
            <div key={pathway.id} className="rounded-xl border border-border bg-card p-4">
              <div className="mb-3 flex items-end gap-3">
                <div className="flex-1 space-y-1">
                  <Label>Pathway name</Label>
                  <Input
                    value={pathway.label}
                    placeholder="e.g. HIV"
                    onChange={(event) => updatePathway(pathway.id, { label: event.target.value })}
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => removePathway(pathway.id)}
                  aria-label="Remove pathway"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>

              <div className="space-y-3">
                {pathway.stages.map((stage) => {
                  const selectedIds = stage.indicatorIds.map(String);
                  const available = indicators.filter((indicator) => !selectedIds.includes(String(indicator.id)));
                  return (
                    <div key={stage.id} className="rounded-lg border border-border/70 bg-background p-3">
                      <div className="mb-2 flex items-end gap-2">
                        <div className="flex-1 space-y-1">
                          <Label className="text-xs">Stage label</Label>
                          <Input
                            value={stage.label}
                            placeholder="e.g. Tested"
                            onChange={(event) => updateStage(pathway.id, stage.id, { label: event.target.value })}
                          />
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="text-muted-foreground hover:text-destructive"
                          onClick={() => removeStage(pathway.id, stage.id)}
                          aria-label="Remove stage"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>

                      <div className="mb-2 flex flex-wrap gap-2">
                        {selectedIds.length === 0 ? (
                          <span className="text-xs text-muted-foreground">No indicators selected.</span>
                        ) : (
                          selectedIds.map((id) => {
                            const indicator = indicatorById.get(id);
                            return (
                              <span
                                key={id}
                                className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-1 text-xs"
                              >
                                {indicator ? indicator.name : `Indicator ${id}`}
                                <button
                                  type="button"
                                  onClick={() => removeIndicatorFromStage(pathway.id, stage.id, id)}
                                  className="text-muted-foreground hover:text-destructive"
                                  aria-label="Remove indicator"
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              </span>
                            );
                          })
                        )}
                      </div>

                      <Select
                        value=""
                        onValueChange={(indicatorId) => addIndicatorToStage(pathway.id, stage.id, indicatorId)}
                      >
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder="Add an indicator to this stage…" />
                        </SelectTrigger>
                        <SelectContent>
                          {available.length === 0 ? (
                            <div className="px-2 py-1.5 text-xs text-muted-foreground">All indicators added.</div>
                          ) : (
                            available.map((indicator) => (
                              <SelectItem key={indicator.id} value={String(indicator.id)}>
                                {indicator.code ? `${indicator.code} — ` : ""}
                                {indicator.name}
                              </SelectItem>
                            ))
                          )}
                        </SelectContent>
                      </Select>
                    </div>
                  );
                })}

                <Button type="button" variant="outline" size="sm" onClick={() => addStage(pathway.id)}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add stage
                </Button>
              </div>
            </div>
          ))}

          <Button type="button" variant="outline" onClick={addPathway}>
            <Plus className="mr-2 h-4 w-4" />
            Add pathway
          </Button>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save pathways"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
