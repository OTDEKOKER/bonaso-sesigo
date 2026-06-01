import json
import shutil
from pathlib import Path

from django.apps import apps
from django.conf import settings
from django.db import connection
from django.utils import timezone
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView


def _is_admin_user(user):
    return bool(
        getattr(user, "is_superuser", False)
        or getattr(user, "is_staff", False)
        or getattr(user, "role", "") == "admin"
    )


def _safe_read_json(path):
    try:
        with path.open("r", encoding="utf-8") as handle:
            return json.load(handle)
    except FileNotFoundError:
        return None
    except json.JSONDecodeError as exc:
        return {"error": f"Invalid JSON: {exc}"}
    except OSError as exc:
        return {"error": str(exc)}


def _latest_file(directory, pattern):
    try:
        files = sorted(directory.glob(pattern), key=lambda item: item.stat().st_mtime, reverse=True)
    except OSError:
        return None
    return files[0] if files else None


def _parse_datetime(value):
    if not value:
        return None
    try:
        return timezone.datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


def _age_hours(value):
    parsed = _parse_datetime(value)
    if not parsed:
        return None
    if timezone.is_naive(parsed):
        parsed = timezone.make_aware(parsed, timezone=timezone.utc)
    return round((timezone.now() - parsed).total_seconds() / 3600, 2)


def _disk_payload(path):
    usage = shutil.disk_usage(path)
    used_percent = round((usage.used / usage.total) * 100, 1) if usage.total else 0
    return {
        "path": str(path),
        "total_bytes": usage.total,
        "used_bytes": usage.used,
        "free_bytes": usage.free,
        "used_percent": used_percent,
        "status": "warning" if used_percent >= 85 else "ok",
    }


def _count_model(label, model_path):
    try:
        model = apps.get_model(model_path)
        return {label: model.objects.count()}
    except LookupError:
        return {label: None}


class SystemStatusView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not _is_admin_user(request.user):
            return Response({"detail": "You do not have permission to view system status."}, status=403)

        warnings = []
        backup_dir = settings.BASE_DIR / "backups" / "database"
        backup_manifest = _safe_read_json(backup_dir / "latest.json")
        backup_age_hours = _age_hours((backup_manifest or {}).get("created_at_utc")) if backup_manifest else None
        backup_status = "ok"
        if not backup_manifest:
            backup_status = "missing"
            warnings.append("No database backup manifest found.")
        elif backup_manifest.get("error"):
            backup_status = "error"
            warnings.append("Latest database backup manifest could not be read.")
        elif backup_manifest.get("verify_status") != "pg_restore_list_ok":
            backup_status = "warning"
            warnings.append("Latest database backup was not verified with pg_restore.")
        elif backup_age_hours is not None and backup_age_hours > 30:
            backup_status = "warning"
            warnings.append("Latest database backup is older than 30 hours.")

        parity_dir = settings.BASE_DIR / "reports" / "monthly_parity_checks"
        latest_parity_file = _latest_file(parity_dir, "parity_*.json")
        parity_payload = _safe_read_json(latest_parity_file) if latest_parity_file else None
        parity_status = "ok"
        parity_age_hours = None
        if latest_parity_file:
            parity_age_hours = round((timezone.now().timestamp() - latest_parity_file.stat().st_mtime) / 3600, 2)
        if not latest_parity_file:
            parity_status = "missing"
            warnings.append("No monthly payload parity report found.")
        elif isinstance(parity_payload, dict) and parity_payload.get("error"):
            parity_status = "error"
            warnings.append("Latest monthly payload parity report could not be read.")
        elif isinstance(parity_payload, dict):
            summary = parity_payload.get("summary") if isinstance(parity_payload.get("summary"), dict) else parity_payload
            mismatch_keys = ["missing_in_db", "missing_in_workbook", "payload_mismatches", "workbooks_missing", "organizations_missing"]
            has_mismatches = any(int(summary.get(key) or 0) > 0 for key in mismatch_keys)
            if has_mismatches:
                parity_status = "error"
                warnings.append("Latest monthly payload parity report has mismatches.")
            elif parity_age_hours is not None and parity_age_hours > 30:
                parity_status = "warning"
                warnings.append("Latest monthly payload parity report is older than 30 hours.")

        db_status = "ok"
        try:
            with connection.cursor() as cursor:
                cursor.execute("SELECT 1")
                cursor.fetchone()
        except Exception as exc:
            db_status = "error"
            warnings.append(f"Database health check failed: {exc}")

        counts = {}
        for label, model_path in [
            ("aggregates", "aggregates.Aggregate"),
            ("indicators", "indicators.Indicator"),
            ("organizations", "organizations.Organization"),
            ("projects", "projects.Project"),
            ("users", "users.User"),
            ("uploads", "uploads.Upload"),
            ("import_jobs", "uploads.ImportJob"),
        ]:
            counts.update(_count_model(label, model_path))

        import_job_counts = {}
        try:
            ImportJob = apps.get_model("uploads.ImportJob")
            for status_value in ["pending", "uploaded", "analyzing", "ready_for_review", "processing", "validated", "completed", "imported", "failed"]:
                import_job_counts[status_value] = ImportJob.objects.filter(status=status_value).count()
        except LookupError:
            import_job_counts = {}

        disk = _disk_payload(settings.BASE_DIR)
        if disk["status"] != "ok":
            warnings.append("Server disk usage is above 85%.")

        overall_status = "ok"
        if any(item in {"error", "missing"} for item in [backup_status, parity_status, db_status]):
            overall_status = "error"
        elif warnings:
            overall_status = "warning"

        return Response(
            {
                "status": overall_status,
                "checked_at": timezone.now().isoformat(),
                "database": {
                    "status": db_status,
                    "engine": connection.vendor,
                    "name": connection.settings_dict.get("NAME"),
                },
                "backup": {
                    "status": backup_status,
                    "age_hours": backup_age_hours,
                    "manifest": backup_manifest,
                },
                "parity": {
                    "status": parity_status,
                    "age_hours": parity_age_hours,
                    "report_file": str(latest_parity_file) if latest_parity_file else None,
                    "summary": parity_payload.get("summary", parity_payload) if isinstance(parity_payload, dict) else parity_payload,
                },
                "disk": disk,
                "counts": counts,
                "import_jobs": import_job_counts,
                "warnings": warnings,
            }
        )
