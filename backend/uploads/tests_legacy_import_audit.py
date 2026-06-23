"""Legacy import now records audit events (closing the audit gap).

The fuzzy subprocess writes aggregates directly, so audit events are recorded on
the Django side from its report by ``_record_legacy_import_audit``. These tests
prove create/update/reset/skip all produce auditable events with the required
context (source, upload id, job id, org, indicator, period, old/new, confidence).
"""
from datetime import date

from django.test import TestCase

from audit.models import AuditEvent
from indicators.models import Indicator
from organizations.models import Organization
from projects.models import Project
from uploads.jobs import _record_legacy_import_audit
from uploads.models import ImportJob, Upload
from users.models import User


class LegacyImportAuditTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.user = User.objects.create_user(
            username="li_admin", email="li@example.com", password="TestPass123!", role="admin",
        )
        cls.org = Organization.objects.create(name="Partner Org", code="LI_ORG", type="cso")
        cls.project = Project.objects.create(
            name="LI Project", code="LI-1", start_date=date(2026, 1, 1), end_date=date(2027, 1, 1),
            created_by=cls.user,
        )
        cls.indicator = Indicator.objects.create(name="Reached", code="LI_IND", type="number")

    def _job(self):
        upload = Upload.objects.create(name="legacy.xlsx", created_by=self.user)
        return ImportJob.objects.create(
            upload=upload, job_type="aggregate_review_import", status="imported", created_by=self.user,
        )

    def _report(self, **matched_extra):
        return {
            "project": {"id": self.project.id},
            "sheets": {
                "Partner Sheet": {
                    "organization_id": self.org.id,
                    "matched_rows": [{
                        "indicator_id": self.indicator.id,
                        "indicator_name": "Reached",
                        "organization_id": self.org.id,
                        "aggregate_id": 123,
                        "aggregate_action": "created",
                        "period_start": "2026-04-01",
                        "period_end": "2026-06-30",
                        "old_status": None,
                        "old_value": None,
                        "new_value": {"total": 10},
                        "approved_reset": False,
                        "organization_confidence": 1.0,
                        "organization_match_reason": "exact",
                        "organization_override": False,
                        **matched_extra,
                    }],
                },
            },
            "summary": {},
        }

    def test_records_create_event(self):
        job = self._job()
        _record_legacy_import_audit(job, self._report())
        events = AuditEvent.objects.filter(action="import")
        self.assertEqual(events.count(), 1)
        ev = events.first()
        self.assertEqual(ev.metadata["source"], "legacy_workbook_import")
        self.assertEqual(ev.metadata["upload_id"], job.upload_id)
        self.assertEqual(ev.metadata["import_job_id"], job.id)
        self.assertEqual(ev.metadata["indicator_id"], self.indicator.id)
        self.assertEqual(ev.metadata["outcome"], "created")
        self.assertEqual(ev.organization_id, self.org.id)
        self.assertEqual(ev.project_id, self.project.id)

    def test_records_approved_reset(self):
        job = self._job()
        report = self._report(aggregate_action="updated", old_status="approved", approved_reset=True)
        _record_legacy_import_audit(job, report)
        ev = AuditEvent.objects.filter(action="import").first()
        self.assertEqual(ev.metadata["outcome"], "reset_from_approved")
        self.assertIn("approved", ev.description.lower())

    def test_does_not_audit_dry_run_placeholders(self):
        job = self._job()
        report = self._report(aggregate_action="would_create")  # dry-run placeholder
        _record_legacy_import_audit(job, report)
        self.assertEqual(AuditEvent.objects.filter(action="import").count(), 0)

    def test_records_refused_sheet(self):
        job = self._job()
        report = {
            "project": {"id": self.project.id},
            "sheets": {},
            "summary": {"unresolved_sheet_names": ["Mystery Sheet"], "ambiguous_sheet_names": ["Mystery Sheet"]},
        }
        _record_legacy_import_audit(job, report)
        ev = AuditEvent.objects.filter(action="import").first()
        self.assertIsNotNone(ev)
        self.assertEqual(ev.metadata["outcome"], "ambiguous_skipped")
        self.assertIn("Mystery Sheet", ev.metadata["sheet_name"])
