"use client";

import { useState } from "react";
import {
  Activity,
  Copy,
  Download,
  ExternalLink,
  Loader2,
  RefreshCcw,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { systemService, type IssueStatus, type SystemIssue } from "@/lib/api";

const SEVERITY_TONE: Record<string, string> = {
  info: "bg-sky-600",
  warning: "bg-amber-500",
  problem: "bg-destructive",
  critical: "bg-destructive",
};

const STATUS_LABEL: Record<string, string> = {
  open: "Open",
  needs_review: "Needs review",
  reviewed: "Reviewed",
  resolved: "Resolved",
  ignored: "Ignored",
};

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}

export function SystemIssueDialog({
  issue: initialIssue,
  isOpen,
  onClose,
  onChanged,
}: {
  issue: SystemIssue | null;
  isOpen: boolean;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const { toast } = useToast();
  const [issue, setIssue] = useState<SystemIssue | null>(initialIssue);
  const [busy, setBusy] = useState<string | null>(null);

  // Keep local copy in sync when a different issue is opened.
  if (initialIssue && issue?.id !== initialIssue.id) setIssue(initialIssue);

  const current = issue ?? initialIssue;
  if (!current) return null;

  const m = current.metrics as Record<string, unknown>;
  const orgs = (current.detail?.affected_organizations ?? []) as Array<Record<string, unknown>>;
  const rows = (current.detail?.mismatch_rows ?? []) as Array<Record<string, unknown>>;
  const errorRows = (current.detail?.error_rows ?? []) as Array<Record<string, unknown>>;

  const act = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  };

  const onRerun = () =>
    act("rerun", async () => {
      try {
        const res = await systemService.rerunIssue(current.id);
        toast({
          title: res.ok ? "Check re-run complete" : "Check finished with errors",
          description: res.issue ? "The issue is still present — details refreshed." : "The issue has cleared.",
        });
        if (res.issue) setIssue(res.issue);
        onChanged?.();
        if (!res.issue) onClose();
      } catch (e) {
        toast({ variant: "destructive", title: "Re-run failed", description: e instanceof Error ? e.message : "" });
      }
    });

  const onAck = (status: IssueStatus) =>
    act(status, async () => {
      try {
        const updated = await systemService.ackIssue(current.id, status);
        setIssue(updated);
        toast({ title: `Marked ${STATUS_LABEL[status] ?? status}` });
        onChanged?.();
      } catch (e) {
        toast({ variant: "destructive", title: "Update failed", description: e instanceof Error ? e.message : "" });
      }
    });

  const onDownload = () =>
    act("download", async () => {
      try {
        await systemService.downloadIssueReport(current.id);
        toast({ title: "Report downloaded" });
      } catch (e) {
        toast({ variant: "destructive", title: "Download failed", description: e instanceof Error ? e.message : "" });
      }
    });

  const onCopy = () =>
    act("copy", async () => {
      const text = `${current.title}\n${current.technical_details}\n\n${JSON.stringify(current.evidence, null, 2)}`;
      await navigator.clipboard.writeText(text);
      toast({ title: "Technical details copied" });
    });

  return (
    <Dialog open={isOpen} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="max-h-[85vh] max-w-2xl overflow-y-auto"
        // Don't let Radix auto-focus a deep element (e.g. the "Technical details"
        // disclosure) on open — that scrolls the dialog past its own header.
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <div className="flex flex-wrap items-center gap-2">
            <Badge className={SEVERITY_TONE[current.severity] ?? "bg-muted-foreground"}>{current.severity}</Badge>
            <Badge variant="outline" className="font-mono text-[10px]">{current.issue_type}</Badge>
            <Badge variant="outline">{current.component.replaceAll("_", " ")}</Badge>
            <Badge variant="secondary">{current.environment === "training" ? "Sesigo Training Mode" : "Sesigo Live System"}</Badge>
            <Badge variant={current.status === "resolved" || current.status === "ignored" ? "secondary" : "outline"}>
              {STATUS_LABEL[current.status] ?? current.status}
            </Badge>
          </div>
          <DialogTitle className="pt-2">{current.title}</DialogTitle>
          <DialogDescription>{current.message}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <section>
            <p className="font-medium">What this means</p>
            <p className="text-muted-foreground">{current.explanation}</p>
          </section>

          {current.component === "parity_checks" ? (
            <section className="rounded-lg border p-3">
              <p className="mb-2 font-medium">Comparison</p>
              <Row label="Period" value={String(m.period ?? "—")} />
              <Row label="Project" value={String(m.project ?? "—")} />
              <Row label="Payloads compared" value={String(m.payloads_compared ?? "—")} />
              <Row label="Mismatches" value={String(m.payload_mismatches ?? "—")} />
              <Row label="Missing in database" value={String(m.missing_in_db ?? "—")} />
              <Row label="Missing in workbook" value={String(m.missing_in_workbook ?? "—")} />
              <Row label="Affected organizations" value={String(m.affected_organizations ?? "—")} />
              <Row label="Affected indicators" value={String(m.affected_indicators ?? "—")} />
              <Row label="Last check run" value={String(m.last_check_run ?? "—")} />
            </section>
          ) : null}

          {orgs.length ? (
            <section>
              <p className="mb-1 font-medium">Affected organizations</p>
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-left text-xs">
                  <thead className="text-muted-foreground">
                    <tr><th className="p-2">Org</th><th className="p-2">Mismatches</th><th className="p-2">Missing (DB)</th><th className="p-2">Missing (WB)</th></tr>
                  </thead>
                  <tbody>
                    {orgs.map((o, i) => (
                      <tr key={i} className="border-t">
                        <td className="p-2">{String(o.org ?? "")}</td>
                        <td className="p-2">{String(o.payload_mismatches ?? 0)}</td>
                        <td className="p-2">{String(o.missing_in_db ?? 0)}</td>
                        <td className="p-2">{String(o.missing_in_workbook ?? 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          {rows.length ? (
            <section>
              <p className="mb-1 font-medium">Records where values differ</p>
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-left text-xs">
                  <thead className="text-muted-foreground">
                    <tr><th className="p-2">Org</th><th className="p-2">Quarter</th><th className="p-2">Indicator</th></tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i} className="border-t">
                        <td className="p-2">{String(r.org ?? "")}</td>
                        <td className="p-2">{String(r.quarter ?? "")}</td>
                        <td className="p-2">{String(r.indicator_name ?? r.indicator_id ?? "")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          {errorRows.length ? (
            <section>
              <p className="mb-1 font-medium">Rejected rows ({errorRows.length})</p>
              <div className="max-h-48 overflow-auto rounded-lg border bg-muted/40 p-2">
                {errorRows.slice(0, 50).map((r, i) => (
                  <pre key={i} className="whitespace-pre-wrap break-words text-[11px] text-muted-foreground">{JSON.stringify(r)}</pre>
                ))}
              </div>
            </section>
          ) : null}

          <section>
            <p className="mb-1 font-medium">Recommended fix</p>
            <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
              {current.recommended_fix.map((s, i) => <li key={i}>{s}</li>)}
            </ol>
          </section>

          <details className="rounded-lg border p-3">
            <summary className="cursor-pointer font-medium">Technical details</summary>
            <p className="mt-2 break-words text-xs text-muted-foreground">{current.technical_details}</p>
          </details>

          {current.note ? (
            <p className="text-xs text-muted-foreground">Note: {current.note}{current.acknowledged_by ? ` — ${current.acknowledged_by}` : ""}</p>
          ) : null}

          <Separator />
          <div className="flex flex-wrap gap-2">
            {current.rerunnable ? (
              <Button size="sm" variant="outline" onClick={() => void onRerun()} disabled={busy !== null}>
                {busy === "rerun" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCcw className="mr-2 h-4 w-4" />}
                Re-run check
              </Button>
            ) : null}
            {current.links.download_csv ? (
              <Button size="sm" variant="outline" onClick={() => void onDownload()} disabled={busy !== null}>
                <Download className="mr-2 h-4 w-4" />Download report
              </Button>
            ) : null}
            {current.related_import_job_id ? (
              <Button size="sm" variant="outline" asChild>
                <Link href="/uploads/imports"><ExternalLink className="mr-2 h-4 w-4" />Open import job</Link>
              </Button>
            ) : null}
            {current.related_upload_id && !current.related_import_job_id ? (
              <Button size="sm" variant="outline" asChild>
                <Link href="/uploads"><ExternalLink className="mr-2 h-4 w-4" />Open upload</Link>
              </Button>
            ) : null}
            {current.related_module ? (
              <Button size="sm" variant="outline" asChild>
                <Link href={current.related_module}><ExternalLink className="mr-2 h-4 w-4" />Open module</Link>
              </Button>
            ) : null}
            <Button size="sm" variant="outline" onClick={() => void onCopy()} disabled={busy !== null}>
              <Copy className="mr-2 h-4 w-4" />Copy details
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void onAck("reviewed")} disabled={busy !== null}>
              <Activity className="mr-2 h-4 w-4" />Mark reviewed
            </Button>
            <Button size="sm" onClick={() => void onAck("resolved")} disabled={busy !== null}>
              <ShieldCheck className="mr-2 h-4 w-4" />Mark resolved
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
