"""Turn raw health-check data into structured, actionable, clickable issues.

Each issue carries everything the System Status drill-down UI needs: a stable
id, severity, affected component, plain-language + technical explanations,
evidence, recommended fix steps, and (for parity) the mismatch detail rows.

Acknowledgement state (reviewed/resolved/ignored) is keyed by the issue id plus
a fingerprint of its evidence, so a resolved issue re-opens automatically if the
underlying problem changes.
"""
from __future__ import annotations

import hashlib
from datetime import timedelta

from django.apps import apps
from django.conf import settings
from django.utils import timezone

from core.status_views import _latest_file, _safe_read_json

# Severity ordering for "overall" computation.
_SEVERITY_RANK = {"info": 0, "warning": 1, "problem": 2, "critical": 3}
# Acks that clear an issue from the active/overall status.
_CLEARED = {"resolved", "ignored"}


def _fingerprint(*parts) -> str:
    return hashlib.sha256("|".join(str(p) for p in parts).encode()).hexdigest()[:16]


def _ack_for(issue_key: str, fingerprint: str):
    from .models import SystemIssueAck
    return (
        SystemIssueAck.objects.filter(issue_key=issue_key, fingerprint=fingerprint)
        .order_by("-updated_at")
        .first()
    )


def _apply_ack(issue: dict) -> dict:
    ack = _ack_for(issue["id"], issue["fingerprint"])
    if ack:
        issue["status"] = ack.status
        issue["acknowledged_by"] = ack.acknowledged_by_username
        issue["note"] = ack.note
    else:
        issue["status"] = "open"
        issue["acknowledged_by"] = None
        issue["note"] = ""
    return issue


def _links(issue_key: str, *, csv: bool = False) -> dict:
    base = f"/api/system/status/issues/{issue_key}/"
    links = {
        "details": base,
        "rerun": base + "rerun/",
        "ack": base + "ack/",
        "download_csv": (base + "download/") if csv else None,
    }
    return links


# --- parity -----------------------------------------------------------------

def _parity_report():
    parity_dir = settings.BASE_DIR / "reports" / "monthly_parity_checks"
    latest = _latest_file(parity_dir, "parity_*.json")
    if not latest:
        return None, None
    return latest, _safe_read_json(latest)


def _missing_in_db_csv_path(latest_file):
    """Path to the complete missing-in-db CSV next to a real parity report file,
    or ``None`` (e.g. in tests where the report file is a stub)."""
    from pathlib import Path as _Path
    if not isinstance(latest_file, _Path):
        return None
    candidate = latest_file.parent / "missing_in_db_latest.csv"
    return str(candidate) if candidate.exists() else None


