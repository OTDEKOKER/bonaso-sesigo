"""Supervised database restore (disaster recovery).

This is the ONLY path that applies a backup to a database. It is intentionally a
management command run by an operator on the server — never reachable from a web
request — because it overwrites the target database.

Safety rails (all enforced here):
  1. Read-only validation (checksum + archive integrity + environment).
  2. Environment contamination guard: a LIVE backup may not restore into a
     TRAINING target (or vice-versa), and a backup with no environment metadata
     is always blocked, unless --override OVERRIDE is given.
  3. Typed confirmation: nothing is applied without --confirm RESTORE.
  4. A pre-restore safety backup is taken first; if the restore fails the target
     is rolled back to it automatically.
  5. Every attempt is written to RestoreHistory + the audit stream.

Examples:
  # validate only, no changes
  python manage.py restore_backup /path/db.dump --dry-run
  # actually restore (same environment)
  python manage.py restore_backup /path/db.dump --confirm RESTORE --notes "DR drill"
  # cross-environment restore (requires explicit override)
  python manage.py restore_backup /path/db.dump --confirm RESTORE --override OVERRIDE
"""
from __future__ import annotations

import subprocess
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import connection

from audit.recording import record_audit_event
from recovery.models import RestoreHistory
from recovery.validation import environment_conflict, validate_package, read_manifest


def _database_url() -> str:
    db = settings.DATABASES["default"]
    user = db.get("USER") or ""
    password = db.get("PASSWORD") or ""
    host = db.get("HOST") or "localhost"
    port = db.get("PORT") or "5432"
    name = db.get("NAME") or ""
    auth = user + (f":{password}" if password else "")
    auth = (auth + "@") if auth else ""
    return f"postgresql://{auth}{host}:{port}/{name}"


def _model_counts() -> dict:
    counts = {}
    from django.apps import apps

    for label, path in [
        ("organizations", "organizations.Organization"),
        ("projects", "projects.Project"),
        ("indicators", "indicators.Indicator"),
        ("aggregates", "aggregates.Aggregate"),
        ("respondents", "respondents.Respondent"),
        ("users", "users.User"),
    ]:
        try:
            counts[label] = apps.get_model(path).objects.count()
        except Exception:
            counts[label] = None
    return counts


