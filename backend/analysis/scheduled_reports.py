"""Scheduled report execution engine.

``ScheduledReport`` previously stored ``next_run`` but nothing ever ran it — a
configured schedule silently never fired. This engine, driven by the
``run_scheduled_reports`` management command on cron, closes that gap:

  * finds active schedules whose ``next_run`` is due,
  * generates the report rows (scoped to the schedule's creator + environment,
    approved data only — the same rules the interactive report uses),
  * emails a CSV to the recipients,
  * records success/failure with a retry policy (a transient failure is retried
    on the next tick up to ``MAX_RETRIES`` before ``next_run`` is advanced), and
  * writes an audit event for every run.

Environment isolation: a schedule carries ``mode`` (live/training); rows are
filtered to that environment, so a training schedule can never email live data.
"""
from __future__ import annotations

import csv
import io
import logging

from django.core.mail import EmailMessage
from django.utils import timezone

from aggregates.models import Aggregate
from audit.recording import record_audit_event

from .models import Report, ScheduledReport

logger = logging.getLogger(__name__)

MAX_RETRIES = 3


def _next_run_after(now, frequency: str):
    delta = {
        "daily": timezone.timedelta(days=1),
        "weekly": timezone.timedelta(days=7),
        "monthly": timezone.timedelta(days=30),
        "quarterly": timezone.timedelta(days=90),
    }.get(frequency, timezone.timedelta(days=7))
    return now + delta


def due_schedules(now=None):
    """Active schedules whose next_run has passed."""
    now = now or timezone.now()
    return ScheduledReport.objects.filter(is_active=True, next_run__lte=now).order_by("next_run")


def generate_rows(schedule: ScheduledReport) -> list[dict]:
    """Build report rows for a schedule — scoped to creator + environment, approved
    only. Mirrors the interactive ``ReportViewSet.generate`` rules without a request."""
    from analysis.views import _canonical_indicator_resolver, _extract_total
    from organizations.access import get_user_organization_ids, is_organization_admin

    params = schedule.parameters or {}
    qs = Aggregate.objects.filter(status="approved")
    # Environment isolation by the schedule's mode (never request-derived).
    qs = qs.filter(project__is_training=(schedule.mode == "training"))

    if params.get("project_id") or params.get("project"):
        qs = qs.filter(project_id=params.get("project_id") or params.get("project"))
    if params.get("organization_id") or params.get("organization"):
        qs = qs.filter(organization_id=params.get("organization_id") or params.get("organization"))
    inds = params.get("indicator_ids") or params.get("indicators") or []
    if inds:
        qs = qs.filter(indicator_id__in=inds)
    if params.get("date_from"):
        qs = qs.filter(period_start__gte=params["date_from"])
    if params.get("date_to"):
        qs = qs.filter(period_end__lte=params["date_to"])

    # Creator scope (non-admin only sees their own org subtree).
    creator = schedule.created_by
    if creator is not None and not is_organization_admin(creator):
        org_ids = get_user_organization_ids(creator)
        qs = qs.filter(organization_id__in=org_ids) if org_ids else qs.none()

    canon_id_for, canon_meta_for = _canonical_indicator_resolver()
    totals: dict = {}
    for agg in qs.select_related("indicator"):
        canon = canon_id_for(agg.indicator_id)
        meta = canon_meta_for(canon)
        row = totals.setdefault(canon, {
            "indicator_id": canon, "indicator_code": meta["indicator_code"],
            "indicator_name": meta["indicator_name"], "total_value": 0.0, "entries": 0,
        })
        row["total_value"] += _extract_total(agg.value)
        row["entries"] += 1
    return sorted(totals.values(), key=lambda r: r["total_value"], reverse=True)


def _rows_to_csv(rows: list[dict]) -> bytes:
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["Indicator ID", "Indicator Code", "Indicator Name", "Total Value", "Entries"])
    for r in rows:
        writer.writerow([r["indicator_id"], r["indicator_code"], r["indicator_name"],
                         r["total_value"], r["entries"]])
    return buf.getvalue().encode("utf-8")