def _parity_issue(parity_block: dict) -> dict | None:
    latest_file, report = _parity_report()
    if not isinstance(report, dict):
        return None
    summary = report.get("summary", {}) if isinstance(report.get("summary"), dict) else {}
    mismatches = int(summary.get("payload_mismatches") or 0)
    missing_db = int(summary.get("missing_in_db") or 0)
    missing_wb = int(summary.get("missing_in_workbook") or 0)
    difference = mismatches + missing_db + missing_wb
    if difference <= 0 and parity_block.get("status") == "ok":
        return None

    diff_rows = report.get("diff_sample", []) if isinstance(report.get("diff_sample"), list) else []
    affected_orgs = [
        {
            "org": o.get("org"),
            "workbook": (o.get("workbook") or "").split("/")[-1],
            "payload_mismatches": o.get("payload_mismatches", 0),
            "missing_in_db": o.get("missing_in_db", 0),
            "missing_in_workbook": o.get("missing_in_workbook", 0),
        }
        for o in report.get("orgs", [])
        if (o.get("payload_mismatches") or 0) or (o.get("missing_in_db") or 0) or (o.get("missing_in_workbook") or 0)
    ]
    affected_indicators = sorted(
        {(r.get("indicator_id"), r.get("indicator_name")) for r in diff_rows if r.get("indicator_id")},
        key=lambda t: (t[0] or 0),
    )
    project = report.get("project", {}) if isinstance(report.get("project"), dict) else {}
    period = (report.get("generated_at") or "")[:7] or "latest"
    generated = report.get("generated_at")

    org_names = ", ".join(o["org"] for o in affected_orgs) or "—"

    # Distinguish the three categories so admins are not told un-imported workbook
    # rows are "value mismatches" (which reads as corruption). Only an actual
    # ``payload_mismatch`` is a value disagreement; ``missing_in_db`` is a
    # completeness/data-loading gap and ``missing_in_workbook`` a traceability gap.
    # NB: the parity CALCULATION is untouched — only how the result is described.
    is_value_corruption = mismatches > 0
    if is_value_corruption:
        title = "Monthly payload parity mismatch"
        severity = "critical"
        headline_kind = "value mismatch"
    else:
        title = "Monthly payload parity completeness gap"
        severity = "warning"
        headline_kind = "completeness gap"

    message = (
        f"Monthly payload parity check found: "
        f"{mismatches} value mismatch{'' if mismatches == 1 else 'es'}, "
        f"{missing_db} workbook record{'' if missing_db == 1 else 's'} missing in the database, "
        f"{missing_wb} database record{'' if missing_wb == 1 else 's'} missing from the workbook "
        f"across {len(affected_orgs)} organization{'' if len(affected_orgs) == 1 else 's'}"
        f" ({org_names}). Click to review affected records."
    )
    fp = _fingerprint("parity", period, mismatches, missing_db, missing_wb,
                      tuple(sorted((r.get("org"), r.get("quarter"), r.get("indicator_id")) for r in diff_rows)))

    issue = {
        "id": "parity-latest",
        "issue_type": "PARITY_MISMATCH" if is_value_corruption else "PARITY_COMPLETENESS",
        "category": "consistency" if is_value_corruption else "completeness",
        "title": title,
        "severity": severity,
        "headline_kind": headline_kind,
        "component": "parity_checks",
        "environment": "live",
        "related_project_id": project.get("id"),
        "last_checked_at": generated,
        "message": message,
        "explanation": (
            "The nightly check compares the totals stored in the database against the "
            "figures in each organization's submitted reporting workbook. "
            + (
                "A VALUE MISMATCH means a number in the database differs from the workbook — "
                "investigate which side is correct."
                if is_value_corruption else
                "There are NO value mismatches: every value present on both sides matches exactly. "
                "The flagged records are present in the workbook but were never imported into the "
                "database — this is a data-loading backlog (a completeness gap), NOT value corruption."
            )
            + " It is a data-quality flag, not a system fault — the portal is fully operational."
        ),
        "technical_details": (
            f"parity report {latest_file.name if latest_file else '?'} for project "
            f"{project.get('id')} {project.get('code') or project.get('name') or '?'} "
            f"(generated {generated}): "
            f"payloads_compared={summary.get('payloads_compared')}, "
            f"value_mismatches={mismatches}, missing_in_db={missing_db}, "
            f"missing_in_workbook={missing_wb}, orgs_checked={summary.get('orgs_checked')}, "
            f"affected_orgs={len(affected_orgs)}, sample_indicators={len(affected_indicators)}. "
            + ("" if is_value_corruption else
               "This is a data-loading backlog (records present in the workbook but not yet imported), "
               "NOT value corruption.")
        ),
        "evidence": {
            "report_file": latest_file.name if latest_file else None,
            "generated_at": generated,
            "summary": summary,
            "diff_sample": diff_rows,
            # Path to the COMPLETE missing-in-db export (written by the parity
            # script next to its JSON), when present — the drill-down serves it.
            "missing_in_db_csv": _missing_in_db_csv_path(latest_file),
        },
        "metrics": {
            "period": period,
            "project": project.get("name"),
            "payloads_compared": int(summary.get("payloads_compared") or 0),
            "difference_count": difference,
            "payload_mismatches": mismatches,
            "missing_in_db": missing_db,
            "missing_in_workbook": missing_wb,
            "affected_organizations": len(affected_orgs),
            "affected_indicators": len(affected_indicators),
            "last_check_run": generated,
        },
        "detail": {
            "affected_organizations": affected_orgs,
            "affected_indicators": [{"id": i, "name": n} for i, n in affected_indicators],
            "mismatch_rows": diff_rows,
        },
        "recommended_fix": (
            [
                "Open the affected organization's reporting workbook and the matching records in the portal.",
                "Confirm whether the database value or the workbook value is correct.",
                "Correct the wrong side (re-import the workbook, or fix the aggregate in the portal).",
                "Re-run the parity check; if it still flags after a deliberate manual correction, mark the issue resolved.",
            ]
            if is_value_corruption else
            [
                "These records exist in the workbooks but were never imported — this is a data-loading "
                "backlog, not corrupted data.",
                "Download the missing-records CSV (link below) to see every affected org/indicator/quarter.",
                "Import the outstanding workbook data for the listed organizations, or confirm the rows "
                "are out of scope.",
                "Re-run the parity check; the completeness gap clears once the data is loaded.",
            ]
        ),
        "related_module": "/aggregates",
        "fingerprint": fp,
        "links": _links("parity-latest", csv=True),
    }
    return _apply_ack(issue)


