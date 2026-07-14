"use client";

/**
 * Funder Reports — preview dashboard.
 *
 * M&E officers / admins pick a template + project + reporting period and
 * generate the whole funder report: every configured figure rendered in report
 * order from EXISTING approved aggregate data, with narratives, completeness and
 * data-quality warnings. Configuration (which indicators power each figure)
 * lives in the admin builder / Django admin; this page is generation + review.
 */
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { projectsService } from "@/lib/api";
import {
  funderReportsService, downloadBlob,
  type GeneratedDashboard, type PeriodQuery, type ReportTemplate,
} from "@/lib/api/services/funderReports";
import { FigureChart } from "@/components/funder-reports/FigureChart";

function currentFiscalStartYear(): number {
  const now = new Date();
  return now.getMonth() + 1 >= 4 ? now.getFullYear() : now.getFullYear() - 1;
}

export default function FunderReportsPage() {
  const { toast } = useToast();
  const [projects, setProjects] = useState<Array<{ id: number | string; name: string }>>([]);
  const [projectId, setProjectId] = useState<string>("");
  const [templates, setTemplates] = useState<ReportTemplate[]>([]);
  const [templateId, setTemplateId] = useState<string>("");
  const [periodType, setPeriodType] = useState<"quarter" | "year">("quarter");
  const [quarter, setQuarter] = useState<string>("1");
  const [fy, setFy] = useState<string>(String(currentFiscalStartYear()));
  const [sex, setSex] = useState<string>("all");
  const [kvp, setKvp] = useState<string>("");
  const [age, setAge] = useState<string>("");
  const [includePending, setIncludePending] = useState(false);
  const [dashboard, setDashboard] = useState<GeneratedDashboard | null>(null);
  const [activeFilters, setActiveFilters] = useState<string>("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    projectsService.list({ status: "active" })
      .then((res) => setProjects((res.results ?? []).map((p) => ({ id: p.id, name: p.name }))))
      .catch(() => setProjects([]));
  }, []);

  useEffect(() => {
    if (!projectId) { setTemplates([]); return; }
    funderReportsService.listTemplates({ project: Number(projectId), is_active: true })
      .then(setTemplates).catch(() => setTemplates([]));
  }, [projectId]);

  const buildQuery = useCallback((): PeriodQuery => ({
    project: Number(projectId), period_type: periodType,
    fiscal_year: Number(fy), quarter: periodType === "quarter" ? Number(quarter) : undefined,
    sex: sex !== "all" ? [sex] : undefined,
    key_population: kvp ? kvp.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
    age: age ? age.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
    include_unapproved: includePending || undefined,
  }), [projectId, periodType, fy, quarter, sex, kvp, age, includePending]);

  const exportWord = useCallback(async () => {
    if (!templateId) return;
    try {
      const blob = await funderReportsService.exportReportWord(Number(templateId), buildQuery());
      downloadBlob(blob, `funder_report_${fy}_Q${quarter}.docx`);
    } catch (e) {
      toast({ title: "Word export failed", description: e instanceof Error ? e.message : undefined, variant: "destructive" });
    }
  }, [templateId, buildQuery, fy, quarter, toast]);

  const exportFigure = useCallback(async (figureId: number, label: string) => {
    try {
      const blob = await funderReportsService.exportFigureXlsx(figureId, buildQuery());
      downloadBlob(blob, `${label || "figure"}.xlsx`);
    } catch (e) {
      toast({ title: "Excel export failed", description: e instanceof Error ? e.message : undefined, variant: "destructive" });
    }
  }, [buildQuery, toast]);

  const generate = useCallback(async () => {
    if (!templateId || !projectId) { toast({ title: "Pick a project and template", variant: "destructive" }); return; }
    setLoading(true);
    try {
      const filters: string[] = [];
      const data = await funderReportsService.generate(Number(templateId), buildQuery());
      if (sex !== "all") filters.push(`sex: ${sex}`);
      if (kvp) filters.push(`KVP: ${kvp}`);
      if (age) filters.push(`age: ${age}`);
      filters.push(includePending ? "incl. pending (if permitted)" : "approved only");
      setActiveFilters(filters.join(" · "));
      setDashboard(data);
    } catch (e) {
      toast({ title: "Generation failed", description: e instanceof Error ? e.message : undefined, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [templateId, projectId, buildQuery, sex, kvp, age, includePending, toast]);

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Reports</h1>
        <p className="text-muted-foreground">
          Generate funder-ready figures from approved aggregate data, in report order.
        </p>
      </div>

      <Card>
        <CardHeader><CardTitle>Generate report</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="w-64">
            <Label>Project</Label>
            <Select value={projectId} onValueChange={(v) => { setProjectId(v); setTemplateId(""); }}>
              <SelectTrigger><SelectValue placeholder="Select project" /></SelectTrigger>
              <SelectContent>
                {projects.map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="w-64">
            <Label>Report template</Label>
            <Select value={templateId} onValueChange={setTemplateId} disabled={!templates.length}>
              <SelectTrigger><SelectValue placeholder={templates.length ? "Select template" : "No templates"} /></SelectTrigger>
              <SelectContent>
                {templates.map((t) => <SelectItem key={t.id} value={String(t.id)}>{t.name} {t.reporting_year}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="w-32">
            <Label>Period</Label>
            <Select value={periodType} onValueChange={(v) => setPeriodType(v as "quarter" | "year")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="quarter">Quarter</SelectItem>
                <SelectItem value="year">Annual</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {periodType === "quarter" && (
            <div className="w-24">
              <Label>Quarter</Label>
              <Select value={quarter} onValueChange={setQuarter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 4].map((q) => <SelectItem key={q} value={String(q)}>Q{q}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="w-28">
            <Label>Fiscal year</Label>
            <Input type="number" value={fy} onChange={(e) => setFy(e.target.value)} />
          </div>
          <div className="w-28">
            <Label>Sex</Label>
            <Select value={sex} onValueChange={setSex}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="Female">Female</SelectItem>
                <SelectItem value="Male">Male</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="w-40"><Label>KVP (comma-sep)</Label><Input value={kvp} onChange={(e) => setKvp(e.target.value)} placeholder="e.g. FSW, MSM" /></div>
          <div className="w-40"><Label>Age (comma-sep)</Label><Input value={age} onChange={(e) => setAge(e.target.value)} placeholder="e.g. 20-24" /></div>
          <label className="flex items-center gap-2 pb-2 text-sm">
            <input type="checkbox" checked={includePending} onChange={(e) => setIncludePending(e.target.checked)} />
            Include pending (approvers only)
          </label>
          <Button onClick={generate} disabled={loading}>{loading ? "Generating…" : "Generate"}</Button>
        </CardContent>
      </Card>

      {dashboard && (
        <div className="space-y-8">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="text-xl font-semibold">{dashboard.template.name} — {dashboard.period_label}</h2>
              {activeFilters && <p className="text-sm text-muted-foreground">Filters: {activeFilters}</p>}
            </div>
            <Button variant="outline" onClick={exportWord}>Export report (Word)</Button>
          </div>
          {dashboard.sections.map((section) => (
            <section key={section.id} className="space-y-4">
              <h3 className="border-b pb-1 text-lg font-semibold">
                {section.objective_label ? `${section.objective_label}: ` : ""}{section.title}
              </h3>
              {section.figures.length === 0 && (
                <p className="text-sm text-muted-foreground">No active figures in this section.</p>
              )}
              {section.figures.map((figure) => (
                <Card key={figure.figure_id}>
                  <CardHeader>
                    <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                      {figure.figure_number && <Badge variant="outline">{figure.figure_number}</Badge>}
                      {figure.title}
                      <Button size="sm" variant="ghost" className="ml-auto"
                        onClick={() => exportFigure(figure.figure_id, `${figure.figure_number}_${figure.title}`.replace(/[^\w-]+/g, "_"))}>
                        Excel
                      </Button>
                    </CardTitle>
                    {figure.totals && (
                      <CardDescription>
                        Total: {new Intl.NumberFormat().format(Math.round(figure.totals.total))}
                        {figure.totals.target != null && ` · Target: ${new Intl.NumberFormat().format(Math.round(figure.totals.target))}`}
                        {figure.totals.achievement_percent != null && ` · ${figure.totals.achievement_percent}% achieved`}
                        {figure.completeness && figure.completeness.expected > 0 &&
                          ` · ${figure.completeness.reporting}/${figure.completeness.expected} orgs reported`}
                      </CardDescription>
                    )}
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <FigureChart figure={figure} />
                    {figure.narrative && <p className="text-sm text-muted-foreground">{figure.narrative}</p>}
                    {figure.warnings.length > 0 && (
                      <Alert variant="destructive">
                        <AlertTriangle className="h-4 w-4" />
                        <AlertTitle>Data warnings</AlertTitle>
                        <AlertDescription>
                          <ul className="list-inside list-disc">
                            {figure.warnings.map((w, i) => <li key={i}>{w}</li>)}
                          </ul>
                        </AlertDescription>
                      </Alert>
                    )}
                  </CardContent>
                </Card>
              ))}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
