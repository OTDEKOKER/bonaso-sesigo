"""Regression tests: correcting a flagged aggregate must clear its open flag.

Before this fix a flagged record could be corrected (value → new, status →
``pending``) but its ``data_quality`` :class:`flags.models.Flag` stayed ``open``
forever, so the record never cleanly "proceeded to the next step" — it kept
showing as flagged in the Flags / Data-Quality views and the correction/review
hand-off stalled. Both write paths (direct edit and re-create/import upsert) are
covered.
"""
from datetime import date

from rest_framework import status
from rest_framework.test import APITestCase

from aggregates.models import Aggregate
from flags.models import Flag
from indicators.models import Indicator
from organizations.models import Organization
from projects.models import Project, ProjectIndicator
from users.models import User


class CorrectionFlagResolutionTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.org = Organization.objects.create(name="Org", code="CFR_ORG", type="cso")
        cls.admin = User.objects.create_user(
            username="cfr_admin", email="cfr_admin@example.com",
            password="TestPass123!", role="admin", organization=cls.org,
        )
        cls.project = Project.objects.create(
            name="CFR Project", code="CFR-1", status="active",
            start_date=date(2026, 1, 1), end_date=date(2026, 12, 31),
            created_by=cls.admin,
        )
        cls.project.organizations.add(cls.org)
        cls.indicator = Indicator.objects.create(
            name="Reached", code="CFR_IND", type="number",
            category="hiv_prevention", created_by=cls.admin,
        )
        ProjectIndicator.objects.create(project=cls.project, indicator=cls.indicator)
        # A completed period so the quarter-completion rule never blocks the edit.
        cls.period_start = date(2026, 1, 1)
        cls.period_end = date(2026, 3, 31)

    def _flagged_aggregate(self):
        agg = Aggregate.objects.create(
            indicator=self.indicator, project=self.project, organization=self.org,
            period_start=self.period_start, period_end=self.period_end,
            value={"total": 5}, status="approved", created_by=self.admin,
        )
        self.client.force_authenticate(self.admin)
        resp = self.client.post(f"/api/aggregates/{agg.id}/flag/", {
            "reason": "incorrect_data", "description": "Wrong value", "severity": "high",
        }, format="json")
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        agg.refresh_from_db()
        self.assertEqual(agg.status, "flagged")
        self.assertTrue(
            Flag.objects.filter(content_type="aggregate", object_id=agg.id, status="open").exists()
        )
        return agg

    def _open_flags(self, agg):
        return Flag.objects.filter(content_type="aggregate", object_id=agg.id, status="open")

    def test_direct_edit_correction_resolves_open_flag(self):
        agg = self._flagged_aggregate()
        resp = self.client.patch(f"/api/aggregates/{agg.id}/", {"value": {"total": 8}}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        agg.refresh_from_db()
        self.assertEqual(agg.status, "pending")               # re-entered review
        self.assertFalse(self._open_flags(agg).exists())      # flag cleared
        self.assertTrue(
            Flag.objects.filter(content_type="aggregate", object_id=agg.id, status="resolved").exists()
        )

    def test_recreate_upsert_correction_resolves_open_flag(self):
        agg = self._flagged_aggregate()
        # POST with the same natural key routes through _upsert_pending_aggregate.
        resp = self.client.post("/api/aggregates/", {
            "indicator": self.indicator.id, "project": self.project.id,
            "organization": self.org.id, "period_start": str(self.period_start),
            "period_end": str(self.period_end), "value": {"total": 12},
        }, format="json")
        self.assertIn(resp.status_code, (status.HTTP_200_OK, status.HTTP_201_CREATED), resp.data)
        agg.refresh_from_db()
        self.assertEqual(agg.status, "pending")
        self.assertFalse(self._open_flags(agg).exists())

    def test_noop_resubmission_keeps_flag_open(self):
        """An identical value is not a correction — the flag must stay open so the
        record does not silently leave the correction queue unresolved."""
        agg = self._flagged_aggregate()
        resp = self.client.patch(f"/api/aggregates/{agg.id}/", {"value": {"total": 5}}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        agg.refresh_from_db()
        self.assertEqual(agg.status, "flagged")               # unchanged → stays flagged
        self.assertTrue(self._open_flags(agg).exists())       # flag preserved
