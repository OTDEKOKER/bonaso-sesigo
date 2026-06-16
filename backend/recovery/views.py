"""Super-admin restore API: upload + validate + history.

These endpoints NEVER apply a restore. The actual database overwrite is done by
``python manage.py restore_backup`` on the server (see that command). The upload
endpoint stages a package, validates it read-only, records the attempt, and
returns the exact CLI command an operator should run to apply it.
"""
from pathlib import Path

from django.conf import settings
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from audit.recording import record_audit_event
from core.status_views import _is_admin_user
from users.permissions import HasModulePermission

from .models import RestoreHistory
from .validation import environment_conflict, validate_package

MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024  # 2 GB safety ceiling


def _staging_dir() -> Path:
    path = settings.BASE_DIR / "backups" / "database" / "restore_staging"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _safe_name(name: str) -> str:
    return Path(name or "upload.dump").name.replace("/", "_").replace("\\", "_")


class _SuperAdminView(APIView):
    required_module = "system_status"
    permission_classes = [IsAuthenticated, HasModulePermission]

    def _guard(self, request):
        if not _is_admin_user(request.user):
            return Response({"detail": "Super-admin access required."}, status=403)
        return None


class RestoreValidateView(_SuperAdminView):
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request):
        guard = self._guard(request)
        if guard:
            return guard

        upload = request.FILES.get("file")
        if upload is None:
            return Response({"detail": "No backup file provided."}, status=400)
        if upload.size and upload.size > MAX_UPLOAD_BYTES:
            return Response({"detail": "Backup exceeds the maximum upload size."}, status=400)

        dest = _staging_dir() / _safe_name(upload.name)
        with dest.open("wb") as handle:
            for chunk in upload.chunks():
                handle.write(chunk)

        result = validate_package(dest)
        target_env = getattr(settings, "BONASO_ENVIRONMENT", "LIVE")
        conflict = environment_conflict(result["environment"], target_env)

        RestoreHistory.objects.create(
            restored_by=request.user,
            restored_by_username=getattr(request.user, "username", "") or "",
            backup_name=result.get("filename", ""),
            backup_created_at=result.get("created_at", ""),
            checksum=result.get("checksum", ""),
            source_environment=result.get("environment", "UNKNOWN"),
            target_environment=target_env,
            environment_override=False,
            result="validated" if result["valid"] else "rejected",
            notes="Uploaded via System Status for validation.",
            summary={"errors": result["errors"], "environment_conflict": conflict},
        )
        record_audit_event(
            action="backup_uploaded",
            request=request,
            object_type="backup",
            object_id=result.get("filename", ""),
            description="Backup uploaded and validated for restore.",
            metadata={"valid": result["valid"], "environment": result["environment"]},
        )

        apply_cmd = (
            f"python manage.py restore_backup {dest} --confirm RESTORE"
            + (" --override OVERRIDE" if conflict else "")
        )
        return Response({
            "valid": result["valid"],
            "errors": result["errors"],
            "archive_ok": result["archive_ok"],
            "checksum_ok": result["checksum_ok"],
            "source_environment": result["environment"],
            "target_environment": target_env,
            "environment_conflict": conflict,
            "created_at": result.get("created_at"),
            "size_bytes": result.get("size_bytes"),
            "filename": result.get("filename"),
            "staged_path": str(dest),
            "apply_command": apply_cmd,
            "note": (
                "This did not change any data. To apply, an operator must run the "
                "command above on the server."
            ),
        })


class RestoreHistoryView(_SuperAdminView):
    def get(self, request):
        guard = self._guard(request)
        if guard:
            return guard
        rows = RestoreHistory.objects.all()[:50]
        return Response({
            "count": RestoreHistory.objects.count(),
            "results": [
                {
                    "id": r.id,
                    "created_at": r.created_at.isoformat(),
                    "restored_by": r.restored_by_username,
                    "backup_name": r.backup_name,
                    "source_environment": r.source_environment,
                    "target_environment": r.target_environment,
                    "environment_override": r.environment_override,
                    "result": r.result,
                    "notes": r.notes,
                }
                for r in rows
            ],
        })
