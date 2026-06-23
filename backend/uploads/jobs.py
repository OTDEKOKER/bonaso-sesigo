import json
import os
import re
import subprocess
import sys
from pathlib import Path

from django.conf import settings
from django.contrib.auth import get_user_model
from django.http import QueryDict
from django.utils import timezone
from rest_framework.test import APIRequestFactory, force_authenticate

from aggregates.views import AggregateViewSet
from .models import ExportJob, ImportJob


REPORT_WORKBOOK_IMPORT_SCRIPT = "import_selected_q3_workbook.py"


def resolve_report_workbook_import_script():
    candidates = [
        Path(settings.BASE_DIR) / "workbook-imports" / REPORT_WORKBOOK_IMPORT_SCRIPT,
        Path(settings.BASE_DIR).parent / "frontend" / "scripts" / REPORT_WORKBOOK_IMPORT_SCRIPT,
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return candidates[0]


def run_aggregate_review_import_job(job_id):
    job = ImportJob.objects.select_related("upload").get(id=job_id)
    job.status = "processing"
    job.started_at = job.started_at or timezone.now()
    job.errors = []
    job.save(update_fields=["status", "started_at", "errors"])

    params = job.parameters or {}
    upload = job.upload
    dry_run = bool(params.get("dry_run"))
    report_path = Path(params["report_path"])
    report_path.parent.mkdir(parents=True, exist_ok=True)

    command = [
        sys.executable,
        str(resolve_report_workbook_import_script()),
        "--workbook",
        upload.file.path,
        "--project-id",
        str(params["project_id"]),
        "--period-start",
        str(params["period_start"]),
        "--period-end",
        str(params["period_end"]),
        "--report-path",
        str(report_path),
        "--sheets",
        *[str(sheet_name) for sheet_name in params.get("sheet_names", [])],
    ]
    if dry_run:
        command.append("--dry-run")
    if params.get("indicator_overrides_path"):
        command.extend(["--indicator-overrides-path", str(params["indicator_overrides_path"])])
    if params.get("sheet_org_overrides_path"):
        command.extend(["--sheet-org-overrides-path", str(params["sheet_org_overrides_path"])])

    env = os.environ.copy()
    env["BONASO_DJANGO_ROOT"] = str(settings.BASE_DIR)

    try:
        subprocess.run(
            command,
            cwd=str(settings.BASE_DIR),
            env=env,
            check=True,
            capture_output=True,
            text=True,
        )
    except subprocess.CalledProcessError as exc:
        error_message = (exc.stderr or exc.stdout or str(exc)).strip()
        unresolved_sheet_names = []
        unresolved_match = re.search(
            r"Organizations not found for sheets:\s*(.+)$",
            error_message,
            flags=re.IGNORECASE | re.MULTILINE,
        )
        if unresolved_match:
            unresolved_sheet_names = [
                item.strip()
                for item in unresolved_match.group(1).split(",")
                if item.strip()
            ]

        job.status = "failed"
        job.completed_at = timezone.now()
        job.errors = [
            {
                "error": "aggregate import failed",
                "details": error_message,
                "unresolved_sheet_names": unresolved_sheet_names,
            }
        ]
        job.result = {
            "aggregate_review_queued": False,
            "dry_run": dry_run,
            "unresolved_sheet_names": unresolved_sheet_names,
        }
        job.save(update_fields=["status", "completed_at", "errors", "result"])
        return job

    summary = {}
    report_payload = {}
    try:
        if report_path.exists():
            report_payload = json.loads(report_path.read_text(encoding="utf-8"))
            summary = report_payload.get("summary", {})
    except Exception as exc:
        report_payload = {"error": f"Unable to read import report: {exc}"}
        summary = {}

    matched_rows = int(summary.get("matched_rows", 0) or 0)
    unknown_rows = int(summary.get("unknown_rows", 0) or 0)
    total_rows = matched_rows + unknown_rows

    job.status = "validated" if dry_run else "imported"
    job.total_rows = total_rows
    job.processed_rows = matched_rows
    job.successful_rows = matched_rows
    job.failed_rows = unknown_rows
    job.completed_at = timezone.now()
    job.errors = []
    job.output_file = str(report_path)
    job.result = {
        "aggregate_review_queued": not dry_run,
        "dry_run": dry_run,
        "aggregate_import_summary": summary,
        "aggregate_import_report": report_payload,
    }
    job.save(
        update_fields=[
            "status",
            "total_rows",
            "processed_rows",
            "successful_rows",
            "failed_rows",
            "completed_at",
            "errors",
            "output_file",
            "result",
        ]
    )

    # Close the legacy-import audit gap: the subprocess writes aggregates directly
    # (bypassing the viewset's _record_aggregate_change), so we record the audit
    # events here from its report. Dry-runs write nothing, so they are not audited.
    if not dry_run:
        _record_legacy_import_audit(job, report_payload)
    return job


def _record_legacy_import_audit(job, report_payload):
    """Emit one audit event per written aggregate (and per refused sheet) for a
    legacy/fuzzy workbook import. Best-effort — never raises into the job."""
    try:
        from audit.recording import record_audit_event
        from organizations.models import Organization
        from projects.models import Project

        sheets = (report_payload or {}).get("sheets") or {}
        summary = (report_payload or {}).get("summary") or {}
        project_info = (report_payload or {}).get("project") or {}
        project = Project.objects.filter(id=project_info.get("id")).first()
        actor = job.created_by

        # Batch-load organizations referenced by matched rows.
        org_ids = {
            row.get("organization_id")
            for sheet in sheets.values()
            for row in (sheet.get("matched_rows") or [])
            if row.get("organization_id")
        }
        orgs = {o.id: o for o in Organization.objects.filter(id__in=org_ids)} if org_ids else {}

        for sheet_name, sheet in sheets.items():
            for row in (sheet.get("matched_rows") or []):
                action = row.get("aggregate_action")
                if action not in ("created", "updated"):
                    continue  # dry-run placeholders ("would_*") are not real writes
                approved_reset = bool(row.get("approved_reset"))
                record_audit_event(
                    action="import",
                    actor=actor,
                    object_type="aggregate",
                    object_id=row.get("aggregate_id"),
                    organization=orgs.get(row.get("organization_id")),
                    project=project,
                    description=(
                        f"Legacy workbook import {action} aggregate for "
                        f"'{row.get('indicator_name')}' from sheet '{sheet_name}'"
                        + (" (approved → pending reset)" if approved_reset else "")
                    ),
                    metadata={
                        "source": "legacy_workbook_import",
                        "upload_id": job.upload_id,
                        "import_job_id": job.id,
                        "sheet_name": sheet_name,
                        "indicator_id": row.get("indicator_id"),
                        "indicator_name": row.get("indicator_name"),
                        "organization_id": row.get("organization_id"),
                        "period_start": row.get("period_start"),
                        "period_end": row.get("period_end"),
                        "outcome": "reset_from_approved" if approved_reset else action,
                        "old_status": row.get("old_status"),
                        "old_value": row.get("old_value"),
                        "new_value": row.get("new_value"),
                        "organization_confidence": row.get("organization_confidence"),
                        "organization_match_reason": row.get("organization_match_reason"),
                        "override_used": bool(row.get("organization_override")),
                    },
                )

        # Audit sheets that were REFUSED (ambiguous / unresolved → nothing written).
        refused = list(summary.get("unresolved_sheet_names") or [])
        ambiguous = set(summary.get("ambiguous_sheet_names") or [])
        for sheet_name in refused:
            record_audit_event(
                action="import",
                actor=actor,
                object_type="aggregate",
                project=project,
                description=(
                    f"Legacy workbook import skipped sheet '{sheet_name}' "
                    f"({'ambiguous' if sheet_name in ambiguous else 'unresolved'} "
                    f"organization match) — no data written"
                ),
                metadata={
                    "source": "legacy_workbook_import",
                    "upload_id": job.upload_id,
                    "import_job_id": job.id,
                    "sheet_name": sheet_name,
                    "outcome": "ambiguous_skipped" if sheet_name in ambiguous else "unresolved_skipped",
                },
            )
    except Exception:  # pragma: no cover - auditing must never break the import
        import logging
        logging.getLogger(__name__).exception(
            "Failed to record legacy import audit for job id=%s", getattr(job, "id", None)
        )


def _content_disposition_filename(value, fallback):
    if not value:
        return fallback
    marker = 'filename="'
    if marker in value:
        return value.split(marker, 1)[1].split('"', 1)[0] or fallback
    if "filename=" in value:
        return value.split("filename=", 1)[1].split(";", 1)[0].strip() or fallback
    return fallback


def run_aggregate_export_job(job_id):
    job = ExportJob.objects.select_related("created_by").get(id=job_id)
    job.status = "processing"
    job.started_at = job.started_at or timezone.now()
    job.errors = []
    job.save(update_fields=["status", "started_at", "errors"])

    params = {str(key): str(value) for key, value in (job.parameters or {}).items() if value not in (None, "")}
    params.pop("background", None)
    query = QueryDict(mutable=True)
    for key, value in params.items():
        query[key] = value

    user = job.created_by
    if user is None:
        User = get_user_model()
        user = User.objects.filter(is_superuser=True).first() or User.objects.filter(role="admin").first()
    if user is None:
        job.status = "failed"
        job.completed_at = timezone.now()
        job.errors = [{"error": "No user available to run export."}]
        job.save(update_fields=["status", "completed_at", "errors"])
        return job

    request = APIRequestFactory().get("/api/aggregates/export/", data=query)
    # Replay the caller's environment to the export view (audit S-1). The signed
    # JWT mode claim is the sole source of truth for training/live isolation, but
    # a force_authenticate'd request carries no JWT. DRF's ForcedAuthentication
    # exposes the ``token`` arg as ``request._auth``, which is exactly where
    # organizations.access.token_mode() reads the claim — so passing a
    # ``{"mode": ...}`` token makes the export honour the job's environment
    # instead of silently defaulting to live.
    mode = job.mode if job.mode in {"live", "training"} else "live"
    force_authenticate(request, user=user, token={"mode": mode})
    response = AggregateViewSet.as_view({"get": "export"})(request)

    if getattr(response, "status_code", 500) >= 400:
        job.status = "failed"
        job.completed_at = timezone.now()
        job.errors = [{"error": "Aggregate export failed", "status_code": response.status_code}]
        job.save(update_fields=["status", "completed_at", "errors"])
        return job

    content_type = response.get("Content-Type", "application/octet-stream")
    fallback_name = "aggregates_export.xlsx" if params.get("file_format") == "excel" else "aggregates_export.csv"
    file_name = _content_disposition_filename(response.get("Content-Disposition", ""), fallback_name)
    output_dir = Path(settings.BASE_DIR) / "reports" / "export-jobs"
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / f"export-job-{job.id}-{file_name}"
    output_path.write_bytes(bytes(response.content))

    job.status = "completed"
    job.completed_at = timezone.now()
    job.output_file = str(output_path)
    job.file_name = file_name
    job.content_type = content_type
    job.result = {"size_bytes": output_path.stat().st_size}
    job.errors = []
    job.save(
        update_fields=[
            "status",
            "completed_at",
            "output_file",
            "file_name",
            "content_type",
            "result",
            "errors",
        ]
    )
    return job