# --- simple component issues ------------------------------------------------

def _component_issue(*, issue_id, issue_type, title, severity, component, message, explanation,
                     technical_details, evidence, recommended_fix, fingerprint,
                     related_module=None, environment="live", metrics=None, detail=None,
                     related=None, csv=False):
    issue = {
        "id": issue_id,
        "issue_type": issue_type,
        "title": title,
        "severity": severity,
        "component": component,
        "environment": environment,
        "message": message,
        "explanation": explanation,
        "technical_details": technical_details,
        "evidence": evidence,
        "metrics": metrics or {},
        "detail": detail or {},
        "recommended_fix": recommended_fix,
        "related_module": related_module,
        "fingerprint": fingerprint,
        "links": _links(issue_id, csv=csv),
    }
    issue.update(related or {})
    return _apply_ack(issue)


def _normalize(issue: dict) -> dict:
    """Ensure every issue carries the standard envelope fields."""
    issue.setdefault("issue_type", "GENERIC")
    issue.setdefault("environment", "live")
    for key in ("related_upload_id", "related_import_job_id", "related_project_id",
                "related_period_start", "related_period_end", "related_module"):
        issue.setdefault(key, None)
    now = timezone.now().isoformat()
    issue.setdefault("last_checked_at", now)
    issue.setdefault("created_at", issue.get("last_checked_at") or now)
    # Only standing checks can be re-run on demand; per-import events cannot.
    issue["rerunnable"] = issue.get("id") in {"parity-latest", "backup-health"}
    if not issue["rerunnable"]:
        issue["links"]["rerun"] = None
    return issue


# --- IMP-1 import / upload issues -------------------------------------------

def _import_environment(obj) -> str:
    """Best-effort live/training for an upload or import job via its project."""
    project = getattr(obj, "project", None)
    if project is not None and getattr(project, "is_training", False):
        return "training"
    return "live"


