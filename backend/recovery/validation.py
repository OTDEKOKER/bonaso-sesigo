"""Backup package validation for the restore workflow.

A "package" here is a PostgreSQL custom-format dump (``*.dump``) produced by
``scripts/backup_database.sh``, optionally accompanied by its sidecar manifest
(``*.json``) carrying ``sha256`` and ``environment``.

Validation is deliberately read-only and never touches the live database. It
checks: file exists, checksum (if a manifest is available), archive integrity
via ``pg_restore --list``, and surfaces the source environment so callers can
enforce contamination protection (LIVE vs TRAINING).
"""
from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
from pathlib import Path

KNOWN_ENVIRONMENTS = {"LIVE", "TRAINING"}


def compute_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def pg_restore_list_ok(dump_path: Path) -> bool:
    """Archive integrity: pg_restore --list must parse the custom-format dump."""
    if not shutil.which("pg_restore"):
        return False
    try:
        result = subprocess.run(
            ["pg_restore", "--list", str(dump_path)],
            capture_output=True,
            text=True,
            timeout=120,
        )
    except (subprocess.TimeoutExpired, OSError):
        return False
    return result.returncode == 0 and bool(result.stdout.strip())


def read_manifest(manifest_path: Path) -> dict | None:
    try:
        with manifest_path.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
        return data if isinstance(data, dict) else None
    except (OSError, json.JSONDecodeError):
        return None


def _sidecar_manifest(dump_path: Path) -> dict | None:
    candidate = dump_path.with_suffix(".json")
    if candidate.is_file():
        return read_manifest(candidate)
    return None


def normalize_environment(value) -> str:
    text = str(value or "").strip().upper()
    return text if text in KNOWN_ENVIRONMENTS else "UNKNOWN"


def environment_conflict(source_env: str, target_env: str) -> bool:
    """True when restoring source into target would cross LIVE/TRAINING.

    An UNKNOWN source is treated as a conflict (requires explicit override) so a
    package without environment metadata can never silently land in LIVE.
    """
    source = normalize_environment(source_env)
    target = normalize_environment(target_env)
    if source == "UNKNOWN":
        return True
    return source != target


def validate_package(dump_path: Path, manifest: dict | None = None) -> dict:
    """Read-only validation. Returns a structured result; never raises."""
    errors: list[str] = []
    dump_path = Path(dump_path)

    if not dump_path.is_file():
        return {
            "valid": False,
            "errors": ["Backup file not found."],
            "archive_ok": False,
            "checksum_ok": None,
            "environment": "UNKNOWN",
        }

    if manifest is None:
        manifest = _sidecar_manifest(dump_path)

    actual_sha = compute_sha256(dump_path)
    expected_sha = (manifest or {}).get("sha256")
    if expected_sha:
        checksum_ok = expected_sha == actual_sha
        if not checksum_ok:
            errors.append("Checksum mismatch: file does not match its manifest.")
    else:
        checksum_ok = None  # no manifest checksum to compare against

    archive_ok = pg_restore_list_ok(dump_path)
    if not archive_ok:
        errors.append("Archive integrity check failed (pg_restore --list).")

    environment = normalize_environment((manifest or {}).get("environment"))
    if environment == "UNKNOWN":
        errors.append("Backup has no environment metadata; treat as untrusted.")

    return {
        "valid": archive_ok and checksum_ok is not False,
        "errors": errors,
        "archive_ok": archive_ok,
        "checksum_ok": checksum_ok,
        "checksum": actual_sha,
        "environment": environment,
        "created_at": (manifest or {}).get("created_at_utc", ""),
        "size_bytes": dump_path.stat().st_size,
        "filename": dump_path.name,
        "manifest": manifest or {},
    }
