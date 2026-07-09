"""Tests for the Quarterly Reporting Control Framework.

Covers the shared reporting-window service (all decision states), the
``ReportingPeriod`` model invariants, backward-compatibility with the always-on
quarter-completion floor, the central write-path enforcement (single / bulk /
workbook share one choke-point), the admin lifecycle API + audit trail, the
progress snapshot, and the superuser emergency override.
"""
from datetime import date, timedelta

from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from aggregates import reporting_control as rc
from aggregates.models import Aggregate, ReportingPeriod
from audit.models import AuditEvent
from indicators.models import Indicator
from organizations.models import Organization
from projects.models import (
    Project, ProjectIndicator, ProjectIndicatorAssignment, ProjectOrganization,
)
from users.models import User

# An elapsed fiscal quarter (Q1 FY2024 = Apr-Jun 2024) — safely in the past for
# every real "today", so the quarter-completion floor is satisfied.
ELAPSED_FY, ELAPSED_Q = 2024, 1
ELAPSED_START, ELAPSED_END = date(2024, 4, 1), date(2024, 6, 30)
# A quarter that has NOT elapsed (far future).
FUTURE_FY, FUTURE_Q = 2099, 2
FUTURE_START, FUTURE_END = date(2099, 7, 1), date(2099, 9, 30)