def _import_issues(request=None) -> list:
    """Surface recent (14d) aggregate-import problems from ImportJob/Upload.

    Read defensively: if the IMP-1 fields/summary are not present the builder
    simply produces nothing rather than failing.
    """
    issues = []
    try:
        ImportJob = apps.get_model("uploads.ImportJob")
    except LookupError:
        return issues

    cutoff = timezone.now() - timedelta(days=14)
    try:
        jobs = list(ImportJob.objects.filter(created_at__gte=cutoff).order_by("-created_at")[:25])
    except Exception:
        return issues

    for job in jobs:
        result = job.result if isinstance(getattr(job, "result", None), dict) else {}
        errors = job.errors if isinstance(getattr(job, "errors", None), list) else []
        upload = getattr(job, "upload", None)
        env = _import_environment(job)
        related = {
            "related_import_job_id": job.id,
            "related_upload_id": getattr(upload, "id", None),
        }
        name = getattr(upload, "name", None) or f"import {job.id}"
        ts = job.created_at.isoformat() if getattr(job, "created_at", None) else None

        # B. rejected rows
        rejected = int(result.get("failed") or result.get("rejected") or 0)
        if (job.status == "failed" or rejected or errors) and (rejected or errors or job.status == "failed"):
            n = rejected or len(errors)
            issues.append(_normalize(_component_issue(
                issue_id=f"import-rejected-{job.id}",
                issue_type="IMPORT_REJECTED_ROWS",
                title="Workbook import had rejected rows",
                severity="warning",
                component="imports",
                environment=env,
                message=f"Import of '{name}' rejected {n or 'some'} row(s). Click to review.",
                explanation="Some rows in the workbook could not be imported. Those figures are missing until corrected and re-uploaded.",
                technical_details=f"import job {job.id} status={job.status}, rejected={n}.",
                evidence={"errors": errors[:50], "result": result},
                metrics={"rejected_rows": n},
                detail={"error_rows": errors[:200]},
                recommended_fix=[
                    "Open the import job and review the rejected rows and reasons.",
                    "Correct the workbook (indicator names, periods, values).",
                    "Re-upload using dry-run first to confirm, then import.",
                ],
                related_module="/uploads/imports",
                related={**related, "last_checked_at": ts, "created_at": ts},
                fingerprint=_fingerprint("import-rejected", job.id, n),
                csv=True,
            )))

        # C. reset from review
        reset = int(result.get("reset_from_review") or 0)
        if reset > 0:
            inds = result.get("reset_from_review_indicators") or []
            issues.append(_normalize(_component_issue(
                issue_id=f"reset-review-{job.id}",
                issue_type="RESET_FROM_REVIEW",
                title="Reviewed/approved records re-opened",
                severity="warning",
                component="aggregates",
                environment=env,
                message=f"A corrected upload re-opened {reset} reviewed/approved record(s) in '{name}'. Reviewers must re-check.",
                explanation="A changed re-upload modified records that had already been reviewed or approved, so they were reset to pending for another review.",
                technical_details=f"import job {job.id} reset_from_review={reset}.",
                evidence={"reset_from_review_indicators": inds, "result": result},
                metrics={"records_reset": reset, "previous_status": "approved/reviewed", "new_status": "pending"},
                detail={"affected_indicators": [{"id": None, "name": i} for i in inds]},
                recommended_fix=[
                    "Notify the reviewers for the affected organization.",
                    "Review the re-opened records and confirm the corrected values.",
                    "Approve again after validation.",
                ],
                related_module="/aggregates",
                related={**related, "last_checked_at": ts, "created_at": ts},
                fingerprint=_fingerprint("reset-review", job.id, reset),
            )))

        # D. duplicate indicators in payload
        dups = result.get("duplicate_indicators_in_payload") or []
        if dups:
            issues.append(_normalize(_component_issue(
                issue_id=f"dup-indicators-{job.id}",
                issue_type="DUPLICATE_INDICATORS_IN_PAYLOAD",
                title="Duplicate indicators in upload",
                severity="warning",
                component="imports",
                environment=env,
                message=f"'{name}' listed {len(dups)} indicator(s) more than once; only the last value was kept.",
                explanation="The same indicator appeared multiple times in one upload. The system kept the last value, which may not be what you intended.",
                technical_details=f"import job {job.id} duplicate_indicators={dups}.",
                evidence={"duplicate_indicators": dups, "result": result},
                detail={"duplicate_indicators": dups},
                recommended_fix=[
                    "Remove the duplicate indicator rows from the workbook.",
                    "Re-upload after correction.",
                ],
                related_module="/uploads/imports",
                related={**related, "last_checked_at": ts, "created_at": ts},
                fingerprint=_fingerprint("dup-indicators", job.id, tuple(sorted(map(str, dups)))),
            )))

        # E. all unchanged (info)
        created = int(result.get("created") or 0)
        updated = int(result.get("updated") or 0)
        unchanged = int(result.get("unchanged") or 0)
        if created == 0 and updated == 0 and reset == 0 and unchanged > 0:
            issues.append(_normalize(_component_issue(
                issue_id=f"import-unchanged-{job.id}",
                issue_type="IMPORT_ALL_UNCHANGED",
                title="Workbook already imported (no changes)",
                severity="info",
                component="imports",
                environment=env,
                message=f"'{name}' was already imported — {unchanged} record(s) unchanged, nothing new.",
                explanation="This workbook matches data already in the system. No records were created or changed. This is informational, not a problem.",
                technical_details=f"import job {job.id} unchanged={unchanged}.",
                evidence={"result": result},
                metrics={"unchanged": unchanged},
                recommended_fix=["No action needed. If you expected changes, confirm you uploaded the corrected workbook."],
                related_module="/uploads/imports",
                related={**related, "last_checked_at": ts, "created_at": ts},
                fingerprint=_fingerprint("import-unchanged", job.id, unchanged),
            )))

    # A. duplicate file uploaded
    try:
        Upload = apps.get_model("uploads.Upload")
        uploads = list(Upload.objects.filter(created_at__gte=cutoff).exclude(file_hash="").order_by("-created_at")[:25])
    except Exception:
        uploads = []
    for up in uploads:
        try:
            prior = up.prior_imported_upload()
        except Exception:
            prior = None
        if not prior or prior.id == up.id:
            continue
        env = _import_environment(up)
        ts = up.created_at.isoformat() if getattr(up, "created_at", None) else None
        issues.append(_normalize(_component_issue(
            issue_id=f"dup-file-{up.id}",
            issue_type="DUPLICATE_FILE_UPLOADED",
            title="Duplicate file uploaded",
            severity="info",
            component="uploads",
            environment=env,
            message=f"'{up.name}' has the same fingerprint as a previously imported file. Click to compare.",
            explanation="This file appears to have been uploaded before — the system detected the same SHA-256 file fingerprint.",
            technical_details=f"upload {up.id} file_hash={up.file_hash} matches prior upload {prior.id}.",
            evidence={"file_hash": up.file_hash, "current_upload": up.id, "previous_upload": prior.id,
                      "previous_upload_name": getattr(prior, "name", None)},
            metrics={"current_upload_id": up.id, "previous_upload_id": prior.id,
                     "previous_upload_name": getattr(prior, "name", None)},
            recommended_fix=[
                "If this re-upload was intentional, no action is required.",
                "If you expected changes, confirm you uploaded the correct workbook.",
                "Open the previous upload to compare.",
            ],
            related_module="/uploads",
            related={"related_upload_id": up.id, "last_checked_at": ts, "created_at": ts},
            fingerprint=_fingerprint("dup-file", up.id, prior.id),
        )))

    return issues


