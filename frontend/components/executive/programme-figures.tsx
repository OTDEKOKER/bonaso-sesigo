"use client";

/**
 * Programme Figures — a CONFIG-DRIVEN executive visualization panel.
 *
 * Nothing here is hardcoded: it lists the funder-report template(s) configured
 * for the current project, lists that template's figures, and renders the
 * selected one through the live funder-report engine (previewFigure) using the
 * shared FigureChart renderer. Change what executives see by editing the Report
 * Builder — no code change. Covers indicators-vs-target, indicator comparison
 * and disaggregates because those are exactly what the figure configs express.
 */
import { useEffect, useState } from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FigureChart } from "@/components/funder-reports/FigureChart";
import {
  funderReportsService,
  type GeneratedFigure,
  type ReportFigure,
  type ReportTemplate,
} from "@/lib/api/services/funderReports";

function figureLabel(figure: ReportFigure): string {
  const number = (figure as { figure_number?: string }).figure_number;
  return `${number ? `${number}: ` : ""}${figure.title}`;
}

export function ProgrammeFigures({
  projectId,
  periodStart,
  periodEnd,
}: {
  projectId?: number | null;
  periodStart?: string;
  periodEnd?: string;
}) {
  const [templates, setTemplates] = useState<ReportTemplate[]>([]);
  const [templateId, setTemplateId] = useState<number | null>(null);
  const [figures, setFigures] = useState<ReportFigure[]>([]);
  const [figureId, setFigureId] = useState<number | null>(null);
  const [generated, setGenerated] = useState<GeneratedFigure | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 1. funder-report templates configured for this project.
  useEffect(() => {
    if (!projectId) {
      setTemplates([]);
      setTemplateId(null);
      return;
    }
    let alive = true;
    funderReportsService
      .listTemplates({ project: projectId, is_active: true })
      .then((rows) => {
        if (!alive) return;
        setTemplates(rows);
        setTemplateId(rows[0]?.id ?? null);
      })
      .catch(() => {
        if (alive) setTemplates([]);
      });
    return () => {
      alive = false;
    };
  }, [projectId]);

  // 2. the selected template's figures (the config).
  useEffect(() => {
    if (!templateId) {
      setFigures([]);
      setFigureId(null);
      return;
    }
    let alive = true;
    funderReportsService
      .getTemplate(templateId)
      .then((tpl) => {
        if (!alive) return;
        const figs = (tpl.sections ?? []).flatMap((section) => section.figures ?? []);
        setFigures(figs);
        setFigureId(figs[0]?.id ?? null);
      })
      .catch(() => {
        if (alive) setFigures([]);
      });
    return () => {
      alive = false;
    };
  }, [templateId]);

  // 3. render the selected figure through the live engine.
  useEffect(() => {
    if (!figureId || !projectId || !periodStart || !periodEnd) {
      setGenerated(null);
      return;
    }
    let alive = true;
    setLoading(true);
    setError(null);
    funderReportsService
      .previewFigure(figureId, { project: projectId, period_start: periodStart, period_end: periodEnd })
      .then((figure) => {
        if (alive) setGenerated(figure);
      })
      .catch(() => {
        if (alive) setError("Could not generate this figure for the selected period.");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [figureId, projectId, periodStart, periodEnd]);

  // No project selected, or no funder report configured for it → stay hidden.
  if (!projectId || templates.length === 0) return null;

  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Programme Figures</h2>
          <p className="text-xs text-muted-foreground">
            Live funder-report figures — defined in the Report Builder, not hardcoded.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {templates.length > 1 && (
            <Select value={templateId ? String(templateId) : undefined} onValueChange={(v) => setTemplateId(Number(v))}>
              <SelectTrigger className="h-8 w-[200px] text-xs">
                <SelectValue placeholder="Template" />
              </SelectTrigger>
              <SelectContent>
                {templates.map((tpl) => (
                  <SelectItem key={tpl.id} value={String(tpl.id)}>
                    {tpl.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Select value={figureId ? String(figureId) : undefined} onValueChange={(v) => setFigureId(Number(v))}>
            <SelectTrigger className="h-8 w-[300px] max-w-[70vw] text-xs">
              <SelectValue placeholder="Choose a figure" />
            </SelectTrigger>
            <SelectContent>
              {figures.map((figure) => (
                <SelectItem key={figure.id} value={String(figure.id)}>
                  {figureLabel(figure)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {loading ? (
        <p className="py-16 text-center text-sm text-muted-foreground">Generating figure…</p>
      ) : error ? (
        <p className="py-16 text-center text-sm text-destructive">{error}</p>
      ) : generated ? (
        <FigureChart figure={generated} height={340} />
      ) : (
        <p className="py-16 text-center text-sm text-muted-foreground">Select a figure to render.</p>
      )}
    </div>
  );
}
