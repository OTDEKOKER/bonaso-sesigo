"""Tests for the admin backup management API + weekly reminder command."""
import json
from datetime import timedelta
from pathlib import Path
from unittest.mock import patch

from django.core import mail
from django.core.management import call_command
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from audit.models import AuditEvent
from core import backup_views
from organizations.models import Organization
from users.models import User


def _write_backup_fixture(tmp_dir: Path):
    tmp_dir.mkdir(parents=True, exist_ok=True)
    dump = tmp_dir / "bonasov1_db_20260616_000001.dump"
    dump.write_bytes(b"PGDMP-fake-dump-bytes")
    manifest = {
        "created_at_utc": "2026-06-16T00:00:05Z",
        "backup_file": str(dump),
        "size_bytes": dump.stat().st_size,
        "sha256": "deadbeef",
        "verify_status": "pg_restore_list_ok",
        "offsite_status": "not_configured",
    }
    (tmp_dir / "latest.json").write_text(json.dumps(manifest))
    return dump


class BackupApiTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.org = Organization.objects.create(name="HQ", code="BK_HQ", type="district")
        cls.admin = User.objects.create_user(
            username="bk_admin", email="bk_admin@example.com",
            password="TestPass123!", role="admin", organization=cls.org,
        )
        cls.officer = User.objects.create_user(
            username="bk_off", email="bk_off@example.com",
            password="TestPass123!", role="officer", organization=cls.org,
        )

    def setUp(self):
        from django.test import override_settings
        import tempfile
        self._tmp = tempfile.TemporaryDirectory()
        self._dir = Path(self._tmp.name)
        patcher = patch.object(backup_views, "_backup_dir", return_value=self._dir)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.addCleanup(self._tmp.cleanup)

    # --- permission gating --------------------------------------------------

    def test_status_requires_admin(self):
        self.client.force_authenticate(self.officer)
        self.assertEqual(self.client.get("/api/system/backups/status/").status_code, 403)

    def test_download_requires_admin(self):
        self.client.force_authenticate(self.officer)
        self.assertEqual(self.client.get("/api/system/backups/download/").status_code, 403)

    def test_generate_requires_admin(self):
        self.client.force_authenticate(self.officer)
        self.assertEqual(self.client.post("/api/system/backups/generate/").status_code, 403)

    # --- status payload -----------------------------------------------------

    def test_status_red_when_never_downloaded(self):
        _write_backup_fixture(self._dir)
        self.client.force_authenticate(self.admin)
        resp = self.client.get("/api/system/backups/status/")
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertTrue(body["latest"]["available"])
        self.assertEqual(body["latest"]["verify_status"], "pg_restore_list_ok")
        self.assertEqual(body["download"]["level"], "red")
        self.assertTrue(body["download"]["due"])
        self.assertIn("encrypted external drive", body["warning_text"])

    # --- download records audit + flips reminder to green -------------------

    def test_download_streams_file_and_records_audit(self):
        _write_backup_fixture(self._dir)
        self.client.force_authenticate(self.admin)
        resp = self.client.get("/api/system/backups/download/")
        self.assertEqual(resp.status_code, 200)
        self.assertIn("attachment", resp["Content-Disposition"])
        self.assertTrue(
            AuditEvent.objects.filter(action="backup_downloaded").exists()
        )
        # After a fresh download the reminder level is green / not due.
        state = self.client.get("/api/system/backups/status/").json()["download"]
        self.assertEqual(state["level"], "green")
        self.assertFalse(state["due"])

    def test_download_404_when_no_dump(self):
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.client.get("/api/system/backups/download/").status_code, 404)

    # --- generate runs script (mocked) + audits -----------------------------

    def test_generate_runs_script_and_audits(self):
        _write_backup_fixture(self._dir)
        self.client.force_authenticate(self.admin)
        with patch.object(backup_views.subprocess, "run") as mock_run:
            mock_run.return_value = type("R", (), {"returncode": 0, "stderr": "", "stdout": ""})()
            resp = self.client.post("/api/system/backups/generate/")
        self.assertEqual(resp.status_code, 200)
        mock_run.assert_called_once()
        self.assertTrue(AuditEvent.objects.filter(action="backup_generated").exists())


class BackupReminderLevelTests(APITestCase):
    def _make_download(self, days_ago):
        ev = AuditEvent.objects.create(action="backup_downloaded", object_type="backup")
        AuditEvent.objects.filter(id=ev.id).update(
            created_at=timezone.now() - timedelta(days=days_ago)
        )

    def test_levels(self):
        # never -> red
        _, days, level, due, _ = backup_views._download_state()
        self.assertEqual((days, level, due), (None, "red", True))
        # 3 days -> green
        self._make_download(3)
        _, days, level, due, _ = backup_views._download_state()
        self.assertEqual((level, due), ("green", False))

    def test_amber_band(self):
        self._make_download(9)
        _, days, level, due, _ = backup_views._download_state()
        self.assertEqual((level, due), ("amber", True))

    def test_red_band(self):
        self._make_download(20)
        _, days, level, due, _ = backup_views._download_state()
        self.assertEqual((level, due), ("red", True))


class BackupReminderCommandTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.org = Organization.objects.create(name="HQ2", code="BK_HQ2", type="district")
        cls.admin = User.objects.create_user(
            username="rm_admin", email="rm_admin@example.com",
            password="TestPass123!", role="admin", organization=cls.org,
        )

    def test_reminder_sent_and_audited_when_overdue(self):
        with self.settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend"):
            call_command("send_backup_download_reminder")
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn("rm_admin@example.com", mail.outbox[0].to)
        self.assertTrue(
            AuditEvent.objects.filter(action="backup_download_reminder_sent").exists()
        )
        # Reminder must never carry the backup as an attachment.
        self.assertEqual(mail.outbox[0].attachments, [])

    def test_no_reminder_when_recent_download(self):
        AuditEvent.objects.create(action="backup_downloaded", object_type="backup")
        with self.settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend"):
            call_command("send_backup_download_reminder")
        self.assertEqual(len(mail.outbox), 0)
        self.assertFalse(
            AuditEvent.objects.filter(action="backup_download_reminder_sent").exists()
        )
