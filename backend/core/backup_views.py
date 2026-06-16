"""Admin-facing backup management API.

Exposes three operations on top of the existing ``scripts/backup_database.sh``
pipeline so an admin can manage backups from the System Status page:

  * GET  status   — latest backup manifest + download-tracking + reminder level.
  * POST generate — run the backup script on demand (admin only).
  * GET  download — stream the latest verified dump and record the download.

Download tracking is derived from the unified audit stream (``backup_downloaded``
events) rather than a separate table, so the audit log is the single source of
truth and doubles as proof that backups are being managed.

Reminder levels (days since last download):
  green  < 7   |  amber 7–13   |  red 14+ (or never)
"""
import subprocess
from pathlib import Path

from django.conf import settings
from django.http import FileResponse
from django.utils import timezone
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from audit.models import AuditEvent
from audit.recording import record_audit_event
from users.permissions import HasModulePermission

from .status_views import _is_admin_user, _safe_read_json

DOWNLOAD_DUE_DAYS = 7
DOWNLOAD_RED_DAYS = 14

SENSITIVE_DATA_WARNING = (
    "This backup contains sensitive system data. Download it only on a trusted "
    "device and store it securely on an encrypted external drive."
)
BACKUP_SCRIPT = "scripts/backup_database.sh"


def _backup_dir() -> Path:
    return settings.BASE_DIR / "backups" / "database"


def _latest_manifest():
    return _safe_read_json(_backup_dir() / "latest.json")


def _last_download_event():
    return (
        AuditEvent.objects.filter(action="backup_downloaded")
        .order_by("-created_at")
        .first()
    )


def _download_state():
    """(last_downloaded_at, days_since, level, due, last_actor_username)."""
    event = _last_download_event()
    last = event.created_at if event else None
    days = (timezone.now() - last).days if last else None
    if days is None or days >= DOWNLOAD_RED_DAYS:
        level = "red"
    elif days >= DOWNLOAD_DUE_DAYS:
        level = "amber"
    else:
        level = "green"
    due = days is None or days >= DOWNLOAD_DUE_DAYS
    actor = event.actor_username if event else None
    return last, days, level, due, actor


def _resolve_dump_path(manifest):
    """The latest dump path from the manifest, constrained to the backup dir
    (defence-in-depth against a tampered manifest)."""
    if not isinstance(manifest, dict):
        return None
    raw = manifest.get("backup_file")
    if not raw:
        return None
    path = Path(raw).resolve()
    backup_dir = _backup_dir().resolve()
    try:
        path.relative_to(backup_dir)
    except ValueError:
        return None
    return path if path.is_file() else None


class _AdminBackupView(APIView):
    required_module = "system_status"
    permission_classes = [IsAuthenticated, HasModulePermission]

    def _guard(self, request):
        if not _is_admin_user(request.user):
            return Response(
                {"detail": "You do not have permission to manage backups."},
                status=403,
            )
        return None


def backup_status_payload():
    manifest = _latest_manifest()
    last, days, level, due, actor = _download_state()
    if days is None:
        message = "No backup has ever been downloaded."
    else:
        message = f"Backup has not been downloaded for {days} day{'' if days == 1 else 's'}."
    return {
        "warning_text": SENSITIVE_DATA_WARNING,
        "latest": {
            "created_at_utc": (manifest or {}).get("created_at_utc"),
            "size_bytes": (manifest or {}).get("size_bytes"),
            "sha256": (manifest or {}).get("sha256"),
            "verify_status": (manifest or {}).get("verify_status"),
            "offsite_status": (manifest or {}).get("offsite_status"),
            "available": _resolve_dump_path(manifest) is not None,
        },
        "download": {
            "last_downloaded_at": last.isoformat() if last else None,
            "last_downloaded_by": actor,
            "days_since_download": days,
            "level": level,
            "due": due,
            "message": message if due else None,
        },
    }


class BackupStatusView(_AdminBackupView):
    def get(self, request):
        guard = self._guard(request)
        if guard:
            return guard
        return Response(backup_status_payload())


class BackupGenerateView(_AdminBackupView):
    def post(self, request):
        guard = self._guard(request)
        if guard:
            return guard
        script = settings.BASE_DIR / BACKUP_SCRIPT
        if not script.is_file():
            return Response({"detail": "Backup script not found."}, status=500)
        try:
            result = subprocess.run(
                ["bash", str(script)],
                cwd=str(settings.BASE_DIR),
                capture_output=True,
                text=True,
                timeout=600,
            )
        except subprocess.TimeoutExpired:
            return Response({"detail": "Backup timed out."}, status=504)

        manifest = _latest_manifest()
        ok = result.returncode == 0
        record_audit_event(
            action="backup_generated",
            request=request,
            object_type="backup",
            object_id=(manifest or {}).get("created_at_utc") or "",
            description="On-demand database backup generated via System Status.",
            metadata={
                "returncode": result.returncode,
                "verify_status": (manifest or {}).get("verify_status"),
                "offsite_status": (manifest or {}).get("offsite_status"),
            },
        )
        if not ok:
            return Response(
                {"detail": "Backup script failed.", "stderr": result.stderr[-2000:]},
                status=500,
            )
        return Response(backup_status_payload())


class BackupDownloadView(_AdminBackupView):
    def get(self, request):
        guard = self._guard(request)
        if guard:
            return guard
        manifest = _latest_manifest()
        path = _resolve_dump_path(manifest)
        if path is None:
            return Response({"detail": "No downloadable backup available."}, status=404)

        record_audit_event(
            action="backup_downloaded",
            request=request,
            object_type="backup",
            object_id=(manifest or {}).get("created_at_utc") or path.name,
            description=f"Database backup {path.name} downloaded.",
            metadata={
                "filename": path.name,
                "size_bytes": (manifest or {}).get("size_bytes"),
                "sha256": (manifest or {}).get("sha256"),
            },
        )
        response = FileResponse(
            path.open("rb"),
            as_attachment=True,
            filename=path.name,
            content_type="application/octet-stream",
        )
        return response
