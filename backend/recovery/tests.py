"""Tests for the disaster-recovery restore subsystem."""
import tempfile
from pathlib import Path
from unittest.mock import patch

from django.core.management import call_command
from django.core.management.base import CommandError
from rest_framework.test import APITestCase

from audit.models import AuditEvent
from organizations.models import Organization
from recovery import validation
from recovery.management.commands import restore_backup as restore_cmd
from recovery.models import RestoreHistory
from users.models import User


class ValidationUnitTests(APITestCase):
    def test_environment_conflict_rules(self):
        self.assertFalse(validation.environment_conflict("LIVE", "LIVE"))
        self.assertFalse(validation.environment_conflict("TRAINING", "TRAINING"))
        self.assertTrue(validation.environment_conflict("TRAINING", "LIVE"))
        self.assertTrue(validation.environment_conflict("LIVE", "TRAINING"))
        # Unknown source is always a conflict (must be overridden explicitly).
        self.assertTrue(validation.environment_conflict("UNKNOWN", "LIVE"))
        self.assertTrue(validation.environment_conflict("", "LIVE"))

    def test_validate_missing_file(self):
        result = validation.validate_package(Path("/nonexistent/x.dump"))
        self.assertFalse(result["valid"])
        self.assertFalse(result["archive_ok"])

    def test_validate_checksum_mismatch(self):
        with tempfile.TemporaryDirectory() as d:
            dump = Path(d) / "db.dump"
            dump.write_bytes(b"not a real pg dump")
            # Manifest claims a different checksum -> mismatch + invalid.
            result = validation.validate_package(dump, manifest={"sha256": "wrong", "environment": "LIVE"})
            self.assertFalse(result["valid"])
            self.assertFalse(result["checksum_ok"])
            self.assertEqual(result["environment"], "LIVE")


class RestoreApiPermissionTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.org = Organization.objects.create(name="HQ", code="RC_HQ", type="district")
        cls.admin = User.objects.create_user(
            username="rc_admin", email="rc_admin@example.com",
            password="TestPass123!", role="admin", organization=cls.org,
        )
        cls.officer = User.objects.create_user(
            username="rc_off", email="rc_off@example.com",
            password="TestPass123!", role="officer", organization=cls.org,
        )

    def test_validate_requires_admin(self):
        self.client.force_authenticate(self.officer)
        self.assertEqual(self.client.post("/api/system/restore/validate/").status_code, 403)

    def test_history_requires_admin(self):
        self.client.force_authenticate(self.officer)
        self.assertEqual(self.client.get("/api/system/restore/history/").status_code, 403)

    def test_upload_validates_records_history_and_audits(self):
        self.client.force_authenticate(self.admin)
        from django.core.files.uploadedfile import SimpleUploadedFile
        upload = SimpleUploadedFile("db.dump", b"fake-dump-bytes", content_type="application/octet-stream")
        resp = self.client.post("/api/system/restore/validate/", {"file": upload}, format="multipart")
        self.assertEqual(resp.status_code, 200, resp.content)
        body = resp.json()
        # A fake dump is not a real archive -> invalid, but the endpoint never applies.
        self.assertFalse(body["valid"])
        self.assertIn("restore_backup", body["apply_command"])
        self.assertTrue(RestoreHistory.objects.filter(result="rejected").exists())
        self.assertTrue(AuditEvent.objects.filter(action="backup_uploaded").exists())

    def test_upload_rejects_when_no_file(self):
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.client.post("/api/system/restore/validate/").status_code, 400)


class RestoreCommandSafetyTests(APITestCase):
    """The destructive CLI path, with the DB-touching calls mocked out."""

    def _valid_validation(self, environment):
        return {
            "valid": True, "errors": [], "archive_ok": True, "checksum_ok": True,
            "checksum": "abc", "environment": environment, "created_at": "",
            "size_bytes": 10, "filename": "db.dump", "manifest": {},
        }

    def test_environment_conflict_blocks_without_override(self):
        # TRAINING backup into LIVE target (default) must be blocked, nothing applied.
        with patch.object(restore_cmd, "validate_package", return_value=self._valid_validation("TRAINING")), \
             patch.object(restore_cmd.Command, "_pg_restore") as mock_restore:
            with self.assertRaises(CommandError):
                call_command("restore_backup", "/tmp/db.dump", "--confirm", "RESTORE")
        mock_restore.assert_not_called()
        self.assertTrue(RestoreHistory.objects.filter(result="rejected").exists())
        self.assertTrue(AuditEvent.objects.filter(action="restore_failed").exists())

    def test_validation_only_when_not_confirmed(self):
        with patch.object(restore_cmd, "validate_package", return_value=self._valid_validation("LIVE")), \
             patch.object(restore_cmd.Command, "_pg_restore") as mock_restore:
            call_command("restore_backup", "/tmp/db.dump")  # no --confirm
        mock_restore.assert_not_called()
        self.assertTrue(RestoreHistory.objects.filter(result="validated").exists())

    def test_successful_restore_with_override_audits(self):
        safety = tempfile.NamedTemporaryFile(suffix=".dump", delete=False)
        safety.write(b"safety")
        safety.close()
        ok = type("R", (), {"returncode": 0, "stderr": "", "stdout": ""})()
        with patch.object(restore_cmd, "validate_package", return_value=self._valid_validation("TRAINING")), \
             patch.object(restore_cmd, "subprocess") as mock_sp, \
             patch.object(restore_cmd.connection, "close"), \
             patch.object(restore_cmd, "read_manifest", return_value={"backup_file": safety.name}), \
             patch.object(restore_cmd.Command, "_pg_restore", return_value=ok):
            mock_sp.run.return_value = ok
            call_command("restore_backup", "/tmp/db.dump", "--confirm", "RESTORE", "--override", "OVERRIDE")
        self.assertTrue(RestoreHistory.objects.filter(result="success").exists())
        self.assertTrue(AuditEvent.objects.filter(action="backup_restored").exists())
        self.assertTrue(AuditEvent.objects.filter(action="environment_override").exists())

    def test_failed_restore_rolls_back(self):
        safety = tempfile.NamedTemporaryFile(suffix=".dump", delete=False)
        safety.write(b"safety")
        safety.close()
        fail = type("R", (), {"returncode": 1, "stderr": "boom", "stdout": ""})()
        ok = type("R", (), {"returncode": 0, "stderr": "", "stdout": ""})()
        # First _pg_restore (apply) fails; second (rollback) succeeds.
        with patch.object(restore_cmd, "validate_package", return_value=self._valid_validation("LIVE")), \
             patch.object(restore_cmd, "subprocess") as mock_sp, \
             patch.object(restore_cmd.connection, "close"), \
             patch.object(restore_cmd, "read_manifest", return_value={"backup_file": safety.name}), \
             patch.object(restore_cmd.Command, "_pg_restore", side_effect=[fail, ok]):
            mock_sp.run.return_value = ok
            with self.assertRaises(CommandError):
                call_command("restore_backup", "/tmp/db.dump", "--confirm", "RESTORE")
        self.assertTrue(RestoreHistory.objects.filter(result="rolled_back").exists())
        self.assertTrue(AuditEvent.objects.filter(action="restore_failed").exists())
