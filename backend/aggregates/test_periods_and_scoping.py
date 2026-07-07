"""Regression tests for the scoped Aggregates browse contract.

These lock in the server-side behaviour the fast Aggregates page depends on so a
future change cannot silently reintroduce the "download every row" pattern or
weaken org isolation:

  * ``/api/aggregates/periods/`` lists the DISTINCT approved reporting periods a
    user is permitted to see (org scope + project filter + approved-only), so the
    quarter dropdown no longer needs the full dataset.
  * The list endpoint honours server-side ``organization`` / ``date_from`` /
    ``date_to`` / ``status`` filtering and paginates — the page must be able to
    pull only the selected org+period slice.
  * ``?light=1`` returns the reduced projection (no notes/review fields) the
    browse table uses, without leaking them.
  * Cross-org isolation holds on every one of these paths.
"""
from datetime import date

from rest_framework import status
from rest_framework.test import APITestCase

from aggregates.models import Aggregate
from indicators.models import Indicator
from organizations.models import Organization
from projects.models import Project, ProjectIndicator
from users.models import User


class AggregateScopingTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.coord_org = Organization.objects.create(name="Coord", code="SCOPE_COORD", type="district")
        cls.sub1 = Organization.objects.create(name="Sub 1", code="SCOPE_SUB1", type="cso", parent=cls.coord_org)
        cls.sub2 = Organization.objects.create(name="Sub 2", code="SCOPE_SUB2", type="cso", parent=cls.coord_org)

        cls.admin = User.objects.create_user(
            username="scope_admin", email="scope_admin@example.com",
            password="TestPass123!", role="admin", organization=cls.coord_org,
        )
        cls.sub1_officer = User.objects.create_user(
            username="scope_sub1_off", email="scope_sub1_off@example.com",
            password="TestPass123!", role="officer", organization=cls.sub1,
        )

        cls.project = Project.objects.create(
            name="Scope Project", code="SCOPE-1",
            start_date=date(2026, 1, 1), end_date=date(2026, 12, 31),
            created_by=cls.admin,
        )
        cls.project.organizations.add(cls.coord_org, cls.sub1, cls.sub2)

        cls.other_project = Project.objects.create(
            name="Other Project", code="SCOPE-2",
            start_date=date(2026, 1, 1), end_date=date(2026, 12, 31),
            created_by=cls.admin,
        )
        cls.other_project.organizations.add(cls.sub1)

        cls.indicator = Indicator.objects.create(
            name="Reached", code="SCOPE_IND_1", type="number",
            category="hiv_prevention", created_by=cls.admin,
        )
        ProjectIndicator.objects.create(project=cls.project, indicator=cls.indicator)
        ProjectIndicator.objects.create(project=cls.other_project, indicator=cls.indicator)

        cls.q1 = (date(2026, 1, 1), date(2026, 3, 31))
        cls.q2 = (date(2026, 4, 1), date(2026, 6, 30))

    def _agg(self, organization, period, *, status_value="approved", project=None, notes=""):
        project = project or self.project
        return Aggregate.objects.create(
            indicator=self.indicator, project=project, organization=organization,
            period_start=period[0], period_end=period[1],
            value={"total": 7}, status=status_value, notes=notes,
            created_by=self.admin,
        )

    # --- periods endpoint --------------------------------------------------

    def test_periods_returns_distinct_approved_periods(self):
        # Two approved rows in Q1 (different orgs) must collapse to one period.
        self._agg(self.sub1, self.q1)
        self._agg(self.sub2, self.q1)
        self._agg(self.sub1, self.q2)
        self.client.force_authenticate(self.admin)
        response = self.client.get("/api/aggregates/periods/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        results = response.json()["results"]
        pairs = {(row["period_start"], row["period_end"]) for row in results}
        self.assertEqual(
            pairs,
            {("2026-01-01", "2026-03-31"), ("2026-04-01", "2026-06-30")},
        )

    def test_periods_excludes_non_approved_by_default(self):
        self._agg(self.sub1, self.q1, status_value="pending")
        self._agg(self.sub2, self.q2, status_value="approved")
        self.client.force_authenticate(self.admin)
        response = self.client.get("/api/aggregates/periods/")
        pairs = {(r["period_start"], r["period_end"]) for r in response.json()["results"]}
        self.assertEqual(pairs, {("2026-04-01", "2026-06-30")})

    def test_periods_respects_project_filter(self):
        self._agg(self.sub1, self.q1, project=self.project)
        self._agg(self.sub1, self.q2, project=self.other_project)
        self.client.force_authenticate(self.admin)
        response = self.client.get(f"/api/aggregates/periods/?project={self.other_project.id}")
        pairs = {(r["period_start"], r["period_end"]) for r in response.json()["results"]}
        self.assertEqual(pairs, {("2026-04-01", "2026-06-30")})

    def test_periods_are_org_isolated(self):
        # sub1 officer must not learn about sub2's (sibling) reporting periods.
        self._agg(self.sub1, self.q1)
        self._agg(self.sub2, self.q2)
        self.client.force_authenticate(self.sub1_officer)
        response = self.client.get("/api/aggregates/periods/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        pairs = {(r["period_start"], r["period_end"]) for r in response.json()["results"]}
        self.assertEqual(pairs, {("2026-01-01", "2026-03-31")})

    # --- list scoping / pagination ----------------------------------------

    def test_list_filters_by_organization(self):
        own = self._agg(self.sub1, self.q1)
        sibling = self._agg(self.sub2, self.q1)
        self.client.force_authenticate(self.admin)
        response = self.client.get(f"/api/aggregates/?organization={self.sub1.id}")
        results = response.json()["results"]
        ids = {row["id"] for row in results}
        self.assertIn(own.id, ids)
        self.assertNotIn(sibling.id, ids)

    def test_list_filters_by_date_range(self):
        q1_row = self._agg(self.sub1, self.q1)
        q2_row = self._agg(self.sub1, self.q2)
        self.client.force_authenticate(self.admin)
        response = self.client.get(
            "/api/aggregates/?date_from=2026-04-01&date_to=2026-06-30"
        )
        ids = {row["id"] for row in response.json()["results"]}
        self.assertIn(q2_row.id, ids)
        self.assertNotIn(q1_row.id, ids)

    def test_list_paginates(self):
        for _ in range(3):
            # distinct periods to satisfy the unique natural key
            pass
        self._agg(self.sub1, (date(2026, 1, 1), date(2026, 1, 31)))
        self._agg(self.sub1, (date(2026, 2, 1), date(2026, 2, 28)))
        self._agg(self.sub1, (date(2026, 3, 1), date(2026, 3, 31)))
        self.client.force_authenticate(self.admin)
        response = self.client.get("/api/aggregates/?page_size=2")
        body = response.json()
        self.assertEqual(len(body["results"]), 2)
        self.assertIsNotNone(body["next"])
        self.assertEqual(body["count"], 3)

    def test_light_projection_drops_review_fields(self):
        self._agg(self.sub1, self.q1, notes="sensitive reviewer note")
        self.client.force_authenticate(self.admin)
        full = self.client.get("/api/aggregates/").json()["results"][0]
        light = self.client.get("/api/aggregates/?light=1").json()["results"][0]
        self.assertIn("notes", full)
        self.assertNotIn("notes", light)
        self.assertNotIn("reviewed_by", light)
        # The fields the browse table needs are still present.
        for field in ("indicator_name", "organization_name", "value", "period_start", "status"):
            self.assertIn(field, light)

    def test_list_is_org_isolated_without_explicit_filter(self):
        own = self._agg(self.sub1, self.q1)
        sibling = self._agg(self.sub2, self.q1)
        self.client.force_authenticate(self.sub1_officer)
        response = self.client.get("/api/aggregates/")
        ids = {row["id"] for row in response.json()["results"]}
        self.assertIn(own.id, ids)
        self.assertNotIn(sibling.id, ids)
