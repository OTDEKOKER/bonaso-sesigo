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
import json

from django.conf import settings

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
    message = (
        f"Monthly payload parity check found {difference} "
        f"mismatch{'es' if difference != 1 else ''} "
        f"across {len(affected_orgs)} organization{'s' if len(affected_orgs) != 1 else ''}"
        f" ({org_names}). Click to review affected records."
    )
    fp = _fingerprint("parity", period, mismatches, missing_db, missing_wb,
                      tuple(sorted((r.get("org"), r.get("quarter"), r.get("indicator_id")) for r in diff_rows)))

    issue = {
        "id": "parity-latest",
        "title": "Monthly payload parity mismatch",
        "severity": "warning",
        "component": "parity_checks",
        "environment": "live",
        "message": message,
        "explanation": (
            "The nightly check compares the totals stored in the database against the "
            "figures in each organization's submitted reporting workbook. A mismatch means "
            "a value in the database differs from the workbook (or is present on only one "
            "side). It is a data-quality flag, not a system fault — the portal is fully "
            "operational."
        ),
        "technical_details": (
            f"parity report {latest_file.name if latest_file else '?'} for project "
            f"{project.get('code') or project.get('name') or '?'}: "
            f"payloads_compared={summary.get('payloads_compared')}, "
            f"payload_mismatches={mismatches}, missing_in_db={missing_db}, "
            f"missing_in_workbook={missing_wb}, orgs_checked={summary.get('orgs_checked')}."
        ),
        "evidence": {
            "report_file": latest_file.name if latest_file else None,
            "generated_at": generated,
            "summary": summary,
            "diff_sample": diff_rows,
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
        "recommended_fix": [
            "Open the affected organization's reporting workbook and the matching records in the portal.",
            "Confirm whether the database value or the workbook value is correct.",
            "Correct the wrong side (re-import the workbook, or fix the aggregate in the portal).",
            "Re-run the parity check; if it still flags after a deliberate manual correction, mark the issue resolved.",
        ],
        "related_module": "/aggregates",
        "fingerprint": fp,
        "links": _links("parity-latest", csv=True),
    }
    return _apply_ack(issue)


# --- simple component issues ------------------------------------------------

def _component_issue(*, issue_id, title, severity, component, message, explanation,
                     technical_details, evidence, recommended_fix, fingerprint,
                     related_module=None):
    issue = {
        "id": issue_id,
        "title": title,
        "severity": severity,
        "component": component,
        "environment": "live",
        "message": message,
        "explanation": explanation,
        "technical_details": technical_details,
        "evidence": evidence,
        "metrics": {},
        "detail": {},
        "recommended_fix": recommended_fix,
        "related_module": related_module,
        "fingerprint": fingerprint,
        "links": _links(issue_id),
    }
    return _apply_ack(issue)


def build_issues(payload: dict, request=None) -> list:
    issues = []

    parity_block = payload.get("parity", {}) or {}
    if parity_block.get("status") in {"warning", "error", "missing"}:
        parity = _parity_issue(parity_block)
        if parity:
            issues.append(parity)

    backup = payload.get("backup", {}) or {}
    if backup.get("status") in {"warning", "error", "missing"}:
        manifest = backup.get("manifest") or {}
        issues.append(_component_issue(
            issue_id="backup-health",
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
        ))

    disk = payload.get("disk", {}) or {}
    if disk.get("status") in {"warning", "error"}:
        issues.append(_component_issue(
            issue_id="disk-usage",
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
        ))

    db = payload.get("database", {}) or {}
    if db.get("status") == "error":
        issues.append(_component_issue(
            issue_id="database-health",
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
        ))

    import_jobs = payload.get("import_jobs", {}) or {}
    failed = int(import_jobs.get("failed") or 0)
    if failed > 0:
        issues.append(_component_issue(
            issue_id="imports-failed",
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
        ))

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
    """Header + rows for the parity mismatch CSV download."""
    rows = issue.get("detail", {}).get("mismatch_rows", []) or issue.get("evidence", {}).get("diff_sample", [])
    header = ["organization", "quarter", "indicator_id", "indicator_name", "type"]
    body = [
        [r.get("org"), r.get("quarter"), r.get("indicator_id"), r.get("indicator_name"), r.get("type")]
        for r in rows
    ]
    return header, body
