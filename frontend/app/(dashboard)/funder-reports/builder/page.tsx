"use client";

/**
 * Funder Report Builder — figure configuration.
 *
 * Lists a template's sections + figures with mapping status, and opens the
 * FigureEditor so authorized users edit each figure's indicators, chart type,
 * grouping, target/calculation, filters and narrative — all persisted to the DB.
 * Admins configure everything; M&E Managers may curate figure mappings; officers
 * get read-only here (they generate/export on the main Funder Reports page).
 */
import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/contexts/auth-context";
import { projectsService } from "@/lib/api";
import {
  funderReportsService, type ReportFigure, type ReportSection, type ReportTemplateDetail,
} from "@/lib/api/services/funderReports";
import { FigureEditor } from "@/components/funder-reports/FigureEditor";

function currentFy(): number {
  const n = new Date();
  return n.getMonth() + 1 >= 4 ? n.getFullYear() : n.getFullYear() - 1;
}

function figureStatus(fig: ReportFigure): { label: string; variant: "default" | "secondary" | "destructive" | "outline" } {
  const count = fig.mappings?.length ?? 0;
  if (fig.grouping_dimension === "none" && fig.chart_type === "table" && count === 0)
    return { label: "Structural", variant: "secondary" };
  if (count === 0) return { label: "Needs indicator mapping", variant: "destructive" };
  return { label: `Mapped · ${count}`, variant: "default" };
}

export default function ReportBuilderPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const canEditMappings = user?.role === "admin" || user?.role === "manager";

  const [projects, setProjects] = useState<Array<{ id: number | string; name: string }>>([]);
  const [projectId, setProjectId] = useState("");
  const [templates, setTemplates] = useState<Array<{ id: number; name: string; reporting_year: string }>>([]);
  const [templateId, setTemplateId] = useState("");
  const [detail, setDetail] = useState<ReportTemplateDetail | null>(null);
  const [quarter, setQuarter] = useState("4");
  const [fy, setFy] = useState(String(currentFy()));
  const [editing, setEditing] = useState<ReportFigure | null>(null);

  useEffect(() => {
    projectsService.list({ status: "active" })
      .then((r) => setProjects((r.results ?? []).map((p) => ({ id: p.id, name: p.name })))).catch(() => {});
  }, []);
  useEffect(() => {
    if (!projectId) { setTemplates([]); return; }
    funderReportsService.listTemplates({ project: Number(projectId) })
      .then((rows) => setTemplates(rows.map((t) => ({ id: t.id, name: t.name, reporting_year: t.reporting_year })))).catch(() => {});
  }, [projectId]);

  const loadDetail = useCallback(async (id: string) => {
    if (!id) { setDetail(null); return; }
    try { setDetail(await funderReportsService.getTemplate(Number(id))); }
    catch { toast({ title: "Failed to load template", variant: "destructive" }); }
  }, [toast]);
  useEffect(() => { void loadDetail(templateId); }, [templateId, loadDetail]);

  const sections: ReportSection[] = detail?.sections ?? [];

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Funder Report Builder</h1>
        <p className="text-muted-foreground">Configure each figure&apos;s indicators, chart type and rules. Changes are saved to the database and reflected on next generation.</p>
      </div>

      <Card>
        <CardHeader><CardTitle>Template</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="w-64">
            <Label>Project</Label>
            <Select value={projectId} onValueChange={(v) => { setProjectId(v); setTemplateId(""); setDetail(null); }}>
              <SelectTrigger><SelectValue placeholder="Select project" /></SelectTrigger>
              <SelectContent>{projects.map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="w-64">
            <Label>Report template</Label>
            <Select value={templateId} onValueChange={setTemplateId} disabled={!templates.length}>
              <SelectTrigger><SelectValue placeholder={templates.length ? "Select" : "No templates"} /></SelectTrigger>
              <SelectContent>{templates.map((t) => <SelectItem key={t.id} value={String(t.id)}>{t.name} {t.reporting_year}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="w-24"><Label>Quarter</Label>
            <Select value={quarter} onValueChange={setQuarter}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{[1, 2, 3, 4].map((q) => <SelectItem key={q} value={String(q)}>Q{q}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="w-28"><Label>Fiscal year</Label><Input type="number" value={fy} onChange={(e) => setFy(e.target.value)} /></div>
          {detail && canEditMappings && (
            <div className="w-48">
              <Label>Share / visibility</Label>
              <Select
                value={detail.visibility ?? "private"}
                onValueChange={(v) => funderReportsService.updateTemplate(detail.id, { visibility: v as never })
                  .then(() => { toast({ title: "Visibility updated" }); loadDetail(templateId); })
                  .catch(() => toast({ title: "Update failed", variant: "destructive" }))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="private">Only me</SelectItem>
                  <SelectItem value="organization">My organization</SelectItem>
                  <SelectItem value="network">My hierarchy / network</SelectItem>
                  <SelectItem value="project">Project network</SelectItem>
                  <SelectItem value="funder">Funder / client</SelectItem>
                  <SelectItem value="public">Everyone</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </CardContent>
      </Card>

      {!canEditMappings && detail && (
        <p className="text-sm text-muted-foreground">You have read-only access to figure configuration.</p>
      )}

      {sections.map((section) => (
        <Card key={section.id}>
          <CardHeader>
            <CardTitle className="text-base">{section.objective_label ? `${section.objective_label}: ` : ""}{section.title}</CardTitle>
            <CardDescription>{section.figures.length} figure(s)</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {section.figures.map((fig) => {
              const st = figureStatus(fig);
              return (
                <div key={fig.id} className="flex items-center justify-between rounded border px-3 py-2">
                  <div className="flex items-center gap-2 text-sm">
                    {fig.figure_number && <Badge variant="outline">{fig.figure_number}</Badge>}
                    <span>{fig.title}</span>
                    <Badge variant={st.variant}>{st.label}</Badge>
                    {!fig.is_active && <Badge variant="secondary">Disabled</Badge>}
                    {fig.target_mode !== "none" && <Badge variant="outline">vs target</Badge>}
                  </div>
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost"
                      onClick={() => funderReportsService.setFigureActive(fig.id, !fig.is_active).then(() => loadDetail(templateId))}>
                      {fig.is_active ? "Disable" : "Enable"}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setEditing(fig)}>Edit</Button>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      ))}

      {editing && (
        <FigureEditor
          figure={editing}
          sections={sections}
          project={projectId}
          quarter={quarter}
          fiscalYear={fy}
          canEditMappings={canEditMappings}
          open={!!editing}
          onOpenChange={(o) => { if (!o) setEditing(null); }}
          onSaved={() => loadDetail(templateId)}
        />
      )}
    </div>
  );
}
