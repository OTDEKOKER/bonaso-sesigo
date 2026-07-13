"""Server-side filters for the review queue (the Aggregates 'Queued Review').

The dialog now resolves project/organization/coordinator/search on the SERVER so
the queue returns exactly the matching rows instead of pulling every queued row
and filtering in the browser (which mis-scoped once the queue grew large). These
lock in the behaviour the org filter depends on.
"""
from datetime import date

from rest_framework import status
from rest_framework.test import APITestCase

from aggregates.models import Aggregate
from indicators.models import Indicator
from organizations.models import Organization
from projects.models import Project, ProjectIndicator
from users.models import User


class ReviewQueueFilterTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.ceyoho = Organization.objects.create(name="CEYOHO", code="RQ_CEYOHO", type="cso")
        cls.healing = Organization.objects.create(name="Healing Hearts", code="RQ_HH", type="cso")
        cls.admin = User.objects.create_user(
            username="rq_admin", email="rq_admin@example.com",
            password="TestPass123!", role="admin", organization=cls.ceyoho,
        )
        cls.project = Project.objects.create(
            name="RQ Project", code="RQ-1", status="active",
            start_date=date(2026, 1, 1), end_date=date(2026, 12, 31), created_by=cls.admin,
        )
        cls.project.organizations.add(cls.ceyoho, cls.healing)
        cls.mentored = Indicator.objects.create(
            name="Number of sub recipients mentored", code="RQ_MENT", type="number",
            category="hiv_prevention", created_by=cls.admin,
        )
        ProjectIndicator.objects.create(project=cls.project, indicator=cls.mentored)

        cls.q1 = (date(2026, 1, 1), date(2026, 3, 31))
        cls.q2 = (date(2026, 4, 1), date(2026, 6, 30))
        # Each org has the same indicator queued in two periods -> mirrors the real
        # "every org has the same rows" shape that made the client filter confusing.
        cls.ceyoho_rows = [cls._agg(cls.ceyoho, *cls.q1), cls._agg(cls.ceyoho, *cls.q2)]
        cls.healing_rows = [cls._agg(cls.healing, *cls.q1), cls._agg(cls.healing, *cls.q2)]

    @classmethod
    def _agg(cls, org, ps, pe, status_value="pending"):
        return Aggregate.objects.create(
            indicator=cls.mentored, project=cls.project, organization=org,
            period_start=ps, period_end=pe, value={"total": 5},
            status=status_value, created_by=cls.admin,
        )

    def setUp(self):
        self.client.force_authenticate(self.admin)

    def _ids(self, resp):
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        return {row["id"] for row in resp.data["results"]}

    def test_organization_filter_returns_only_that_org(self):
        # THE user-reported bug: filter to CEYOHO must return CEYOHO rows only,
        # never Healing Hearts.
        ids = self._ids(self.client.get("/api/aggregates/", {
            "status": "pending,reviewed,flagged", "organization": self.ceyoho.id,
        }))
        self.assertEqual(ids, {r.id for r in self.ceyoho_rows})
        self.assertTrue(all(r.id not in ids for r in self.healing_rows))

    def test_no_org_filter_returns_all_queued(self):
        ids = self._ids(self.client.get("/api/aggregates/", {
            "status": "pending,reviewed,flagged",
        }))
        self.assertEqual(
            ids, {r.id for r in self.ceyoho_rows + self.healing_rows})

    def test_search_matches_organization_name(self):
        ids = self._ids(self.client.get("/api/aggregates/", {
            "status": "pending,reviewed,flagged", "search": "Healing",
        }))
        self.assertEqual(ids, {r.id for r in self.healing_rows})

    def test_search_matches_indicator_code(self):
        ids = self._ids(self.client.get("/api/aggregates/", {
            "status": "pending,reviewed,flagged", "search": "RQ_MENT",
        }))
        self.assertEqual(ids, {r.id for r in self.ceyoho_rows + self.healing_rows})

    def test_project_and_org_compose(self):
        ids = self._ids(self.client.get("/api/aggregates/", {
            "status": "pending,reviewed,flagged",
            "project": self.project.id, "organization": self.healing.id,
        }))
        self.assertEqual(ids, {r.id for r in self.healing_rows})
