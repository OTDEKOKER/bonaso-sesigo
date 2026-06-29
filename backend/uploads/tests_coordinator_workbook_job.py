"""Tests for the async coordinator-workbook export job.

The coordinator reporting workbook fans out one sheet per sub-organisation plus
a cross-sheet TOTAL; for large coordinators the synchronous endpoint exceeds the
gateway timeout (~120s) and 502s. Generation now runs through the shared
background ExportJob worker (``run_coordinator_workbook_job``) so the HTTP
request returns immediately.

Like the aggregate export worker, the job carries no JWT — so these tests also
guard the training/live boundary: the persisted ``mode`` must be replayed so a
live-mode job can never build a training-project workbook (and vice-versa).
"""
from datetime import date
from pathlib import Path

from django.test import TestCase
from django.contrib.auth import get_user_model

from projects.models import Project
from organizations.models import Organization
from indicators.models import Indicator
from uploads.models import ExportJob
from uploads.jobs import run_coordinator_workbook_job

User = get_user_model()

# .xlsx is a zip; every valid workbook starts with the local-file-header magic.
XLSX_MAGIC = b"PK\x03\x04"


class CoordinatorWorkbookJobTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.admin = User.objects.create_user(
            username="cw_admin", password="x", is_superuser=True, is_staff=True
        )

        cls.live_proj = Project.objects.create(
            name="CW Live", code="CW-LIVE-P", status="active",
            start_date=date(2026, 1, 1), end_date=date(2026, 12, 31), is_training=False)
        cls.train_proj = Project.objects.create(
            name="CW Demo", code="CW-DEMO-P", status="active",
            start_date=date(2026, 1, 1), end_date=date(2026, 12, 31), is_training=True)

        # One coordinator org sits in both projects' scope and reports itself, so
        # the workbook has at least one data sheet (legacy fallback assigns every
        # project indicator to in-scope orgs).
        cls.coord = Organization.objects.create(name="CW Coord", code="CW-COORD", type="partner")
        cls.live_proj.organizations.add(cls.coord)
        cls.train_proj.organizations.add(cls.coord)

        cls.live_ind = Indicator.objects.create(name="CW Live Ind", code="CW-LIVE-IND", type="number")
        cls.demo_ind = Indicator.objects.create(name="CW Demo Ind", code="CW-DEMO-IND", type="number")
        cls.live_proj.indicators.add(cls.live_ind)
        cls.train_proj.indicators.add(cls.demo_ind)

    def _make_job(self, *, project, mode):
        return ExportJob.objects.create(
            job_type="coordinator_workbook",
            status="pending",
            parameters={
                "project": project.id,
                "coordinator": self.coord.id,
                "quarter": "1",
                "fiscal_year": 2026,
                "period_type": "quarter",
            },
            mode=mode,
            created_by=self.admin,
        )

    def test_live_job_produces_xlsx(self):
        job = self._make_job(project=self.live_proj, mode="live")
        run_coordinator_workbook_job(job.id)
        job.refresh_from_db()
        self.assertEqual(job.status, "completed", job.errors)
        self.assertTrue(job.file_name.endswith(".xlsx"), job.file_name)
        data = Path(job.output_file).read_bytes()
        self.assertTrue(data.startswith(XLSX_MAGIC))
        self.assertGreater(len(data), 0)

    def test_training_job_produces_xlsx(self):
        job = self._make_job(project=self.train_proj, mode="training")
        run_coordinator_workbook_job(job.id)
        job.refresh_from_db()
        self.assertEqual(job.status, "completed", job.errors)
        self.assertTrue(Path(job.output_file).read_bytes().startswith(XLSX_MAGIC))

    def test_live_mode_cannot_build_training_workbook(self):
        # The persisted mode is replayed to the tokenless worker; a live-mode job
        # must be refused at the training project's boundary, not silently built.
        job = self._make_job(project=self.train_proj, mode="live")
        run_coordinator_workbook_job(job.id)
        job.refresh_from_db()
        self.assertEqual(job.status, "failed")
        self.assertFalse(job.output_file)

    def test_training_mode_cannot_build_live_workbook(self):
        job = self._make_job(project=self.live_proj, mode="training")
        run_coordinator_workbook_job(job.id)
        job.refresh_from_db()
        self.assertEqual(job.status, "failed")
        self.assertFalse(job.output_file)
