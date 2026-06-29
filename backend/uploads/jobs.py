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
    return job


def _content_disposition_filename(value, fallback):
    if not value:
        return fallback
    marker = 'filename="'
    if marker in value:
        return value.split(marker, 1)[1].split('"', 1)[0] or fallback
    if "filename=" in value:
        return value.split("filename=", 1)[1].split(";", 1)[0].strip() or fallback
    return fallback


def _run_aggregate_view_export(job, *, view_action, request_path, fallback_name):
    """Shared body for background jobs that download a file from a GET action on
    :class:`AggregateViewSet`.

    Both the aggregate CSV/Excel export and the coordinator reporting workbook
    are heavy, synchronous endpoints that exceed the gateway timeout for large
    payloads. Running them through a detached worker (``process_export_job``)
    and persisting the result lets the HTTP request return immediately while the
    file is built off the request path.

    The worker rebuilds the request with ``force_authenticate(user=...)`` and so
    carries no JWT, yet the signed ``mode`` claim is the sole source of truth for
    training/live isolation (audit S-1). DRF's ForcedAuthentication exposes the
    ``token`` arg as ``request._auth`` — exactly where
    ``organizations.access.token_mode()`` reads the claim — so replaying a
    ``{"mode": ...}`` token makes the export honour the job's persisted
    environment instead of silently defaulting to live.

    The job has already been marked ``processing`` by the caller. On success the
    job is marked ``completed`` with the output file recorded; on a >=400
    response or a missing user it is marked ``failed``. Returns the job.
    """
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

    request = APIRequestFactory().get(request_path, data=query)
    mode = job.mode if job.mode in {"live", "training"} else "live"
    force_authenticate(request, user=user, token={"mode": mode})
    response = AggregateViewSet.as_view({"get": view_action})(request)

    if getattr(response, "status_code", 500) >= 400:
        detail = ""
        try:
            data = getattr(response, "data", None)
            if isinstance(data, dict):
                detail = str(data.get("detail") or "")
        except Exception:
            detail = ""
        job.status = "failed"
        job.completed_at = timezone.now()
        job.errors = [{"error": "Aggregate export failed", "status_code": response.status_code, "detail": detail}]
        job.save(update_fields=["status", "completed_at", "errors"])
        return job

    content_type = response.get("Content-Type", "application/octet-stream")
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
    job.result = {
        **(job.result if isinstance(job.result, dict) else {}),
        "size_bytes": output_path.stat().st_size,
    }
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


def run_aggregate_export_job(job_id):
    job = ExportJob.objects.select_related("created_by").get(id=job_id)
    job.status = "processing"
    job.started_at = job.started_at or timezone.now()
    job.errors = []
    job.save(update_fields=["status", "started_at", "errors"])

    params = job.parameters or {}
    fallback_name = "aggregates_export.xlsx" if str(params.get("file_format")) == "excel" else "aggregates_export.csv"
    return _run_aggregate_view_export(
        job,
        view_action="export",
        request_path="/api/aggregates/export/",
        fallback_name=fallback_name,
    )


def run_coordinator_workbook_job(job_id):
    """Build a coordinator reporting workbook in the background.

    The coordinator workbook fans out one reporting-form sheet per
    sub-organisation plus a cross-sheet TOTAL sheet; for large coordinators the
    synchronous endpoint exceeds the gateway timeout (~120s) and 502s. This runs
    the same generation off the request path and persists the .xlsx for download.
    """
    job = ExportJob.objects.select_related("created_by").get(id=job_id)
    job.status = "processing"
    job.started_at = job.started_at or timezone.now()
    job.errors = []
    job.save(update_fields=["status", "started_at", "errors"])

    return _run_aggregate_view_export(
        job,
        view_action="coordinator_workbook",
        request_path="/api/aggregates/coordinator-workbook/",
        fallback_name="coordinator_workbook.xlsx",
    )
