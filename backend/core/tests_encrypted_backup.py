"""Tests for the encrypted off-site backup download endpoint.

Covers: admin-only access, account-password re-confirmation, encryption-password
strength, successful end-to-end encryption (the streamed file decrypts back to a
tar containing the dump), audit logging, and temp-file cleanup.
"""
import shutil
import subprocess
import tarfile
import tempfile
from pathlib import Path
from unittest import mock

from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from audit.models import AuditEvent

User = get_user_model()

URL = "/api/system/backups/encrypted-download/"
GOOD_PW = "correct horse battery"  # >= 12 chars


class EncryptedBackupDownloadTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.admin = User.objects.create_user(
            username="bk_admin", email="bk_admin@example.com",
            password="adminpass123", is_superuser=True, is_staff=True
        )
        cls.officer = User.objects.create_user(
            username="bk_officer", email="bk_officer@example.com",
            password="officerpass123", role="officer"
        )

    def setUp(self):
        # ScopedRateThrottle ('backup' = 6/hour) shares the process cache across
        # tests; clear it so each test starts with a fresh rate budget.
        from django.core.cache import cache
        cache.clear()
        # A throwaway dump file standing in for a real pg_dump output.
        self.tmp = Path(tempfile.mkdtemp(prefix="enc_bk_test_"))
        self.dump = self.tmp / "bonasov1_db_TEST.dump"
        self.dump.write_bytes(b"PGDMP fake custom-format dump payload\n" * 100)
        self.manifest = {"created_at_utc": "2026-06-17T00:00:00Z", "backup_file": str(self.dump)}
        self._patches = [
            mock.patch("core.backup_views._latest_manifest", return_value=self.manifest),
            mock.patch("core.backup_views._resolve_dump_path", return_value=self.dump),
            mock.patch("core.backup_views._resolve_asset_path", return_value=None),
        ]
        for p in self._patches:
            p.start()

    def tearDown(self):
        for p in self._patches:
            p.stop()
        shutil.rmtree(self.tmp, ignore_errors=True)

    @staticmethod
    def _drain(resp):
        """Consume a streaming response and run its temp-cleanup closers without
        calling resp.close() (which would fire request_finished and drop the
        test DB connection)."""
        blob = b"".join(resp.streaming_content)
        for closer in list(getattr(resp, "_resource_closers", [])):
            closer()
        resp._resource_closers = []
        return blob

    def test_non_admin_denied(self):
        self.client.force_authenticate(self.officer)
        resp = self.client.post(URL, {"account_password": "officerpass123", "encryption_password": GOOD_PW})
        self.assertEqual(resp.status_code, 403)

    def test_unauthenticated_denied(self):
        resp = self.client.post(URL, {"account_password": "x", "encryption_password": GOOD_PW})
        self.assertIn(resp.status_code, (401, 403))

    def test_wrong_account_password_denied(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.post(URL, {"account_password": "WRONG", "encryption_password": GOOD_PW})
        self.assertEqual(resp.status_code, 403)

    def test_short_encryption_password_rejected(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.post(URL, {"account_password": "adminpass123", "encryption_password": "short"})
        self.assertEqual(resp.status_code, 400)

    def test_admin_can_generate_encrypted_backup_and_it_decrypts(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.post(URL, {"account_password": "adminpass123", "encryption_password": GOOD_PW})
        self.assertEqual(resp.status_code, 200, getattr(resp, "data", None))
        blob = self._drain(resp)
        self.assertTrue(blob)

        # The streamed bytes must decrypt with the same password back to a tar
        # that contains the original dump.
        work = Path(tempfile.mkdtemp(prefix="enc_bk_verify_"))
        try:
            enc = work / "out.tar.gz.enc"
            dec = work / "out.tar.gz"
            enc.write_bytes(blob)
            subprocess.run(
                ["openssl", "enc", "-d", "-aes-256-cbc", "-pbkdf2", "-iter", "200000",
                 "-in", str(enc), "-out", str(dec), "-pass", f"pass:{GOOD_PW}"],
                check=True, capture_output=True,
            )
            with tarfile.open(dec, "r:gz") as tar:
                names = tar.getnames()
            self.assertIn(self.dump.name, names)
            self.assertIn("RESTORE_README.txt", names)
        finally:
            shutil.rmtree(work, ignore_errors=True)

    def test_wrong_password_does_not_decrypt(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.post(URL, {"account_password": "adminpass123", "encryption_password": GOOD_PW})
        blob = self._drain(resp)
        work = Path(tempfile.mkdtemp(prefix="enc_bk_bad_"))
        try:
            enc = work / "out.enc"
            enc.write_bytes(blob)
            proc = subprocess.run(
                ["openssl", "enc", "-d", "-aes-256-cbc", "-pbkdf2", "-iter", "200000",
                 "-in", str(enc), "-out", str(work / "out.tar.gz"), "-pass", "pass:THE_WRONG_PASSWORD"],
                capture_output=True,
            )
            self.assertNotEqual(proc.returncode, 0)  # bad password fails to decrypt
        finally:
            shutil.rmtree(work, ignore_errors=True)

    def test_audit_event_recorded_on_success(self):
        self.client.force_authenticate(self.admin)
        before = AuditEvent.objects.filter(action="backup_downloaded").count()
        resp = self.client.post(URL, {"account_password": "adminpass123", "encryption_password": GOOD_PW})
        self._drain(resp)
        events = AuditEvent.objects.filter(action="backup_downloaded").order_by("-created_at")
        self.assertEqual(events.count(), before + 1)
        ev = events.first()
        self.assertTrue(ev.metadata.get("encrypted"))
        self.assertEqual(ev.metadata.get("outcome"), "ok")
        # The encryption password must never be persisted anywhere on the event.
        self.assertNotIn(GOOD_PW, str(ev.metadata))
        self.assertNotIn(GOOD_PW, ev.description)

    def test_no_temp_files_leak_after_success(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.post(URL, {"account_password": "adminpass123", "encryption_password": GOOD_PW})
        self._drain(resp)
        leftovers = list(Path(tempfile.gettempdir()).glob("sesigo_enc_bk_*"))
        self.assertEqual(leftovers, [], f"temp dirs not cleaned: {leftovers}")