class ReportingBase(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.org = Organization.objects.create(name="Org", code="RC_ORG", type="cso")
        cls.admin = User.objects.create_user(
            username="rc_admin", email="rc_admin@example.com",
            password="TestPass123!", role="admin", organization=cls.org,
        )
        cls.officer = User.objects.create_user(
            username="rc_officer", email="rc_officer@example.com",
            password="TestPass123!", role="officer", organization=cls.org,
        )
        cls.project = Project.objects.create(
            name="RC Project", code="RC-1", status="active",
            start_date=date(2024, 1, 1), end_date=date(2099, 12, 31),
            created_by=cls.admin,
        )
        cls.project.organizations.add(cls.org)
        cls.indicator = Indicator.objects.create(
            name="Reached", code="RC_IND", type="number",
            category="hiv_prevention", created_by=cls.admin,
        )
        cls.pi = ProjectIndicator.objects.create(project=cls.project, indicator=cls.indicator)

    def _period(self, *, status_value, fy=ELAPSED_FY, quarter=ELAPSED_Q, **kwargs):
        return ReportingPeriod.objects.create(
            project=self.project, fiscal_year=fy, quarter=quarter,
            status=status_value, created_by=self.admin, **kwargs,
        )


# ── Service decision matrix ──────────────────────────────────────────────────
class WindowEvaluationTests(ReportingBase):
    def test_no_period_elapsed_quarter_is_open_by_default(self):
        d = rc.evaluate_window(self.project, ELAPSED_START, ELAPSED_END)
        self.assertTrue(d.can_submit)
        self.assertEqual(d.state, rc.STATE_OPEN_DEFAULT)

    def test_no_period_future_quarter_is_blocked_by_floor(self):
        d = rc.evaluate_window(self.project, FUTURE_START, FUTURE_END)
        self.assertFalse(d.can_submit)
        self.assertEqual(d.state, rc.STATE_NOT_ELAPSED)

    def test_draft_period_blocks(self):
        self._period(status_value=ReportingPeriod.STATUS_DRAFT)
        d = rc.evaluate_window(self.project, ELAPSED_START, ELAPSED_END)
        self.assertFalse(d.can_submit)
        self.assertEqual(d.state, rc.STATE_DRAFT)

    def test_scheduled_period_blocks(self):
        self._period(status_value=ReportingPeriod.STATUS_SCHEDULED)
        d = rc.evaluate_window(self.project, ELAPSED_START, ELAPSED_END)
        self.assertEqual(d.state, rc.STATE_SCHEDULED)
        self.assertFalse(d.can_submit)

    def test_open_period_allows(self):
        now = timezone.now()
        self._period(
            status_value=ReportingPeriod.STATUS_OPEN,
            submission_opens=now - timedelta(days=1),
            submission_closes=now + timedelta(days=10),
        )
        d = rc.evaluate_window(self.project, ELAPSED_START, ELAPSED_END, now=now)
        self.assertTrue(d.can_submit)
        self.assertEqual(d.state, rc.STATE_OPEN)

    def test_open_but_before_announced_open_is_scheduled(self):
        now = timezone.now()
        self._period(
            status_value=ReportingPeriod.STATUS_OPEN,
            submission_opens=now + timedelta(days=2),
            submission_closes=now + timedelta(days=10),
        )
        d = rc.evaluate_window(self.project, ELAPSED_START, ELAPSED_END, now=now)
        self.assertFalse(d.can_submit)
        self.assertEqual(d.state, rc.STATE_SCHEDULED)

    def test_open_past_deadline_without_late_is_closed(self):
        now = timezone.now()
        self._period(
            status_value=ReportingPeriod.STATUS_OPEN,
            submission_opens=now - timedelta(days=10),
            submission_closes=now - timedelta(days=1),
        )
        d = rc.evaluate_window(self.project, ELAPSED_START, ELAPSED_END, now=now)
        self.assertFalse(d.can_submit)
        self.assertEqual(d.state, rc.STATE_CLOSED)

    def test_late_reporting_reopens_after_deadline(self):
        now = timezone.now()
        self._period(
            status_value=ReportingPeriod.STATUS_OPEN,
            submission_opens=now - timedelta(days=10),
            submission_closes=now - timedelta(days=2),
            allow_late_reporting=True,
            late_reporting_opens=now - timedelta(days=2),
            late_reporting_closes=now + timedelta(days=5),
        )
        d = rc.evaluate_window(self.project, ELAPSED_START, ELAPSED_END, now=now)
        self.assertTrue(d.can_submit)
        self.assertEqual(d.state, rc.STATE_LATE)
        self.assertTrue(d.is_late)

    def test_closed_status_blocks(self):
        self._period(status_value=ReportingPeriod.STATUS_CLOSED)
        d = rc.evaluate_window(self.project, ELAPSED_START, ELAPSED_END)
        self.assertEqual(d.state, rc.STATE_CLOSED)
        self.assertFalse(d.can_submit)

    def test_archived_status_blocks(self):
        self._period(status_value=ReportingPeriod.STATUS_ARCHIVED)
        d = rc.evaluate_window(self.project, ELAPSED_START, ELAPSED_END)
        self.assertEqual(d.state, rc.STATE_ARCHIVED)
        self.assertFalse(d.can_submit)

    def test_configured_open_period_still_blocked_before_quarter_elapses(self):
        # Even an "open" future period is blocked by the quarter-completion floor.
        p = self._period(status_value=ReportingPeriod.STATUS_OPEN,
                         fy=FUTURE_FY, quarter=FUTURE_Q)
        d = rc.evaluate_window(self.project, FUTURE_START, FUTURE_END)
        self.assertFalse(d.can_submit)
        self.assertEqual(d.state, rc.STATE_NOT_ELAPSED)
        self.assertEqual(d.period_id, p.id)


# ── Model invariants ─────────────────────────────────────────────────────────
class ReportingPeriodModelTests(ReportingBase):
    def test_coverage_is_derived_from_quarter(self):
        p = self._period(status_value=ReportingPeriod.STATUS_DRAFT)
        self.assertEqual((p.coverage_start, p.coverage_end), (ELAPSED_START, ELAPSED_END))

    def test_unique_per_project_quarter(self):
        self._period(status_value=ReportingPeriod.STATUS_DRAFT)
        from django.db import IntegrityError
        with self.assertRaises(IntegrityError):
            self._period(status_value=ReportingPeriod.STATUS_OPEN)

    def test_cannot_open_before_quarter_elapses_via_clean(self):
        from django.core.exceptions import ValidationError as DjangoValidationError
        p = ReportingPeriod(
            project=self.project, fiscal_year=FUTURE_FY, quarter=FUTURE_Q,
            status=ReportingPeriod.STATUS_OPEN,
            submission_opens=timezone.now(),
        )
        p.coverage_start, p.coverage_end = p._expected_coverage()
        with self.assertRaises(DjangoValidationError):
            p.clean()


# ── Central write-path enforcement (API) ─────────────────────────────────────
class WritePathEnforcementTests(ReportingBase):
    def _submit(self, user, period_start, period_end, **extra):
        self.client.force_authenticate(user)
        payload = {
            "indicator": self.indicator.id, "project": self.project.id,
            "organization": self.org.id,
            "period_start": period_start.isoformat(), "period_end": period_end.isoformat(),
            "value": {"total": 7}, **extra,
        }
        return self.client.post("/api/aggregates/", payload, format="json")

    def test_submit_blocked_when_period_draft(self):
        self._period(status_value=ReportingPeriod.STATUS_DRAFT)
        resp = self._submit(self.officer, ELAPSED_START, ELAPSED_END)
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(Aggregate.objects.count(), 0)

    def test_submit_allowed_when_period_open(self):
        now = timezone.now()
        self._period(
            status_value=ReportingPeriod.STATUS_OPEN,
            submission_opens=now - timedelta(days=1),
            submission_closes=now + timedelta(days=10),
        )
        resp = self._submit(self.officer, ELAPSED_START, ELAPSED_END)
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertEqual(Aggregate.objects.count(), 1)

    def test_submit_allowed_when_no_period_and_quarter_elapsed(self):
        # Backward compatibility: no period configured → floor only.
        resp = self._submit(self.officer, ELAPSED_START, ELAPSED_END)
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)

    def test_editing_existing_row_not_blocked_by_closed_window(self):
        # An existing row (e.g. workbook already downloaded, or admin backfill)
        # can still be corrected even once the window is closed.
        agg = Aggregate.objects.create(
            indicator=self.indicator, project=self.project, organization=self.org,
            period_start=ELAPSED_START, period_end=ELAPSED_END,
            value={"total": 1}, status="pending", created_by=self.officer,
        )
        self._period(status_value=ReportingPeriod.STATUS_CLOSED)
        resp = self._submit(self.officer, ELAPSED_START, ELAPSED_END, value={"total": 99})
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        agg.refresh_from_db()
        self.assertEqual(agg.value, {"total": 99})

    def test_superuser_override_blocked_window(self):
        su = User.objects.create_superuser(
            username="rc_su", email="rc_su@example.com", password="TestPass123!",
        )
        self._period(status_value=ReportingPeriod.STATUS_DRAFT)
        resp = self._submit(su, ELAPSED_START, ELAPSED_END, allow_early_reporting=True)
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertTrue(
            AuditEvent.objects.filter(action="reporting_window_override").exists()
        )


