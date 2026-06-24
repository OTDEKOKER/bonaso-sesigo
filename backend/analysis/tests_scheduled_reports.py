"""Tests for the scheduled-report execution engine."""
from datetime import date
from unittest.mock import patch

from django.core import mail
from django.test import TestCase, override_settings
from django.utils import timezone

from aggregates.models import Aggregate
from analysis import scheduled_reports as sr
from analysis.models import Report, ScheduledReport
from indicators.models import Indicator
from organizations.models import Organization
from projects.models import Project
from users.models import User


@override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
class ScheduledReportEngineTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.admin = User.objects.create_user(
            username="sr_admin", email="a@example.com", password="P!23456789", role="admin")
        cls.org = Organization.objects.create(name="Org", code="SR_ORG", type="cso")
        cls.live = Project.objects.create(name="Live", code="SR_L", start_date=date(2026, 1, 1),
                                          end_date=date(2027, 1, 1), is_training=False, created_by=cls.admin)
        cls.training = Project.objects.create(name="Train", code="SR_T", start_date=date(2026, 1, 1),
                                              end_date=date(2027, 1, 1), is_training=True, created_by=cls.admin)
        cls.ind = Indicator.objects.create(name="Reached", code="SR_IND", type="number")
        for proj, total in ((cls.live, 100), (cls.training, 999)):
            Aggregate.objects.create(indicator=cls.ind, project=proj, organization=cls.org,
                                     period_start=date(2026, 4, 1), period_end=date(2026, 6, 30),
                                     value={"total": total}, status="approved", created_by=cls.admin)

    def _schedule(self, **kw):
        defaults = dict(report_name="Weekly", report_type="indicator", frequency="weekly",
                        mode="live", recipients=["m@example.com"],
                        next_run=timezone.now() - timezone.timedelta(hours=1),
                        created_by=self.admin, parameters={})
        defaults.update(kw)
        return ScheduledReport.objects.create(**defaults)

    def test_due_schedules_only_returns_past_due_active(self):
        due = self._schedule()
        self._schedule(report_name="Future", next_run=timezone.now() + timezone.timedelta(days=1))
        self._schedule(report_name="Inactive", is_active=False)
        ids = {s.id for s in sr.due_schedules()}
        self.assertEqual(ids, {due.id})

    def test_run_success_emails_advances_and_snapshots(self):
        s = self._schedule()
        before = s.next_run
        out = sr.run_one(s)
        self.assertEqual(out["status"], "success")
        self.assertEqual(out["rows"], 1)
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn("Reached", mail.outbox[0].attachments[0][1])  # CSV body
        s.refresh_from_db()
        self.assertEqual(s.last_status, "success")
        self.assertGreater(s.next_run, before)
        self.assertTrue(Report.objects.filter(name="[Scheduled] Weekly").exists())

    def test_environment_isolation_training_excludes_live(self):
        s = self._schedule(mode="training")
        rows = sr.generate_rows(s)
        # Only the training aggregate (999), never the live one (100).
        self.assertEqual(rows[0]["total_value"], 999.0)

    def test_failure_retries_then_backs_off(self):
        s = self._schedule()
        first_next = s.next_run
        with patch.object(sr, "deliver", side_effect=RuntimeError("smtp down")):
            r1 = sr.run_one(s); s.refresh_from_db()
            self.assertEqual(r1["status"], "failed")
            self.assertTrue(r1["will_retry"])
            self.assertEqual(s.consecutive_failures, 1)
            self.assertEqual(s.next_run, first_next)  # not advanced → retries next tick
            sr.run_one(s); s.refresh_from_db()
            r3 = sr.run_one(s); s.refresh_from_db()
        self.assertEqual(s.consecutive_failures, 3)
        self.assertFalse(r3["will_retry"])
        self.assertGreater(s.next_run, first_next)  # backed off after MAX_RETRIES

    def test_next_run_frequencies(self):
        now = timezone.now()
        self.assertEqual((sr._next_run_after(now, "daily") - now).days, 1)
        self.assertEqual((sr._next_run_after(now, "weekly") - now).days, 7)
        self.assertEqual((sr._next_run_after(now, "monthly") - now).days, 30)

    def test_run_due_summary(self):
        self._schedule()
        summary = sr.run_due()
        self.assertEqual(summary["ran"], 1)
        self.assertEqual(summary["succeeded"], 1)
