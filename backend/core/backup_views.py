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
import os
import shutil
import subprocess
import tarfile
import tempfile
from datetime import datetime, timezone as dt_timezone
from pathlib import Path

from django.conf import settings
from django.http import FileResponse
from django.utils import timezone
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
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


def _resolve_manifest_path(manifest, key):
    """Resolve a manifest-referenced file, constrained to the backup dir
    (defence-in-depth against a tampered manifest / path traversal)."""
    if not isinstance(manifest, dict):
        return None
    raw = manifest.get(key)
    if not raw:
        return None
    path = Path(raw).resolve()
    try:
        path.relative_to(_backup_dir().resolve())
    except ValueError:
        return None
    return path if path.is_file() else None


def _resolve_dump_path(manifest):
    return _resolve_manifest_path(manifest, "backup_file")


def _resolve_asset_path(manifest):
    return _resolve_manifest_path(manifest, "asset_file")


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


# ---------------------------------------------------------------------------
# Encrypted off-site backup download (admin-only, password-confirmed)
# ---------------------------------------------------------------------------
MIN_ENCRYPTION_PASSWORD_LEN = 12
# PBKDF2 iteration count for openssl's password-based key derivation. High
# enough to slow brute-forcing of the archive password if the file is stolen.
_PBKDF2_ITER = "200000"

_RESTORE_README = """SESIGO / BONASO encrypted off-site backup
==========================================

This archive was produced by an administrator from the Settings > Backup page.
It contains a PostgreSQL custom-format dump and (if present) the media/uploads
archive, packed into a .tar.gz and encrypted with AES-256-CBC.

The encryption password is NOT stored anywhere by SESIGO. If you lose it, this
file cannot be recovered. Store it securely (e.g. a password manager).

To decrypt and unpack (needs openssl + tar):

  openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \\
    -in <file>.tar.gz.enc -out backup.tar.gz -pass pass:'YOUR_PASSWORD'
  tar -xzf backup.tar.gz

To restore the database from the dump, follow docs/SESIGO_DISASTER_RECOVERY_RUNBOOK.md.
"""


class EncryptedBackupDownloadView(_AdminBackupView):
    """Generate and stream an encrypted, password-protected backup package.

    Hardens the plain download for off-site / external-drive storage:

    * admin-only (``_is_admin_user`` + module permission);
    * the caller must re-confirm their **account password** (defence against a
      hijacked but unattended admin session pulling the whole database);
    * the dump + media archive are encrypted with a caller-supplied
      **encryption password** via AES-256-CBC (openssl, PBKDF2). The password is
      passed to openssl through the environment, never via argv, and is **never
      stored or logged**;
    * the temporary plaintext tar and the encrypted file are deleted after the
      response is streamed;
    * rate-limited (``backup`` scope) because it is an expensive operation;
    * the download is recorded in the audit stream (size, success — no password),
      and counts as a backup download for reminder tracking.
    """

    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "backup"

    def post(self, request):
        guard = self._guard(request)
        if guard:
            return guard

        account_password = str(request.data.get("account_password") or "")
        encryption_password = str(request.data.get("encryption_password") or "")

        if not request.user.check_password(account_password):
            record_audit_event(
                action="backup_downloaded",
                request=request,
                object_type="backup",
                description="Encrypted backup download denied: account password re-confirmation failed.",
                metadata={"encrypted": True, "outcome": "password_rejected"},
            )
            return Response(
                {"detail": "Account password confirmation failed."}, status=403
            )

        if len(encryption_password) < MIN_ENCRYPTION_PASSWORD_LEN:
            return Response(
                {"detail": f"Encryption password must be at least {MIN_ENCRYPTION_PASSWORD_LEN} characters."},
                status=400,
            )

        manifest = _latest_manifest()
        dump_path = _resolve_dump_path(manifest)
        if dump_path is None:
            return Response({"detail": "No verified backup available to encrypt."}, status=404)
        asset_path = _resolve_asset_path(manifest)

        if shutil.which("openssl") is None:
            return Response({"detail": "openssl is not available on the server."}, status=500)

        tmp_dir = Path(tempfile.mkdtemp(prefix="sesigo_enc_bk_"))
        stamp = datetime.now(dt_timezone.utc).strftime("%Y%m%d_%H%M%S")
        tar_path = tmp_dir / f"sesigo_backup_{stamp}.tar.gz"
        enc_path = tmp_dir / f"sesigo_backup_{stamp}.tar.gz.enc"
        download_name = enc_path.name

        try:
            with tarfile.open(tar_path, "w:gz") as tar:
                tar.add(dump_path, arcname=dump_path.name)
                if asset_path is not None:
                    tar.add(asset_path, arcname=asset_path.name)
                readme = tmp_dir / "RESTORE_README.txt"
                readme.write_text(_RESTORE_README, encoding="utf-8")
                tar.add(readme, arcname="RESTORE_README.txt")

            env = {**os.environ, "BK_ENC_PW": encryption_password}
            subprocess.run(
                [
                    "openssl", "enc", "-aes-256-cbc", "-salt",
                    "-pbkdf2", "-iter", _PBKDF2_ITER,
                    "-in", str(tar_path), "-out", str(enc_path),
                    "-pass", "env:BK_ENC_PW",
                ],
                env=env, capture_output=True, text=True, timeout=600, check=True,
            )
        except subprocess.CalledProcessError as exc:
            shutil.rmtree(tmp_dir, ignore_errors=True)
            record_audit_event(
                action="backup_downloaded", request=request, object_type="backup",
                description="Encrypted backup download failed during encryption.",
                metadata={"encrypted": True, "outcome": "encrypt_failed", "returncode": exc.returncode},
            )
            return Response({"detail": "Encryption failed."}, status=500)
        except Exception:
            shutil.rmtree(tmp_dir, ignore_errors=True)
            return Response({"detail": "Failed to build backup package."}, status=500)
        finally:
            # The plaintext tar is no longer needed once encryption is done.
            try:
                tar_path.unlink(missing_ok=True)
            except OSError:
                pass

        enc_size = enc_path.stat().st_size
        record_audit_event(
            action="backup_downloaded",
            request=request,
            object_type="backup",
            object_id=(manifest or {}).get("created_at_utc") or download_name,
            description=f"Encrypted backup {download_name} downloaded.",
            metadata={
                "encrypted": True,
                "outcome": "ok",
                "filename": download_name,
                "encrypted_size_bytes": enc_size,
                "includes_media": asset_path is not None,
                "source_dump": dump_path.name,
            },
        )

        response = FileResponse(
            enc_path.open("rb"),
            as_attachment=True,
            filename=download_name,
            content_type="application/octet-stream",
        )
        # Remove the temp dir (and the encrypted file) once the response is sent.
        response._resource_closers.append(lambda: shutil.rmtree(tmp_dir, ignore_errors=True))
        return response