def build_issues(payload: dict, request=None) -> list:
    issues = []

    parity_block = payload.get("parity", {}) or {}
    if parity_block.get("status") in {"warning", "error", "missing"}:
        parity = _parity_issue(parity_block)
        if parity:
            issues.append(_normalize(parity))

    backup = payload.get("backup", {}) or {}
    if backup.get("status") in {"warning", "error", "missing"}:
        manifest = backup.get("manifest") or {}
        issues.append(_normalize(_component_issue(
            issue_id="backup-health",
            issue_type="BACKUP_HEALTH",
            title="Database backup needs attention",
            severity="problem" if backup["status"] in {"error", "missing"} else "warning",
            component="backups",
            message=(
                "Latest database backup is missing." if backup["status"] == "missing"
                else "Latest database backup is stale or unverified. Click for details."
            ),
            explanation="Nightly backups protect against data loss. This flag means the most recent backup is missing, old, or failed verification.",
            technical_details=f"backup status={backup['status']}, age_hours={backup.get('age_hours')}, verify_status={manifest.get('verify_status')}.",
            evidence={"manifest": manifest, "age_hours": backup.get("age_hours")},
            recommended_fix=[
                "Open System Status → Backups and click 'Generate backup now'.",
                "Confirm the new backup verifies (pg_restore_list_ok) and download it.",
                "Check the nightly backup cron and off-site replication.",
            ],
            fingerprint=_fingerprint("backup", backup["status"], manifest.get("created_at_utc")),
        )))

    disk = payload.get("disk", {}) or {}
    if disk.get("status") in {"warning", "error"}:
        issues.append(_normalize(_component_issue(
            issue_id="disk-usage",
            issue_type="DISK_USAGE",
            title="Server disk usage high",
            severity="problem" if disk["status"] == "error" else "warning",
            component="disk",
            message=f"Server disk is {disk.get('used_percent')}% full. Click for details.",
            explanation="When the disk fills up, backups, imports and uploads can fail. Free space before it reaches 100%.",
            technical_details=f"path={disk.get('path')}, used={disk.get('used_percent')}%, free_bytes={disk.get('free_bytes')}.",
            evidence={"disk": disk},
            recommended_fix=[
                "Reclaim space: prune docker build cache/images and vacuum journald logs (see docs/server disk cleanup).",
                "Remove or off-load old backups and exports.",
            ],
            fingerprint=_fingerprint("disk", int(disk.get("used_percent") or 0)),
        )))

    db = payload.get("database", {}) or {}
    if db.get("status") == "error":
        issues.append(_normalize(_component_issue(
            issue_id="database-health",
            issue_type="DATABASE_HEALTH",
            title="Database health check failed",
            severity="critical",
            component="database",
            message="The database health check failed. Click for details.",
            explanation="The portal could not run a basic query against the database. This is the most serious class of issue.",
            technical_details=f"database engine={db.get('engine')}, name={db.get('name')}, status={db.get('status')}.",
            evidence={"database": db},
            recommended_fix=[
                "Check the database container/service is running and reachable.",
                "Inspect backend logs for connection errors.",
            ],
            fingerprint=_fingerprint("database", db.get("status")),
        )))

    import_jobs = payload.get("import_jobs", {}) or {}
    failed = int(import_jobs.get("failed") or 0)
    if failed > 0:
        issues.append(_normalize(_component_issue(
            issue_id="imports-failed",
            issue_type="IMPORT_JOB_FAILED",
            title="Failed import jobs",
            severity="warning",
            component="imports",
            message=f"{failed} import job{'s' if failed != 1 else ''} failed. Click to review.",
            explanation="One or more workbook imports did not complete. Affected data may be missing until they are re-run.",
            technical_details=f"import_jobs={import_jobs}.",
            evidence={"import_jobs": import_jobs},
            recommended_fix=[
                "Open Uploads → Imports and inspect the failed jobs.",
                "Fix the source workbook issue and re-run the import.",
            ],
            fingerprint=_fingerprint("imports", failed),
            related_module="/uploads/imports",
        )))

    # IMP-1 aggregate import/upload issues (recent, defensive).
    issues.extend(_import_issues(request))

    return issues


