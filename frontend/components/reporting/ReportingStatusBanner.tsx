"use client";

/**
 * ReportingStatusBanner — Quarterly Reporting Control Framework (display only).
 *
 * Shows an organisation whether reporting for a given project + quarter is open,
 * scheduled, closed or in a late window, with coverage dates, the window dates,
 * a countdown and its own submission status. It is PURELY presentational: the
 * `canSubmit` flag it exposes (via `onStatus`) mirrors the backend decision, but
 * the backend independently re-checks every write, so this can never be used to
 * bypass a closed window — only to avoid showing enabled buttons that would 400.
 */
import { useCallback, useEffect, useState } from "react";
import { AlertCircle, CalendarClock, CheckCircle2, Clock, Lock } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  reportingPeriodsService,
  type ReportingStatus,
  type ReportingWindowState,
} from "@/lib/api/services/reportingPeriods";

interface Props {
  project: number | string;
  quarter?: number | string;
  fiscalYear?: number | string;
  periodStart?: string;
  periodEnd?: string;
  organization?: number | string;
  /** Notified whenever the status resolves, so a parent form can enable/disable
   * its submit / upload / data-entry buttons to match `can_submit`. */
  onStatus?: (status: ReportingStatus) => void;
  className?: string;
}

const STATE_META: Record<ReportingWindowState, { label: string; variant: "default" | "secondary" | "destructive" | "outline"; icon: React.ReactNode }> = {
  open: { label: "Open", variant: "default", icon: <CheckCircle2 className="h-4 w-4" /> },
  open_default: { label: "Open", variant: "default", icon: <CheckCircle2 className="h-4 w-4" /> },
  late: { label: "Late reporting", variant: "secondary", icon: <Clock className="h-4 w-4" /> },
  scheduled: { label: "Scheduled", variant: "outline", icon: <CalendarClock className="h-4 w-4" /> },
  draft: { label: "Not yet opened", variant: "outline", icon: <CalendarClock className="h-4 w-4" /> },
  not_elapsed: { label: "Quarter not finished", variant: "outline", icon: <CalendarClock className="h-4 w-4" /> },
  closed: { label: "Closed", variant: "destructive", icon: <Lock className="h-4 w-4" /> },
  archived: { label: "Archived", variant: "destructive", icon: <Lock className="h-4 w-4" /> },
};

function fmtDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
}

export function ReportingStatusBanner(props: Props) {
  const { project, quarter, fiscalYear, periodStart, periodEnd, organization, onStatus, className } = props;
  const [status, setStatus] = useState<ReportingStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await reportingPeriodsService.status({
        project,
        quarter,
        fiscal_year: fiscalYear,
        period_start: periodStart,
        period_end: periodEnd,
        organization,
      });
      setStatus(result);
      onStatus?.(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load reporting status.");
    } finally {
      setLoading(false);
    }
  }, [project, quarter, fiscalYear, periodStart, periodEnd, organization, onStatus]);

  useEffect(() => { void load(); }, [load]);

  if (loading) {
    return <div className={`h-16 animate-pulse rounded-md bg-muted ${className ?? ""}`} aria-hidden />;
  }
  if (error || !status) {
    return (
      <Alert variant="destructive" className={className}>
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Reporting status unavailable</AlertTitle>
        <AlertDescription>{error ?? "No status returned."}</AlertDescription>
      </Alert>
    );
  }

  const meta = STATE_META[status.state] ?? STATE_META.closed;
  const alertVariant = status.can_submit ? "default" : "destructive";
  const alreadySubmitted = status.submission?.has_submitted;

  return (
    <Alert variant={alertVariant} className={className}>
      {meta.icon}
      <AlertTitle className="flex items-center gap-2">
        {status.period_label}
        <Badge variant={meta.variant}>{meta.label}</Badge>
        {alreadySubmitted && <Badge variant="secondary">Submitted</Badge>}
        {status.is_late && <Badge variant="secondary">Late window</Badge>}
      </AlertTitle>
      <AlertDescription>
        <p>{status.message}</p>
        <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-muted-foreground">Quarter covers</dt>
            <dd>{fmtDate(status.period_start)} – {fmtDate(status.period_end)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Submission opens</dt>
            <dd>{fmtDate(status.submission_opens) === "—" ? fmtDate(status.earliest_open_date) : fmtDate(status.submission_opens)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Submission closes</dt>
            <dd>{fmtDate(status.submission_closes)}</dd>
          </div>
          {status.days_remaining != null && (
            <div>
              <dt className="text-muted-foreground">Days remaining</dt>
              <dd>{status.days_remaining}</dd>
            </div>
          )}
          {status.allow_late_reporting && (
            <div>
              <dt className="text-muted-foreground">Late reporting</dt>
              <dd>Enabled until {fmtDate(status.late_reporting_closes)}</dd>
            </div>
          )}
        </dl>
      </AlertDescription>
    </Alert>
  );
}

export default ReportingStatusBanner;