# ── Admin lifecycle API + audit ──────────────────────────────────────────────
class AdminLifecycleTests(ReportingBase):
    def setUp(self):
        self.client.force_authenticate(self.admin)

    def test_non_admin_cannot_manage(self):
        self.client.force_authenticate(self.officer)
        resp = self.client.get("/api/aggregates/reporting-periods/")
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_create_and_open_and_close_audits(self):
        resp = self.client.post("/api/aggregates/reporting-periods/", {
            "project": self.project.id, "fiscal_year": ELAPSED_FY, "quarter": ELAPSED_Q,
        }, format="json")
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        pid = resp.data["id"]
        self.assertTrue(AuditEvent.objects.filter(action="reporting_period_created").exists())

        now = timezone.now()
        resp = self.client.post(f"/api/aggregates/reporting-periods/{pid}/open/", {
            "submission_opens": (now - timedelta(days=1)).isoformat(),
            "submission_closes": (now + timedelta(days=10)).isoformat(),
        }, format="json")
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.assertEqual(resp.data["status"], "open")
        self.assertTrue(AuditEvent.objects.filter(action="reporting_opened").exists())

        resp = self.client.post(f"/api/aggregates/reporting-periods/{pid}/close/",
                                {"reason": "quarter done"}, format="json")
        self.assertEqual(resp.data["status"], "closed")
        self.assertTrue(AuditEvent.objects.filter(action="reporting_closed").exists())

    def test_cannot_open_future_quarter(self):
        resp = self.client.post("/api/aggregates/reporting-periods/", {
            "project": self.project.id, "fiscal_year": FUTURE_FY, "quarter": FUTURE_Q,
        }, format="json")
        pid = resp.data["id"]
        resp = self.client.post(f"/api/aggregates/reporting-periods/{pid}/open/", {}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_enable_and_disable_late(self):
        p = self._period(status_value=ReportingPeriod.STATUS_CLOSED)
        now = timezone.now()
        resp = self.client.post(f"/api/aggregates/reporting-periods/{p.id}/enable-late/", {
            "late_reporting_opens": now.isoformat(),
            "late_reporting_closes": (now + timedelta(days=5)).isoformat(),
        }, format="json")
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.assertTrue(resp.data["allow_late_reporting"])
        self.assertTrue(AuditEvent.objects.filter(action="late_reporting_enabled").exists())

        resp = self.client.post(f"/api/aggregates/reporting-periods/{p.id}/disable-late/", {}, format="json")
        self.assertFalse(resp.data["allow_late_reporting"])
        self.assertTrue(AuditEvent.objects.filter(action="late_reporting_disabled").exists())

    def test_duplicate_creates_next_quarter(self):
        p = self._period(status_value=ReportingPeriod.STATUS_CLOSED)
        resp = self.client.post(f"/api/aggregates/reporting-periods/{p.id}/duplicate/", {}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertEqual(resp.data["quarter"], ELAPSED_Q + 1)

    def test_progress_snapshot(self):
        # One eligible org (assigned + indicator assignment), one submission.
        ProjectOrganization.objects.create(
            project=self.project, organization=self.org, is_active=True,
        )
        ProjectIndicatorAssignment.objects.create(
            project_indicator=self.pi, organization=self.org, is_active=True,
        )
        Aggregate.objects.create(
            indicator=self.indicator, project=self.project, organization=self.org,
            period_start=ELAPSED_START, period_end=ELAPSED_END,
            value={"total": 1}, status="approved", created_by=self.admin,
        )
        p = self._period(status_value=ReportingPeriod.STATUS_OPEN)
        resp = self.client.get(f"/api/aggregates/reporting-periods/{p.id}/progress/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data["eligible_organizations"], 1)
        self.assertEqual(resp.data["submitted_organizations"], 1)
        self.assertEqual(resp.data["approved_organizations"], 1)
        self.assertEqual(resp.data["completion_percentage"], 100.0)


# ── Org-facing status endpoint ───────────────────────────────────────────────
class ReportingStatusEndpointTests(ReportingBase):
    def test_status_reports_open_state(self):
        now = timezone.now()
        self._period(
            status_value=ReportingPeriod.STATUS_OPEN,
            submission_opens=now - timedelta(days=1),
            submission_closes=now + timedelta(days=5),
        )
        self.client.force_authenticate(self.officer)
        resp = self.client.get(
            "/api/aggregates/reporting-status/",
            {"project": self.project.id, "quarter": ELAPSED_Q, "fiscal_year": ELAPSED_FY,
             "organization": self.org.id},
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.assertEqual(resp.data["state"], "open")
        self.assertTrue(resp.data["can_submit"])
        self.assertIn("submission", resp.data)
        self.assertFalse(resp.data["submission"]["has_submitted"])
