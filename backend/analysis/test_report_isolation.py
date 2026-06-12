"""Environment isolation for saved analysis artifacts (Report/ScheduledReport/
SavedQuery), which carry a direct ``mode`` field instead of a project FK."""
from datetime import timedelta

from django.utils import timezone
from rest_framework.test import APITestCase
from rest_framework_simplejwt.tokens import AccessToken

from organizations.models import Organization
from analysis.models import Report, ScheduledReport, SavedQuery
from users.models import User


class ReportModeIsolationTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.org = Organization.objects.create(name="Org R", code="ORG_R", type="district")
        cls.admin = User.objects.create_user(
            username="rep_admin", password="x", is_superuser=True, is_staff=True, role="admin",
        )
        cls.live_report = Report.objects.create(name="Live Report", organization=cls.org, mode="live")
        cls.train_report = Report.objects.create(name="Train Report", organization=cls.org, mode="training")
        cls.live_sched = ScheduledReport.objects.create(
            report_name="Live Sched", frequency="weekly", next_run=timezone.now() + timedelta(days=1),
            created_by=cls.admin, mode="live",
        )
        cls.train_sched = ScheduledReport.objects.create(
            report_name="Train Sched", frequency="weekly", next_run=timezone.now() + timedelta(days=1),
            created_by=cls.admin, mode="training",
        )

    def _auth(self, mode=None):
        token = None
        if mode is not None:
            token = AccessToken.for_user(self.admin)
            token["mode"] = mode
        self.client.force_authenticate(self.admin, token=token)

    # ---- Report list -----------------------------------------------------
    def test_live_report_list_hides_training(self):
        self._auth(mode="live")
        ids = {r["id"] for r in self.client.get("/api/analysis/reports/").data["results"]}
        self.assertIn(self.live_report.id, ids)
        self.assertNotIn(self.train_report.id, ids)

    def test_training_report_list_hides_live(self):
        self._auth(mode="training")
        ids = {r["id"] for r in self.client.get("/api/analysis/reports/").data["results"]}
        self.assertIn(self.train_report.id, ids)
        self.assertNotIn(self.live_report.id, ids)

    def test_no_claim_defaults_to_live(self):
        self._auth(mode=None)
        ids = {r["id"] for r in self.client.get("/api/analysis/reports/").data["results"]}
        self.assertIn(self.live_report.id, ids)
        self.assertNotIn(self.train_report.id, ids)

    # ---- Report detail / download ---------------------------------------
    def test_live_cannot_retrieve_training_report(self):
        self._auth(mode="live")
        self.assertEqual(self.client.get(f"/api/analysis/reports/{self.train_report.id}/").status_code, 404)

    def test_live_cannot_download_training_report(self):
        self._auth(mode="live")
        self.assertEqual(
            self.client.get(f"/api/analysis/reports/{self.train_report.id}/download/").status_code, 404
        )

    # ---- create stamps mode from the token ------------------------------
    def test_create_in_training_stamps_training(self):
        self._auth(mode="training")
        resp = self.client.post(
            "/api/analysis/reports/", {"name": "New T", "report_type": "custom"}, format="json"
        )
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(Report.objects.get(id=resp.data["id"]).mode, "training")

    def test_create_in_live_stamps_live(self):
        self._auth(mode="live")
        resp = self.client.post(
            "/api/analysis/reports/", {"name": "New L", "report_type": "custom"}, format="json"
        )
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(Report.objects.get(id=resp.data["id"]).mode, "live")

    # ---- ScheduledReport -------------------------------------------------
    def test_scheduled_report_isolated(self):
        self._auth(mode="live")
        live_ids = {r["id"] for r in self.client.get("/api/analysis/scheduled-reports/").data["results"]}
        self.assertIn(self.live_sched.id, live_ids)
        self.assertNotIn(self.train_sched.id, live_ids)

    # ---- admin include_training opt-in sees both ------------------------
    def test_admin_include_training_sees_both(self):
        self._auth(mode="live")
        ids = {
            r["id"]
            for r in self.client.get("/api/analysis/reports/?include_training=true").data["results"]
        }
        self.assertIn(self.live_report.id, ids)
        self.assertIn(self.train_report.id, ids)
