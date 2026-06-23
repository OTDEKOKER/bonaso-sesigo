"use client";

/**
 * Read-only review panel for a LEGACY (non-SESIGO) workbook import job.
 *
 * The backend's fuzzy importer now emits per-sheet organization-match confidence,
 * alternative candidates, unknown-indicator candidates, and ambiguous/unresolved
 * diagnostics in ``job.result.aggregate_import_report``. This component surfaces
 * all of it so a reviewer can see exactly which sheet matched which organization,
 * how confident the match was, and what needs an override — so no ambiguous or
 * low-confidence import is ever presented as "successful" without explanation.
 *
 * It parses defensively (the report is typed ``unknown``) and renders nothing
 * when there is no legacy report (e.g. SESIGO imports, which have their own
 * deterministic preview flow).
 */
import { AlertTriangle, CheckCircle2, HelpCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";

type Candidate = { label: string; score: number };

type OrgMatch = {
  resolved?: boolean;
  reason?: string;
  confidence?: number;
  ambiguous?: boolean;
  candidates?: Candidate[];
};

type UnknownRowDetail = {
  title?: string;
  code?: string;
  reason?: string;
  confidence?: number;
  ambiguous?: boolean;
  candidates?: Candidate[];
};

type SheetReport = {
  organization_id?: number;
  organization_name?: string;
  organization_match?: OrgMatch;
  organization_confidence?: number | null;
  parsed_rows?: number;
  matched_rows?: Array<{ title?: string; indicator_name?: string; aggregate_action?: string }>;
  unknown_rows?: string[];
  unknown_row_details?: UnknownRowDetail[];
  ambiguous_rows?: string[];
  ambiguous_row_count?: number;
};

type ImportReport = {
  sheets?: Record<string, SheetReport>;
  summary?: Record<string, unknown>;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function pct(score: number | null | undefined): string {
  if (typeof score !== "number" || Number.isNaN(score)) return "—";
  return `${Math.round(score * 100)}%`;
}

function confidenceTone(reason?: string, confidence?: number | null): "ok" | "warn" | "bad" {
  if (reason === "exact" || reason === "override") return "ok";
  if (reason === "ambiguous" || reason === "low_confidence" || reason === "no_candidates") return "bad";
  if (typeof confidence === "number" && confidence >= 0.8) return "ok";
  if (typeof confidence === "number" && confidence >= 0.6) return "warn";
  return "bad";
}

function ConfidenceBadge({ reason, confidence }: { reason?: string; confidence?: number | null }) {
  const tone = confidenceTone(reason, confidence);
  const variant = tone === "ok" ? "default" : tone === "warn" ? "secondary" : "destructive";
  const label = reason ? reason.replace(/_/g, " ") : "match";
  return (
    <Badge variant={variant as "default" | "secondary" | "destructive"}>
      {label} · {pct(confidence)}
    </Badge>
  );
}

function Candidates({ items }: { items?: Candidate[] }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="mt-1 text-xs text-muted-foreground">
      Closest candidates:{" "}
      {items.slice(0, 3).map((c, i) => (
        <span key={`${c.label}-${i}`} className="mr-2 inline-block">
          {c.label} ({pct(c.score)})
        </span>
      ))}
    </div>
  );
}

export function WorkbookImportReview({ result }: { result: unknown }) {
  const resultRecord = asRecord(result);
  const report = (resultRecord?.aggregate_import_report ?? null) as ImportReport | null;
  const summary = asRecord(resultRecord?.aggregate_import_summary) ?? asRecord(report?.summary);
  const sheets = report?.sheets && typeof report.sheets === "object" ? report.sheets : null;
  if (!sheets) return null;

  const unresolved = Array.isArray(summary?.unresolved_sheet_names) ? (summary?.unresolved_sheet_names as string[]) : [];
  const ambiguousSheets = Array.isArray(summary?.ambiguous_sheet_names) ? (summary?.ambiguous_sheet_names as string[]) : [];
  const ambiguousRows = typeof summary?.ambiguous_rows === "number" ? (summary?.ambiguous_rows as number) : 0;
  const matchedRows = typeof summary?.matched_rows === "number" ? (summary?.matched_rows as number) : 0;
  const unknownRows = typeof summary?.unknown_rows === "number" ? (summary?.unknown_rows as number) : 0;
  const dryRun = summary?.dry_run === true;

  return (
    <div className="mt-3 space-y-3 rounded-md border border-border bg-muted/30 p-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-medium">Import review{dryRun ? " (dry run — nothing written)" : ""}:</span>
        <Badge variant="default">{matchedRows} matched</Badge>
        {unknownRows > 0 ? <Badge variant="secondary">{unknownRows} unknown</Badge> : null}
        {ambiguousRows > 0 ? <Badge variant="destructive">{ambiguousRows} ambiguous</Badge> : null}
      </div>

      {(unresolved.length > 0 || ambiguousSheets.length > 0) && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            {unresolved.length > 0 && (
              <div>
                Unresolved sheets (no aggregate written — add a sheet→organization override):{" "}
                <span className="font-medium">{unresolved.join(", ")}</span>
              </div>
            )}
            {ambiguousSheets.length > 0 && (
              <div>
                Ambiguous organization match (needs confirmation):{" "}
                <span className="font-medium">{ambiguousSheets.join(", ")}</span>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="space-y-3">
        {Object.entries(sheets).map(([sheetName, sheet]) => {
          const match = sheet.organization_match || {};
          const unknownDetails = Array.isArray(sheet.unknown_row_details) ? sheet.unknown_row_details : [];
          const ambRows = Array.isArray(sheet.ambiguous_rows) ? sheet.ambiguous_rows : [];
          return (
            <div key={sheetName} className="rounded-md border border-border p-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-medium">
                  Sheet “{sheetName}” →{" "}
                  {sheet.organization_name ? (
                    <span className="inline-flex items-center gap-1">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                      {sheet.organization_name}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-destructive">
                      <HelpCircle className="h-3.5 w-3.5" />
                      unresolved
                    </span>
                  )}
                </div>
                <ConfidenceBadge reason={match.reason} confidence={sheet.organization_confidence ?? match.confidence} />
              </div>
              {match.ambiguous || !sheet.organization_name ? <Candidates items={match.candidates} /> : null}

              <div className="mt-1 text-xs text-muted-foreground">
                {Array.isArray(sheet.matched_rows) ? sheet.matched_rows.length : 0} indicators matched
                {sheet.unknown_rows && sheet.unknown_rows.length > 0
                  ? ` · ${sheet.unknown_rows.length} unknown`
                  : ""}
                {ambRows.length > 0 ? ` · ${ambRows.length} ambiguous` : ""}
              </div>

              {unknownDetails.length > 0 && (
                <div className="mt-2 space-y-1">
                  <div className="text-xs font-medium">Unknown indicator rows (not written):</div>
                  {unknownDetails.slice(0, 12).map((row, i) => (
                    <div key={`${row.title}-${i}`} className="rounded border border-border/60 bg-background p-1.5 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate">{row.title}</span>
                        <ConfidenceBadge reason={row.reason} confidence={row.confidence} />
                      </div>
                      <Candidates items={row.candidates} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
