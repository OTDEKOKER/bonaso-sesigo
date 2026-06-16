"""Tests for the System Status issue drill-down."""
from unittest.mock import patch

from rest_framework.test import APITestCase

from organizations.models import Organization
from system_status import checks
from system_status.models import SystemIssueAck
from users.models import User

FAKE_PARITY = {
    "generated_at": "2026-06-15T23:32:37",
    "project": {"code": "NAHPA2025/26", "name": "NAHPA Social Contracting"},
    "summary": {
        "orgs_checked": 18, "payloads_compared": 497, "payload_mismatches": 2,
        "missing_in_db": 0, "missing_in_workbook": 0,
    },
    "orgs": [
        {"org": "APSA", "workbook": "/imp/APSA.xlsx", "payload_mismatches": 2,
         "missing_in_db": 0, "missing_in_workbook": 0},
        {"org": "BOSASNet", "workbook": "/imp/BOSASNET.xlsx", "payload_mismatches": 0,
         "missing_in_db": 0, "missing_in_workbook": 0},
    ],
    "diff_sample": [
        {"org": "APSA", "quarter": "Q3", "indicator_id": 366, "indicator_name": "Demand creation", "type": "payload_mismatch"},
        {"org": "APSA", "quarter": "Q4", "indicator_id": 366, "indicator_name": "Demand creation", "type": "payload_mismatch"},
    ],
}


class _FakeFile:
    name = "parity_20260616_013001.json"


class BuildIssuesTests(APITestCase):
    def test_parity_issue_shape_and_metrics(self):
        with patch.object(checks, "_parity_report", return_value=(_FakeFile(), FAKE_PARITY)):
            issues = checks.build_issues({"parity": {"status": "warning"}})
        self.assertEqual(len(issues), 1)
        issue = issues[0]
        self.assertEqual(issue["id"], "parity-latest")
        self.assertEqual(issue["component"], "parity_checks")
        self.assertEqual(issue["severity"], "warning")
        self.assertEqual(issue["status"], "open")
        self.assertIn("mismatch", issue["message"])
        self.assertEqual(issue["metrics"]["difference_count"], 2)
        self.assertEqual(issue["metrics"]["affected_organizations"], 1)  # only APSA
        self.assertEqual(issue["metrics"]["affected_indicators"], 1)
        self.assertTrue(issue["links"]["download_csv"])
        self.assertEqual(len(issue["detail"]["mismatch_rows"]), 2)

    def test_parity_csv_rows(self):
        with patch.object(checks, "_parity_report", return_value=(_FakeFile(), FAKE_PARITY)):
            issue = checks.build_issues({"parity": {"status": "warning"}})[0]
        header, rows = checks.parity_csv_rows(issue)
        self.assertEqual(header[0], "organization")
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0][0], "APSA")

    def test_other_components_become_issues(self):
        payload = {
            "parity": {"status": "ok"},
            "backup": {"status": "missing", "manifest": {}},
            "disk": {"status": "warning", "used_percent": 88},
            "database": {"status": "ok"},
            "import_jobs": {"failed": 3},
        }
        issues = checks.build_issues(payload)
        by_id = {i["id"]: i for i in issues}
        self.assertIn("backup-health", by_id)
        self.assertIn("disk-usage", by_id)
        self.assertIn("imports-failed", by_id)
        self.assertEqual(by_id["backup-health"]["severity"], "problem")
        self.assertEqual(by_id["imports-failed"]["related_module"], "/uploads/imports")

    def test_overall_from_issues(self):
        self.assertEqual(checks.overall_from_issues([], "ok"), "ok")
        warn = [{"severity": "warning", "status": "open"}]
        self.assertEqual(checks.overall_from_issues(warn, "x"), "warning")
        crit = [{"severity": "critical", "status": "open"}]
        self.assertEqual(checks.overall_from_issues(crit, "x"), "error")
        # Resolved issues clear the overall status.
        resolved = [{"severity": "critical", "status": "resolved"}]
        self.assertEqual(checks.overall_from_issues(resolved, "x"), "ok")


class IssueEndpointTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.org = Organization.objects.create(name="HQ", code="SS_HQ", type="district")
        cls.admin = User.objects.create_user(
            username="ss_admin", email="ss_admin@example.com",
            password="TestPass123!", role="admin", organization=cls.org,
        )
        cls.officer = User.objects.create_user(
            username="ss_off", email="ss_off@example.com",
            password="TestPass123!", role="officer", organization=cls.org,
        )

    def _issue(self):
        with patch.object(checks, "_parity_report", return_value=(_FakeFile(), FAKE_PARITY)):
            return checks.build_issues({"parity": {"status": "warning"}})[0]

    def test_detail_requires_admin(self):
        self.client.force_authenticate(self.officer)
        self.assertEqual(self.client.get("/api/system/status/issues/parity-latest/").status_code, 403)

    def test_detail_returns_issue(self):
        issue = self._issue()
        self.client.force_authenticate(self.admin)
        with patch("system_status.views.find_issue", return_value=issue):
            resp = self.client.get("/api/system/status/issues/parity-latest/")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["id"], "parity-latest")

    def test_detail_404_for_unknown(self):
        self.client.force_authenticate(self.admin)
        with patch("system_status.views.find_issue", return_value=None):
            resp = self.client.get("/api/system/status/issues/nope/")
        self.assertEqual(resp.status_code, 404)

    def test_csv_download(self):
        issue = self._issue()
        self.client.force_authenticate(self.admin)
        with patch("system_status.views.find_issue", return_value=issue):
            resp = self.client.get("/api/system/status/issues/parity-latest/download/")
        self.assertEqual(resp.status_code, 200)
        self.assertIn("text/csv", resp["Content-Type"])
        self.assertIn("APSA", resp.content.decode())

    def test_ack_persists_and_clears(self):
        issue = self._issue()
        self.client.force_authenticate(self.admin)
        with patch("system_status.views.find_issue", return_value=issue):
            resp = self.client.post(
                "/api/system/status/issues/parity-latest/ack/",
                {"status": "resolved", "note": "corrected in workbook"}, format="json",
            )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["status"], "resolved")
        ack = SystemIssueAck.objects.get(issue_key="parity-latest", fingerprint=issue["fingerprint"])
        self.assertEqual(ack.status, "resolved")
        # A fresh build now reflects the resolved status (same fingerprint).
        with patch.object(checks, "_parity_report", return_value=(_FakeFile(), FAKE_PARITY)):
            rebuilt = checks.build_issues({"parity": {"status": "warning"}})[0]
        self.assertEqual(rebuilt["status"], "resolved")
        self.assertEqual(checks.overall_from_issues([rebuilt], "x"), "ok")

    def test_ack_rejects_bad_status(self):
        issue = self._issue()
        self.client.force_authenticate(self.admin)
        with patch("system_status.views.find_issue", return_value=issue):
            resp = self.client.post(
                "/api/system/status/issues/parity-latest/ack/",
                {"status": "bogus"}, format="json",
            )
        self.assertEqual(resp.status_code, 400)

    def test_rerun_unknown_issue_rejected(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.post("/api/system/status/issues/disk-usage/rerun/")
        self.assertEqual(resp.status_code, 400)
