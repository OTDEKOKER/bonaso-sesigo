"""Indicator list visibility must follow the reviewer's org SUBTREE.

An indicator is tagged with its workbook reporting roster (the coordinator plus
the sub-grantees that report on it), NOT the reviewer's own org. A higher-tier
M&E reviewer (e.g. BONASO/NAHPA HQ) reviews its sub-grantees' submissions, so it
must see indicators reported on by any org beneath it — otherwise the review UI
renders a blank indicator picker and cannot resolve the disaggregation config.
"""
from rest_framework import status
from rest_framework.test import APITestCase

from indicators.models import Indicator
from organizations.models import Organization
from users.models import User


class IndicatorReviewScopeTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        # HQ -> coordinator -> sub-grantee, plus an unrelated org.
        cls.hq = Organization.objects.create(name="HQ")
        cls.coordinator = Organization.objects.create(name="Coordinator", parent=cls.hq)
        cls.subgrantee = Organization.objects.create(name="Sub-grantee", parent=cls.coordinator)
        cls.other = Organization.objects.create(name="Unrelated")

        # Reporting-roster indicator: tagged to the coordinator + sub-grantee only.
        cls.roster_ind = Indicator.objects.create(name="Screened", code="RS_ROSTER", type="number")
        cls.roster_ind.organizations.add(cls.coordinator, cls.subgrantee)
        # Global indicator: no org tags, everyone sees it.
        cls.global_ind = Indicator.objects.create(name="Global", code="RS_GLOBAL", type="number")
        # An indicator tagged to an unrelated org outside the reviewer's subtree.
        cls.other_ind = Indicator.objects.create(name="Elsewhere", code="RS_OTHER", type="number")
        cls.other_ind.organizations.add(cls.other)

        # A non-admin HQ M&E officer — the reviewer that previously saw a blank box.
        cls.hq_officer = User.objects.create_user(
            username="rs_hq", email="hq@x.com", password="P!23456789",
            role="officer", organization=cls.hq,
        )

    def _list_ids(self):
        res = self.client.get("/api/indicators/", {"page_size": "500"})
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        payload = res.json()
        rows = payload["results"] if isinstance(payload, dict) and "results" in payload else payload
        return {row["id"] for row in rows}

    def test_hq_reviewer_sees_subtree_roster_indicator(self):
        self.client.force_authenticate(self.hq_officer)
        ids = self._list_ids()
        # The whole point: a sub-grantee-tagged indicator is visible to HQ.
        self.assertIn(self.roster_ind.id, ids)
        self.assertIn(self.global_ind.id, ids)
        # Scope boundary preserved: an unrelated org's indicator stays hidden.
        self.assertNotIn(self.other_ind.id, ids)
