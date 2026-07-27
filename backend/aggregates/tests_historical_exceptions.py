"""Tests for the WS2 read-only historical-exception classifier
(``aggregates/management/commands/audit_historical_exceptions.py``) and for the
invariant that legacy exceptions never let a NEW record bypass current validation.

The command must:
  * classify each aggregate into exactly one primary category;
  * never write to the database (no value/status/reviewer change, no audit event);
  * emit machine-readable JSON detail for review.
"""
from __future__ import annotations

import json
import os
import tempfile
from datetime import date, timedelta
from io import StringIO

from django.core.management import call_command
from django.db import IntegrityError, transaction
from django.test import TestCase
from django.utils import timezone

from aggregates.models import Aggregate
from audit.models import AuditEvent
from indicators.models import Indicator
from organizations.models import Organization
from projects.models import (
    Project, ProjectIndicator, ProjectOrganization, ProjectOrganizationHierarchy,
)
from users.models import User

Q1_START, Q1_END = date(2024, 4, 1), date(2024, 6, 30)


class HistoricalExceptionBase(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.admin = User.objects.create_user(
            username="hx_admin", email="hx_admin@example.com",
            password="TestPass123!", role="admin",
        )
        cls.reviewer = User.objects.create_user(
            username="hx_reviewer", email="hx_rev@example.com",
            password="TestPass123!", role="manager",
        )
        cls.org = Organization.objects.create(name="Member Org", code="HX_ORG", type="cso")
        cls.other_org = Organization.objects.create(name="Unassigned Org", code="HX_OTHER", type="cso")
        cls.project = Project.objects.create(
            name="HX Project", code="HX-1", status="active",
            start_date=date(2024, 1, 1), end_date=date(2099, 12, 31),
            created_by=cls.admin, is_training=False,
        )
        # Project-scoped membership lives in ProjectOrganization (not the plain
        # Project.organizations M2M), which is what the classifier reads.
        ProjectOrganization.objects.create(
            project=cls.project, organization=cls.org, is_active=True,
        )
        cls.indicator = Indicator.objects.create(
            name="Reached", code="HX_IND", type="number",
            category="hiv_prevention", created_by=cls.admin,
        )
        ProjectIndicator.objects.create(project=cls.project, indicator=cls.indicator)

    def _agg(self, *, org=None, indicator=None, status="approved",
             reviewed=True, created_by=True, period_start=Q1_START,
             period_end=Q1_END, value=None):
        agg = Aggregate.objects.create(
            indicator=indicator or self.indicator,
            project=self.project,
            organization=org or self.org,
            period_start=period_start, period_end=period_end,
            value=value if value is not None else {"total": 10},
            status=status,
            reviewed_by=self.reviewer if reviewed else None,
            reviewed_at=timezone.now() if reviewed else None,
            created_by=self.admin if created_by else None,
        )
        return agg

    def _run_to_json(self, **opts):
        fd, path = tempfile.mkstemp(suffix=".json")
        os.close(fd)
        out = StringIO()
        try:
            call_command("audit_historical_exceptions", json_path=path, stdout=out, **opts)
            with open(path) as fh:
                return json.load(fh), out.getvalue()
        finally:
            os.unlink(path)

    def _classification_of(self, agg_id, detail):
        for row in detail:
            if row["aggregate_id"] == agg_id:
                return row["classification"]
        return None  # not an exception → clean (valid_current / valid_legacy)


class ClassificationTests(HistoricalExceptionBase):
    def test_valid_current_is_not_flagged(self):
        agg = self._agg()  # approved, reviewed, created_by, member
        result, _ = self._run_to_json()
        self.assertEqual(result["summary"]["valid_current"], 1)
        self.assertIsNone(self._classification_of(agg.id, result["detail"]))

    def test_valid_legacy_when_no_created_by(self):
        agg = self._agg(created_by=False)  # bulk-migrated but reviewer present
        result, _ = self._run_to_json()
        self.assertEqual(result["summary"]["valid_legacy"], 1)
        self.assertIsNone(self._classification_of(agg.id, result["detail"]))

    def test_missing_reviewer_metadata(self):
        agg = self._agg(reviewed=False)
        result, _ = self._run_to_json()
        self.assertEqual(
            self._classification_of(agg.id, result["detail"]),
            "missing_reviewer_metadata",
        )

    def test_missing_project_membership(self):
        # other_org is NOT a member of the project.
        agg = self._agg(org=self.other_org)
        result, _ = self._run_to_json()
        self.assertEqual(
            self._classification_of(agg.id, result["detail"]),
            "missing_project_membership",
        )

    def test_historical_hierarchy_exception(self):
        # Project uses hierarchies, but self.org is in none of them.
        p1 = Organization.objects.create(name="Coord", code="HX_COORD", type="cso")
        p2 = Organization.objects.create(name="Sub", code="HX_SUB", type="cso")
        ProjectOrganization.objects.create(project=self.project, organization=p1)
        ProjectOrganization.objects.create(project=self.project, organization=p2)
        ProjectOrganizationHierarchy.objects.create(
            project=self.project, parent_organization=p1, child_organization=p2,
        )
        agg = self._agg()  # self.org is a member but not in the hierarchy graph
        result, _ = self._run_to_json()
        self.assertEqual(
            self._classification_of(agg.id, result["detail"]),
            "historical_hierarchy_exception",
        )

    def test_duplicate_candidate_on_overlapping_periods(self):
        # A quarter and a month inside it overlap but are NOT a unique_together
        # collision (different period_end), so both can exist and both are risky.
        quarterly = self._agg(period_start=Q1_START, period_end=Q1_END)
        monthly = self._agg(period_start=date(2024, 4, 1), period_end=date(2024, 4, 30))
        result, _ = self._run_to_json()
        self.assertEqual(
            self._classification_of(quarterly.id, result["detail"]), "duplicate_candidate")
        self.assertEqual(
            self._classification_of(monthly.id, result["detail"]), "duplicate_candidate")

    def test_requires_manual_review_when_multiple_exceptions(self):
        # Unassigned org (membership) AND missing reviewer → two exceptions.
        agg = self._agg(org=self.other_org, reviewed=False)
        result, _ = self._run_to_json()
        cls = self._classification_of(agg.id, result["detail"])
        self.assertEqual(cls, "requires_manual_review")
        row = next(r for r in result["detail"] if r["aggregate_id"] == agg.id)
        self.assertIn("missing_reviewer_metadata", row["all_exceptions"])
        self.assertIn("missing_project_membership", row["all_exceptions"])

    def test_in_workflow_states_are_not_exceptions(self):
        agg = self._agg(status="pending", reviewed=False)
        result, _ = self._run_to_json()
        self.assertEqual(result["summary"]["in_workflow"], 1)
        self.assertIsNone(self._classification_of(agg.id, result["detail"]))

    def test_confirmed_invalid_never_auto_assigned(self):
        self._agg(org=self.other_org, reviewed=False)  # worst case
        result, _ = self._run_to_json()
        self.assertEqual(result["summary"]["confirmed_invalid"], 0)


class ReadOnlyGuaranteeTests(HistoricalExceptionBase):
    def test_command_writes_nothing(self):
        a1 = self._agg()
        a2 = self._agg(reviewed=False, org=self.other_org)
        before = {
            a.id: (a.status, a.reviewed_by_id, a.reviewed_at, a.created_by_id,
                   a.value, a.notes, a.updated_at)
            for a in Aggregate.objects.all()
        }
        audit_before = AuditEvent.objects.count()

        call_command("audit_historical_exceptions", stdout=StringIO())

        after = {
            a.id: (a.status, a.reviewed_by_id, a.reviewed_at, a.created_by_id,
                   a.value, a.notes, a.updated_at)
            for a in Aggregate.objects.all()
        }
        self.assertEqual(before, after, "classifier must not mutate any aggregate")
        self.assertEqual(
            AuditEvent.objects.count(), audit_before,
            "classifier is read-only and must not record audit events",
        )


class NoBypassForNewRecordsTests(HistoricalExceptionBase):
    """The presence of legacy exception rows must NOT weaken validation for new
    records: duplicate prevention and the unique constraint still apply."""

    def test_new_exact_duplicate_still_blocked_despite_legacy_row(self):
        # A legacy, reviewer-less approved row exists for a DIFFERENT period
        # (an "exception" the classifier would flag).
        self._agg(reviewed=False, created_by=False,
                  period_start=date(2024, 1, 1), period_end=date(2024, 1, 31))
        # A fresh, fully-valid row for the Q1 natural key…
        self._agg()
        # …and a second row with the SAME (indicator, project, org, period) must
        # be rejected by the DB unique_together — legacy data does not bypass it.
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                Aggregate.objects.create(
                    indicator=self.indicator, project=self.project,
                    organization=self.org, period_start=Q1_START, period_end=Q1_END,
                    value={"total": 99}, status="approved",
                )

    def test_distinct_periods_are_allowed(self):
        # Sanity: the constraint is on the full natural key, so a different period
        # for the same org/indicator is legitimately allowed (monthly vs quarterly).
        self._agg(period_start=Q1_START, period_end=Q1_END)
        try:
            with transaction.atomic():
                self._agg(period_start=date(2024, 4, 1), period_end=date(2024, 4, 30))
        except IntegrityError:  # pragma: no cover
            self.fail("distinct periods must not collide on the unique constraint")