class Command(BaseCommand):
    help = "Validate and (optionally) restore a database backup with full safety rails."

    def add_arguments(self, parser):
        parser.add_argument("dump_path")
        parser.add_argument("--manifest", default=None)
        parser.add_argument("--confirm", default="", help="Must equal RESTORE to apply.")
        parser.add_argument("--override", default="", help="Must equal OVERRIDE for cross-environment restore.")
        parser.add_argument("--notes", default="")
        parser.add_argument("--dry-run", action="store_true")
        parser.add_argument("--no-safety-backup", action="store_true",
                            help="Skip the pre-restore safety backup (NOT recommended).")
        parser.add_argument("--actor-id", type=int, default=None,
                            help="User id to attribute the restore to (audit/history).")

    # -- helpers -----------------------------------------------------------
    def _actor(self, options):
        if options.get("actor_id"):
            from users.models import User
            return User.objects.filter(id=options["actor_id"]).first()
        return None

    def _record(self, *, result, actor, validation, target_env, override, notes, summary=None):
        RestoreHistory.objects.create(
            restored_by=actor,
            restored_by_username=getattr(actor, "username", "") or "cli",
            backup_name=validation.get("filename", ""),
            backup_created_at=validation.get("created_at", ""),
            checksum=validation.get("checksum", ""),
            source_environment=validation.get("environment", "UNKNOWN"),
            target_environment=target_env,
            environment_override=override,
            result=result,
            notes=notes,
            summary=summary or {},
        )

    def _pg_restore(self, dump_path: Path) -> subprocess.CompletedProcess:
        return subprocess.run(
            ["pg_restore", "--clean", "--if-exists", "--no-owner",
             "--dbname", _database_url(), str(dump_path)],
            capture_output=True, text=True, timeout=1800,
        )

    # -- main --------------------------------------------------------------
    def handle(self, *args, **options):
        dump_path = Path(options["dump_path"]).resolve()
        target_env = getattr(settings, "BONASO_ENVIRONMENT", "LIVE")
        actor = self._actor(options)
        notes = options["notes"]
        manifest = read_manifest(Path(options["manifest"])) if options["manifest"] else None

        validation = validate_package(dump_path, manifest=manifest)
        source_env = validation["environment"]
        self.stdout.write(f"Backup: {validation.get('filename')}  env={source_env}  target={target_env}")
        self.stdout.write(f"Archive OK: {validation['archive_ok']}  Checksum OK: {validation['checksum_ok']}")

        if not validation["valid"]:
            for err in validation["errors"]:
                self.stderr.write(f"  - {err}")
            self._record(result="rejected", actor=actor, validation=validation,
                        target_env=target_env, override=False, notes=notes,
                        summary={"errors": validation["errors"]})
            record_audit_event(action="restore_failed", actor=actor, object_type="backup",
                              object_id=validation.get("filename", ""),
                              description="Restore rejected: validation failed.",
                              metadata={"errors": validation["errors"]})
            raise CommandError("Backup failed validation; nothing was changed.")

        # Environment contamination guard.
        override_requested = options["override"] == "OVERRIDE"
        if environment_conflict(source_env, target_env):
            if not override_requested:
                self._record(result="rejected", actor=actor, validation=validation,
                            target_env=target_env, override=False, notes=notes,
                            summary={"reason": "environment_conflict"})
                record_audit_event(action="restore_failed", actor=actor, object_type="backup",
                                  object_id=validation.get("filename", ""),
                                  description=f"Restore blocked: {source_env} -> {target_env} contamination.",
                                  metadata={"source": source_env, "target": target_env})
                raise CommandError(
                    f"Environment contamination blocked: {source_env} backup into {target_env} "
                    f"target. Re-run with --override OVERRIDE to force (logged)."
                )
            record_audit_event(action="environment_override", actor=actor, object_type="backup",
                              object_id=validation.get("filename", ""),
                              description=f"Environment override: {source_env} -> {target_env}.",
                              metadata={"source": source_env, "target": target_env})
            self.stderr.write(f"WARNING: environment override {source_env} -> {target_env} (logged).")

        if options["dry_run"] or options["confirm"] != "RESTORE":
            self._record(result="validated", actor=actor, validation=validation,
                        target_env=target_env, override=override_requested, notes=notes,
                        summary={"validation": "ok"})
            self.stdout.write(self.style.WARNING(
                "Validation only. Re-run with --confirm RESTORE to apply." if not options["dry_run"]
                else "Dry run complete; no changes made."
            ))
            return

        # --- destructive from here -------------------------------------
        safety_path = None
        if not options["no_safety_backup"]:
            self.stdout.write("Taking pre-restore safety backup...")
            script = settings.BASE_DIR / "scripts" / "backup_database.sh"
            result = subprocess.run(["bash", str(script)], cwd=str(settings.BASE_DIR),
                                    capture_output=True, text=True, timeout=900)
            if result.returncode != 0:
                self._record(result="failed", actor=actor, validation=validation,
                            target_env=target_env, override=override_requested, notes=notes,
                            summary={"reason": "safety_backup_failed"})
                raise CommandError("Pre-restore safety backup failed; aborting before any change.")
            manifest_after = read_manifest(settings.BASE_DIR / "backups" / "database" / "latest.json") or {}
            safety_path = manifest_after.get("backup_file")
            self.stdout.write(f"Safety backup: {safety_path}")

        self._record(result="pending", actor=actor, validation=validation,
                    target_env=target_env, override=override_requested, notes=notes)
        connection.close()  # drop our own connection before pg_restore --clean

        self.stdout.write(self.style.WARNING("Applying restore (this overwrites the target DB)..."))
        restore = self._pg_restore(dump_path)
        if restore.returncode == 0:
            summary = {"counts": _model_counts()}
            self._record(result="success", actor=actor, validation=validation,
                        target_env=target_env, override=override_requested, notes=notes,
                        summary=summary)
            record_audit_event(action="backup_restored", actor=actor, object_type="backup",
                              object_id=validation.get("filename", ""),
                              description=f"Backup restored into {target_env}.",
                              metadata={"source": source_env, "target": target_env, "counts": summary["counts"]})
            self.stdout.write(self.style.SUCCESS("Restore complete."))
            return

        # Restore failed -> roll back to the safety backup if we have one.
        self.stderr.write(f"Restore failed: {restore.stderr[-1500:]}")
        rolled_back = False
        if safety_path and Path(safety_path).is_file():
            self.stderr.write("Rolling back to pre-restore safety backup...")
            rollback = self._pg_restore(Path(safety_path))
            rolled_back = rollback.returncode == 0
        self._record(result="rolled_back" if rolled_back else "failed", actor=actor,
                    validation=validation, target_env=target_env, override=override_requested,
                    notes=notes, summary={"rolled_back": rolled_back, "stderr": restore.stderr[-1500:]})
        record_audit_event(action="restore_failed", actor=actor, object_type="backup",
                          object_id=validation.get("filename", ""),
                          description="Restore failed." + (" Rolled back." if rolled_back else " ROLLBACK ALSO FAILED."),
                          metadata={"rolled_back": rolled_back})
        raise CommandError(
            "Restore failed. " + ("Target rolled back to safety backup." if rolled_back
            else "ROLLBACK FAILED — restore the safety backup manually IMMEDIATELY.")
        )