def deliver(schedule: ScheduledReport, rows: list[dict]) -> int:
    """Email the report CSV to recipients. Returns the number of recipients."""
    recipients = [str(r).strip() for r in (schedule.recipients or []) if str(r).strip()]
    if not recipients:
        return 0
    env = "TRAINING" if schedule.mode == "training" else "LIVE"
    subject = f"[SESIGO {env}] Scheduled report: {schedule.report_name}"
    body = (
        f"Scheduled report '{schedule.report_name}' ({schedule.frequency}) generated "
        f"{timezone.now():%Y-%m-%d %H:%M %Z}.\n\n{len(rows)} indicator rows attached as CSV.\n"
    )
    email = EmailMessage(subject=subject, body=body, to=recipients)
    email.attach(f"{schedule.report_name}.csv", _rows_to_csv(rows), "text/csv")
    email.send(fail_silently=False)
    return len(recipients)


def run_one(schedule: ScheduledReport, now=None) -> dict:
    """Execute one schedule with retry + audit. Returns an outcome dict."""
    now = now or timezone.now()
    try:
        rows = generate_rows(schedule)
        # Persist a Report snapshot so the result is downloadable in-app too.
        Report.objects.update_or_create(
            name=f"[Scheduled] {schedule.report_name}", mode=schedule.mode,
            defaults={
                "report_type": schedule.report_type, "parameters": schedule.parameters,
                "cached_data": rows, "last_generated": now, "created_by": schedule.created_by,
            },
        )
        delivered = deliver(schedule, rows)
        schedule.last_run = now
        schedule.last_status = "success"
        schedule.last_error = ""
        schedule.consecutive_failures = 0
        schedule.next_run = _next_run_after(now, schedule.frequency)
        schedule.save(update_fields=["last_run", "last_status", "last_error",
                                     "consecutive_failures", "next_run", "updated_at"])
        record_audit_event(
            action="generate", actor=schedule.created_by, object_type="scheduled_report",
            object_id=schedule.id,
            description=f"Scheduled report '{schedule.report_name}' ran ({len(rows)} rows, {delivered} recipients).",
            metadata={"frequency": schedule.frequency, "mode": schedule.mode,
                      "rows": len(rows), "recipients": delivered},
        )
        return {"id": schedule.id, "status": "success", "rows": len(rows), "recipients": delivered}
    except Exception as exc:  # transient (SMTP) or logic — retry, then back off
        schedule.consecutive_failures = (schedule.consecutive_failures or 0) + 1
        schedule.last_status = "failed"
        schedule.last_error = f"{type(exc).__name__}: {exc}"[:2000]
        retrying = schedule.consecutive_failures < MAX_RETRIES
        if not retrying:
            # Give up for this period; advance so we don't loop forever.
            schedule.next_run = _next_run_after(now, schedule.frequency)
        schedule.save(update_fields=["consecutive_failures", "last_status", "last_error",
                                     "next_run", "updated_at"])
        logger.exception("Scheduled report %s failed (attempt %s)", schedule.id, schedule.consecutive_failures)
        record_audit_event(
            action="generate", actor=schedule.created_by, object_type="scheduled_report",
            object_id=schedule.id,
            description=f"Scheduled report '{schedule.report_name}' FAILED ({schedule.last_error}).",
            metadata={"attempt": schedule.consecutive_failures, "will_retry": retrying},
        )
        return {"id": schedule.id, "status": "failed", "error": schedule.last_error,
                "will_retry": retrying}


def run_due(now=None) -> dict:
    now = now or timezone.now()
    results = [run_one(s, now=now) for s in list(due_schedules(now))]
    return {
        "ran": len(results),
        "succeeded": sum(1 for r in results if r["status"] == "success"),
        "failed": sum(1 for r in results if r["status"] == "failed"),
        "results": results,
    }
