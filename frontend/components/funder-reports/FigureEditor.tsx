"use client";

/**
 * FigureEditor — edit a funder-report figure's full configuration from the UI.
 *
 * Everything an authorized user can change (title, number, section, order, chart
 * type, contributing indicators + roles, grouping/secondary dimensions, target
 * mode, calculation mode, filters/exclusions, label overrides, narrative
 * template, active status) is persisted to the DB through the report-figure
 * models — never only on the frontend. Saving then re-runs the preview so the
 * chart immediately reflects the change.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { indicatorsService } from "@/lib/api";
import {
  funderReportsService, type GeneratedFigure, type ReportFigure, type ReportSection,
} from "@/lib/api/services/funderReports";
import { FigureChart } from "@/components/funder-reports/FigureChart";

const CHART_TYPES = ["achieved_vs_target", "grouped_bar", "stacked_bar", "horizontal_bar", "line", "pie", "heatmap", "cascade", "table"];
const DIMENSIONS = ["none", "organization", "coordinator", "indicator", "sex", "age", "key_population", "district", "period"];
const ROLES = ["achieved", "target", "numerator", "denominator", "category", "comparison", "excluded", "supporting_narrative"];
const TARGET_MODES = ["none", "org_quarter", "project"];
const CALC_MODES = ["none", "achievement_percent", "ratio_percent"];

interface Props {
  figure: ReportFigure;
  sections: ReportSection[];
  project: number | string;
  quarter: number | string;
  fiscalYear: number | string;
  canEditMappings: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

export function FigureEditor(props: Props) {
  const { figure, sections, project, quarter, fiscalYear, canEditMappings, open, onOpenChange, onSaved } = props;
  const { toast } = useToast();
  const [form, setForm] = useState<Partial<ReportFigure>>(figure);
  const [mappings, setMappings] = useState(figure.mappings ?? []);
  const [indicators, setIndicators] = useState<Array<{ id: number; name: string; code?: string }>>([]);
  const [newIndicator, setNewIndicator] = useState<string>("");
  const [newRole, setNewRole] = useState<string>("achieved");
  const [preview, setPreview] = useState<GeneratedFigure | null>(null);
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);

  useEffect(() => { setForm(figure); setMappings(figure.mappings ?? []); setPreview(null); }, [figure]);
  useEffect(() => {
    if (!open) return;
    indicatorsService.listAll().then((rows) =>
      setIndicators(rows.map((r) => ({ id: Number(r.id), name: r.name, code: r.code })))).catch(() => {});
  }, [open]);

  const set = (k: keyof ReportFigure, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  const status = useMemo(() => {
    if (mappings.length === 0 && form.grouping_dimension !== "none") return { label: "Needs indicator mapping", variant: "destructive" as const };
    if (mappings.length === 0) return { label: "Structural (no indicator)", variant: "secondary" as const };
    return { label: `Mapped · ${mappings.length} indicator(s)`, variant: "default" as const };
  }, [mappings, form.grouping_dimension]);

  const runPreview = useCallback(async () => {
    setPreviewing(true);
    try {
      const p = await funderReportsService.previewFigure(figure.id, {
        project: Number(project), quarter, fiscal_year: fiscalYear,
      });
      setPreview(p);
    } catch (e) {
      toast({ title: "Preview failed", description: e instanceof Error ? e.message : undefined, variant: "destructive" });
    } finally { setPreviewing(false); }
  }, [figure.id, project, quarter, fiscalYear, toast]);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      await funderReportsService.updateFigure(figure.id, {
        title: form.title, figure_number: form.figure_number, report_section: form.report_section,
        display_order: form.display_order, chart_type: form.chart_type,
        grouping_dimension: form.grouping_dimension, secondary_grouping_dimension: form.secondary_grouping_dimension,
        target_mode: form.target_mode, calculation_mode: form.calculation_mode,
        narrative_template: form.narrative_template, is_active: form.is_active,
      });
      toast({ title: "Figure saved" });
      await runPreview();          // immediately reflect the saved config
      onSaved();
    } catch (e) {
      toast({ title: "Save failed", description: e instanceof Error ? e.message : undefined, variant: "destructive" });
    } finally { setSaving(false); }
  }, [figure.id, form, runPreview, onSaved, toast]);

  const addMapping = useCallback(async () => {
    if (!newIndicator) return;
    try {
      const m = await funderReportsService.addMapping(figure.id, { indicator: Number(newIndicator), role: newRole });
      setMappings((prev) => [...prev, { ...m, indicator_name: indicators.find((i) => i.id === Number(newIndicator))?.name }]);
      setNewIndicator("");
    } catch (e) {
      toast({ title: "Add mapping failed", description: e instanceof Error ? e.message : undefined, variant: "destructive" });
    }
  }, [figure.id, newIndicator, newRole, indicators, toast]);

  const removeMapping = useCallback(async (id: number) => {
    try {
      await funderReportsService.deleteMapping(id);
      setMappings((prev) => prev.filter((m) => m.id !== id));
    } catch { toast({ title: "Remove failed", variant: "destructive" }); }
  }, [toast]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {form.figure_number} {form.title}
            <Badge variant={status.variant}>{status.label}</Badge>
            {form.target_mode !== "none" && preview && !preview.totals?.target && (
              <Badge variant="destructive">Missing target</Badge>
            )}
            {preview?.warnings?.some((w) => w.toLowerCase().includes("no data")) && (
              <Badge variant="destructive">No data</Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="chart">
          <TabsList>
            <TabsTrigger value="chart">Chart settings</TabsTrigger>
            <TabsTrigger value="indicators">Indicators</TabsTrigger>
            <TabsTrigger value="narrative">Narrative</TabsTrigger>
            <TabsTrigger value="preview">Preview</TabsTrigger>
          </TabsList>

          {/* Chart settings */}
          <TabsContent value="chart" className="grid grid-cols-2 gap-3">
            <div><Label>Title</Label><Input value={form.title ?? ""} onChange={(e) => set("title", e.target.value)} disabled={!canEditMappings} /></div>
            <div><Label>Figure number</Label><Input value={form.figure_number ?? ""} onChange={(e) => set("figure_number", e.target.value)} disabled={!canEditMappings} /></div>
            <div>
              <Label>Section</Label>
              <Select value={String(form.report_section)} onValueChange={(v) => set("report_section", Number(v))} disabled={!canEditMappings}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{sections.map((s) => <SelectItem key={s.id} value={String(s.id)}>{s.title}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Display order</Label><Input type="number" value={form.display_order ?? 0} onChange={(e) => set("display_order", Number(e.target.value))} disabled={!canEditMappings} /></div>
            {([
              ["chart_type", "Chart type", CHART_TYPES],
              ["grouping_dimension", "Group by", DIMENSIONS],
              ["secondary_grouping_dimension", "Secondary group", DIMENSIONS],
              ["target_mode", "Target mode", TARGET_MODES],
              ["calculation_mode", "Calculation", CALC_MODES],
            ] as const).map(([key, label, opts]) => (
              <div key={key}>
                <Label>{label}</Label>
                <Select value={String(form[key])} onValueChange={(v) => set(key, v)} disabled={!canEditMappings}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{opts.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            ))}
            <div className="flex items-center gap-2 pt-6">
              <Switch checked={!!form.is_active} onCheckedChange={(v) => set("is_active", v)} disabled={!canEditMappings} />
              <Label>Active (visible in reports)</Label>
            </div>
          </TabsContent>

          {/* Indicators */}
          <TabsContent value="indicators" className="space-y-3">
            {mappings.length === 0 && <p className="text-sm text-muted-foreground">No indicators mapped yet.</p>}
            {mappings.map((m) => (
              <div key={m.id} className="flex items-center justify-between rounded border px-3 py-2 text-sm">
                <span>{m.indicator_name ?? `Indicator ${m.indicator}`} <Badge variant="outline" className="ml-2">{m.role}</Badge></span>
                {canEditMappings && <Button size="icon" variant="ghost" onClick={() => removeMapping(m.id)}><Trash2 className="h-4 w-4" /></Button>}
              </div>
            ))}
            {canEditMappings && (
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <Label>Add indicator</Label>
                  <Select value={newIndicator} onValueChange={setNewIndicator}>
                    <SelectTrigger><SelectValue placeholder="Select indicator" /></SelectTrigger>
                    <SelectContent className="max-h-72">
                      {indicators.map((i) => <SelectItem key={i.id} value={String(i.id)}>{i.code ? `${i.code} · ` : ""}{i.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="w-40">
                  <Label>Role</Label>
                  <Select value={newRole} onValueChange={setNewRole}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{ROLES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <Button onClick={addMapping}><Plus className="h-4 w-4" /></Button>
              </div>
            )}
          </TabsContent>

          {/* Narrative */}
          <TabsContent value="narrative" className="space-y-2">
            <Label>Narrative template</Label>
            <Textarea rows={5} value={form.narrative_template ?? ""} onChange={(e) => set("narrative_template", e.target.value)} />
            <p className="text-xs text-muted-foreground">Placeholders: {"{total}"}, {"{target}"}, {"{achievement_percent}"}, {"{top_org}"}, {"{org_count}"}</p>
          </TabsContent>

          {/* Preview */}
          <TabsContent value="preview" className="space-y-3">
            <Button variant="outline" onClick={runPreview} disabled={previewing}>
              {previewing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Refresh preview
            </Button>
            {preview ? (
              <>
                <FigureChart figure={preview} />
                {preview.narrative && <p className="text-sm text-muted-foreground">{preview.narrative}</p>}
                {preview.warnings.length > 0 && (
                  <ul className="list-inside list-disc text-sm text-destructive">
                    {preview.warnings.map((w, i) => <li key={i}>{w}</li>)}
                  </ul>
                )}
              </>
            ) : <p className="text-sm text-muted-foreground">Run a preview to see the chart.</p>}
          </TabsContent>
        </Tabs>

        <div className="flex flex-wrap justify-end gap-2 border-t pt-3">
          <Button variant="outline" onClick={() => funderReportsService.duplicateFigure(figure.id).then(() => { toast({ title: "Figure duplicated" }); onSaved(); })}>Duplicate</Button>
          <Button variant="outline" onClick={runPreview} disabled={previewing}>Preview</Button>
          <Button onClick={save} disabled={saving || !canEditMappings}>{saving ? "Saving…" : "Save"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default FigureEditor;
