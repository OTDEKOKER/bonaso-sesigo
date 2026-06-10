from datetime import date

from rest_framework import status
from rest_framework.test import APITestCase

from aggregates.models import Aggregate
from indicators.models import Indicator
from organizations.models import Organization
from projects.models import Project, ProjectOrganization
from users.models import User


def _rows(response):
    data = response.json()
    if isinstance(data, dict) and "results" in data:
        return data["results"]
    return data


class RuntimeProjectScopeTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.org = Organization.objects.create(name="Org", code="RS_ORG", type="cso")
        cls.admin = User.objects.create_user(
            username="rs_admin", email="rs_admin@example.com",
            password="TestPass123!", role="admin", organization=cls.org,
        )
        cls.user = User.objects.create_user(
            username="rs_user", email="rs_user@example.com",
            password="TestPass123!", role="officer", organization=cls.org,
        )
        cls.noproj_user = User.objects.create_user(
            username="rs_noproj", email="rs_noproj@example.com",
            password="TestPass123!", role="officer", organization=cls.org,
        )
        common = dict(start_date=date(2026, 1, 1), end_date=date(2026, 12, 31),
                      status="active", created_by=cls.admin)
        cls.assigned = Project.objects.create(name="Assigned", code="RS-A", **common)
        cls.unassigned = Project.objects.create(name="Unassigned", code="RS-U", **common)
        for p in (cls.assigned, cls.unassigned):
            p.organizations.add(cls.org)
        ProjectOrganization.objects.create(
            project=cls.assigned, organization=cls.org, role="lead", is_active=True,
        )
        cls.assigned.assigned_users.add(cls.user)

        cls.indicator = Indicator.objects.create(
            name="Ind", code="RS_IND", type="number", category="hiv_prevention",
            created_by=cls.admin,
        )
        cls.agg_assigned = Aggregate.objects.create(
            indicator=cls.indicator, project=cls.assigned, organization=cls.org,
            period_start=date(2026, 1, 1), period_end=date(2026, 3, 31),
            value={"total": 5}, status="approved", created_by=cls.admin,
        )
        cls.agg_unassigned = Aggregate.objects.create(
            indicator=cls.indicator, project=cls.unassigned, organization=cls.org,
            period_start=date(2026, 1, 1), period_end=date(2026, 3, 31),
            value={"total": 9}, status="approved", created_by=cls.admin,
        )

    # ---- #1 project list filtering -------------------------------------
    def test_project_list_non_admin_sees_only_assigned(self):
        self.client.force_authenticate(self.user)
        rows = _rows(self.client.get("/api/manage/projects/"))
        codes = {row["code"] for row in rows}
        self.assertIn("RS-A", codes)
        self.assertNotIn("RS-U", codes)

    def test_project_list_admin_sees_all(self):
        self.client.force_authenticate(self.admin)
        rows = _rows(self.client.get("/api/manage/projects/"))
        codes = {row["code"] for row in rows}
        self.assertIn("RS-A", codes)
        self.assertIn("RS-U", codes)

    # ---- #2-#4 dashboard ----------------------------------------------
    def test_dashboard_defaults_to_assigned_project(self):
        self.client.force_authenticate(self.user)
        data = self.client.get("/api/analysis/dashboard/overview/").json()
        self.assertEqual(data.get("selected_project_id"), self.assigned.id)
        self.assertEqual(data.get("default_project_id"), self.assigned.id)

    def test_dashboard_no_project_when_user_has_no_assignment(self):
        self.client.force_authenticate(self.noproj_user)
        data = self.client.get("/api/analysis/dashboard/overview/").json()
        self.assertEqual(data.get("code"), "no_project")

    def test_dashboard_rejects_unassigned_project(self):
        self.client.force_authenticate(self.user)
        data = self.client.get(
            f"/api/analysis/dashboard/overview/?project={self.unassigned.id}"
        ).json()
        self.assertEqual(data.get("code"), "no_project")

    # ---- #7 /me default_project_id ------------------------------------
    def test_me_returns_default_project_id(self):
        self.client.force_authenticate(self.user)
        data = self.client.get("/api/users/me/").json()
        self.assertEqual(data.get("default_project_id"), self.assigned.id)

    # ---- aggregates assignment gate -----------------------------------
    def test_aggregates_hidden_for_unassigned_project(self):
        self.client.force_authenticate(self.user)
        rows = _rows(self.client.get("/api/aggregates/"))
        ids = {row["id"] for row in rows}
        self.assertIn(self.agg_assigned.id, ids)
        self.assertNotIn(self.agg_unassigned.id, ids)

    def test_aggregates_admin_sees_all(self):
        self.client.force_authenticate(self.admin)
        rows = _rows(self.client.get("/api/aggregates/"))
        ids = {row["id"] for row in rows}
        self.assertIn(self.agg_assigned.id, ids)
        self.assertIn(self.agg_unassigned.id, ids)
