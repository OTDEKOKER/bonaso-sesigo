"""Regression tests for audit finding S-1: async export environment isolation.

The background aggregate-export worker rebuilds the request with
``force_authenticate(user=...)`` and therefore carries no JWT. Since the signed
``mode`` claim is the sole source of truth for training/live isolation, the
worker used to default to LIVE regardless of the caller — so a training-mode
user's export silently contained live aggregates. The fix persists the caller's
mode on the ExportJob and replays it to the worker via the forced-auth token.
"""
from datetime import date
from pathlib import Path

from django.test import TestCase
from django.contrib.auth import get_user_model

from projects.models import Project
from organizations.models import Organization
from indicators.models import Indicator
from aggregates.models import Aggregate
from uploads.models import ExportJob
from uploads.jobs import run_aggregate_export_job

User = get_user_model()


class ExportTrainingIsolationTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.admin = User.objects.create_user(
            username="exp_admin", password="x", is_superuser=True, is_staff=True
        )

        cls.live_proj = Project.objects.create(
            name="Live P", code="EXP-LIVE-P", status="active",
            start_date=date(2026, 1, 1), end_date=date(2026, 12, 31), is_training=False)
        cls.train_proj = Project.objects.create(
            name="Demo P", code="EXP-DEMO-P", status="active",
            start_date=date(2026, 1, 1), end_date=date(2026, 12, 31), is_training=True)

        cls.org = Organization.objects.create(name="Exp Org", code="EXP-ORG", type="partner")
        cls.live_proj.organizations.add(cls.org)
        cls.train_proj.organizations.add(cls.org)

        cls.live_ind = Indicator.objects.create(name="Live Ind", code="EXP-LIVE-IND", type="number")
        cls.demo_ind = Indicator.objects.create(name="Demo Ind", code="EXP-DEMO-IND", type="number")
        cls.live_proj.indicators.add(cls.live_ind)
        cls.train_proj.indicators.add(cls.demo_ind)

        Aggregate.objects.create(
            indicator=cls.live_ind, project=cls.live_proj, organization=cls.org,
            period_start=date(2026, 1, 1), period_end=date(2026, 3, 31),
            value={"total": 111}, status="approved")
        Aggregate.objects.create(
            indicator=cls.demo_ind, project=cls.train_proj, organization=cls.org,
            period_start=date(2026, 1, 1), period_end=date(2026, 3, 31),
            value={"total": 555}, status="approved")

    def _run(self, mode):
        job = ExportJob.objects.create(
            job_type="aggregate_export", status="pending",
            parameters={"file_format": "csv"}, mode=mode, created_by=self.admin,
        )
        run_aggregate_export_job(job.id)
        job.refresh_from_db()
        self.assertEqual(job.status, "completed", job.errors)
        return Path(job.output_file).read_text()

    def test_training_export_excludes_live_data(self):
        body = self._run("training")
        # The training export must contain ONLY the training aggregate.
        self.assertIn("EXP-DEMO-IND", body)
        self.assertNotIn("EXP-LIVE-IND", body)
        self.assertIn("555", body)
        self.assertNotIn("111", body)

    def test_live_export_excludes_training_data(self):
        body = self._run("live")
        self.assertIn("EXP-LIVE-IND", body)
        self.assertNotIn("EXP-DEMO-IND", body)
        self.assertIn("111", body)
        self.assertNotIn("555", body)