def find_issue(issue_id: str, request=None):
    from core.status_views import collect_status_payload
    payload = collect_status_payload(request)
    for issue in build_issues(payload, request):
        if issue["id"] == issue_id:
            return issue
    return None


def overall_from_issues(issues: list, fallback: str) -> str:
    active = [i for i in issues if i.get("status") not in _CLEARED]
    if not active:
        return "ok"
    top = max(_SEVERITY_RANK.get(i["severity"], 0) for i in active)
    if top >= _SEVERITY_RANK["problem"]:
        return "error"
    if top >= _SEVERITY_RANK["warning"]:
        return "warning"
    return "ok"


def parity_csv_rows(issue: dict):
    """Header + rows for the parity CSV download.

    Prefers the COMPLETE ``missing_in_db_latest.csv`` written by the parity script
    (every missing record, not the 40-row JSON sample) when the issue references
    it; otherwise falls back to the in-report diff sample.
    """
    import csv as _csv
    from pathlib import Path as _Path

    full_csv = (issue.get("evidence", {}) or {}).get("missing_in_db_csv")
    if full_csv and _Path(full_csv).exists():
        try:
            with open(full_csv, newline="", encoding="utf-8") as fh:
                reader = list(_csv.reader(fh))
            if reader:
                return reader[0], reader[1:]
        except OSError:
            pass

    rows = issue.get("detail", {}).get("mismatch_rows", []) or issue.get("evidence", {}).get("diff_sample", [])
    header = ["organization", "quarter", "indicator_id", "indicator_name", "type"]
    body = [
        [r.get("org"), r.get("quarter"), r.get("indicator_id"), r.get("indicator_name"), r.get("type")]
        for r in rows
    ]
    return header, body


def issue_csv_rows(issue: dict):
    """Header + rows for any downloadable issue (parity, rejected import rows)."""
    if issue.get("component") == "parity_checks":
        return parity_csv_rows(issue)
    error_rows = issue.get("detail", {}).get("error_rows") or issue.get("evidence", {}).get("errors") or []
    if error_rows and isinstance(error_rows[0], dict):
        keys = list({k for row in error_rows for k in row.keys()})
        return keys, [[row.get(k) for k in keys] for row in error_rows]
    return ["row"], [[str(r)] for r in error_rows]


def issue_has_download(issue: dict) -> bool:
    if issue.get("component") == "parity_checks":
        return True
    return bool(issue.get("detail", {}).get("error_rows") or issue.get("evidence", {}).get("errors"))
