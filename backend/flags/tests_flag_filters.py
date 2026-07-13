"""Tests for the server-side Flags filters (FlagFilterSet).

The Flags page filters mirror the rest of the system (organization / project /
coordinator / indicator / type / category / date). Project and indicator live on
the linked aggregate, so those resolve through ``content_type='aggregate'`` +
``object_id``; coordinator resolves the project org subtree; category reads
``metadata``. All are applied server-side so they cover every flag, not one page.
"""
from datetime import date, timedelta

from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from aggregates.models import Aggregate
from flags.models import Flag
from indicators.models import Indicator
from organizations.models import Organization
from projects.models import Project, ProjectIndicator
from users.models import User


class FlagFilterTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.org_a = Organization.objects.create(name="Org A", code="FF_A", type="cso")
        cls.org_b = Organization.objects.create(name="Org B", code="FF_B", type="cso")
        cls.admin = User.objects.create_user(
            username="ff_admin", email="ff_admin@example.com",
            password="TestPass123!", role="admin", organization=cls.org_a,
        )
        cls.project_1 = Project.objects.create(
            name="Proj 1", code="FF-1", status="active",
            start_date=date(2026, 1, 1), end_date=date(2026, 12, 31), created_by=cls.admin,
        )
        cls.project_2 = Project.objects.create(
            name="Proj 2", code="FF-2", status="active",
            start_date=date(2026, 1, 1), end_date=date(2026, 12, 31), created_by=cls.admin,
        )
        cls.ind_x = Indicator.objects.create(name="Ind X", code="FF_X", type="number",
                                              category="hiv_prevention", created_by=cls.admin)
        cls.ind_y = Indicator.objects.create(name="Ind Y", code="FF_Y", type="number",
                                             category="hiv_prevention", created_by=cls.admin)
        for p in (cls.project_1, cls.project_2):
            ProjectIndicator.objects.create(project=p, indicator=cls.ind_x)
            ProjectIndicator.objects.create(project=p, indicator=cls.ind_y)

        # One aggregate per (project, indicator, org) combination we care about.
        cls.agg_p1_x_a = cls._agg(cls.project_1, cls.ind_x, cls.org_a)
        cls.agg_p1_y_a = cls._agg(cls.project_1, cls.ind_y, cls.org_a)
        cls.agg_p2_x_b = cls._agg(cls.project_2, cls.ind_x, cls.org_b)

        # A data-quality flag on each aggregate, with a metadata category.
        cls.flag_p1_x_a = cls._flag(cls.agg_p1_x_a, cls.org_a, category="anomaly", priority="high")
        cls.flag_p1_y_a = cls._flag(cls.agg_p1_y_a, cls.org_a, category="consistency", priority="critical")
        cls.flag_p2_x_b = cls._flag(cls.agg_p2_x_b, cls.org_b, category="anomaly", priority="low")

    @classmethod
    def _agg(cls, project, indicator, org):
        return Aggregate.objects.create(
            indicator=indicator, project=project, organization=org,
            period_start=date(2026, 1, 1), period_end=date(2026, 3, 31),
            value={"total": 5}, status="approved", created_by=cls.admin,
        )

    @classmethod
    def _flag(cls, aggregate, org, *, category, priority):
        return Flag.objects.create(
            flag_type="data_quality", status="open", priority=priority,
            title=f"Anomaly: {aggregate.indicator.code}", description="auto",
            content_type="aggregate", object_id=aggregate.id,
            organization=org, created_by=cls.admin,
            metadata={"category": category},
        )

    def _ids(self, resp):
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        return {row["id"] for row in resp.data["results"]}

    def setUp(self):
        self.client.force_authenticate(self.admin)

    def test_filter_by_project(self):
        ids = self._ids(self.client.get("/api/flags/", {"project": self.project_1.id}))
        self.assertEqual(ids, {self.flag_p1_x_a.id, self.flag_p1_y_a.id})

    def test_filter_by_indicator(self):
        ids = self._ids(self.client.get("/api/flags/", {"indicator": self.ind_x.id}))
        self.assertEqual(ids, {self.flag_p1_x_a.id, self.flag_p2_x_b.id})

    def test_filter_by_project_and_indicator(self):
        ids = self._ids(self.client.get(
            "/api/flags/", {"project": self.project_1.id, "indicator": self.ind_x.id}))
        self.assertEqual(ids, {self.flag_p1_x_a.id})

    def test_filter_by_organization(self):
        ids = self._ids(self.client.get("/api/flags/", {"organization": self.org_b.id}))
        self.assertEqual(ids, {self.flag_p2_x_b.id})

    def test_filter_by_coordinator_leaf_org(self):
        # No project hierarchy configured → coordinator resolves to the org itself.
        ids = self._ids(self.client.get("/api/flags/", {"coordinator": self.org_a.id}))
        self.assertEqual(ids, {self.flag_p1_x_a.id, self.flag_p1_y_a.id})

    def test_filter_by_category(self):
        ids = self._ids(self.client.get("/api/flags/", {"category": "consistency"}))
        self.assertEqual(ids, {self.flag_p1_y_a.id})

    def test_filter_by_priority(self):
        ids = self._ids(self.client.get("/api/flags/", {"priority": "critical"}))
        self.assertEqual(ids, {self.flag_p1_y_a.id})

    def test_search_matches_title(self):
        ids = self._ids(self.client.get("/api/flags/", {"search": "FF_Y"}))
        self.assertEqual(ids, {self.flag_p1_y_a.id})

    def test_date_range_excludes_out_of_window(self):
        # Push one flag's created_at into the past, then filter to today onward.
        past = timezone.now() - timedelta(days=10)
        Flag.objects.filter(id=self.flag_p2_x_b.id).update(created_at=past)
        today = timezone.now().date().isoformat()
        ids = self._ids(self.client.get("/api/flags/", {"date_from": today}))
        self.assertNotIn(self.flag_p2_x_b.id, ids)
        self.assertIn(self.flag_p1_x_a.id, ids)

    def test_no_filter_returns_all(self):
        ids = self._ids(self.client.get("/api/flags/"))
        self.assertEqual(
            ids, {self.flag_p1_x_a.id, self.flag_p1_y_a.id, self.flag_p2_x_b.id})
