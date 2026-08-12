"""Grants module: scope, permissions (dark-by-default), and rollup math."""
from datetime import date
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from organizations.models import Organization
from projects.models import Project
from users.models import UserModulePermission

from .models import Grant, GrantDisbursement, GrantExpenditure

User = get_user_model()


class GrantsScopeTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.proj = Project.objects.create(
            name="Live", code="G-LIVE", status="active",
            start_date=date(2026, 1, 1), end_date=date(2026, 12, 31), is_training=False,
        )
        cls.proj_train = Project.objects.create(
            name="Train", code="G-TRAIN", status="active",
            start_date=date(2026, 1, 1), end_date=date(2026, 12, 31), is_training=True,
        )
        cls.coord_a = Organization.objects.create(name="Coord A", code="G-A", type="regional")
        cls.child_a = Organization.objects.create(name="Child A", code="G-A-C", type="ngo", parent=cls.coord_a)
        cls.coord_b = Organization.objects.create(name="Coord B", code="G-B", type="regional")

        # Users
        cls.admin = User.objects.create_user(username="g_admin", email="g_admin@x.com", password="x", role="admin")
        cls.finance = User.objects.create_user(username="g_fin", email="g_fin@x.com", password="x", role="officer", organization=cls.coord_a)
        cls.coord_user = User.objects.create_user(username="g_coord", email="g_coord@x.com", password="x", role="officer", organization=cls.coord_a)
        cls.no_access = User.objects.create_user(username="g_none", email="g_none@x.com", password="x", role="officer", organization=cls.coord_a)

        for u in (cls.finance, cls.coord_user, cls.no_access):
            cls.proj.assigned_users.add(u)
        # Finance: full grant management. Coordinator: view only. no_access: nothing.
        UserModulePermission.objects.create(user=cls.finance, module="grants", actions=["view", "create", "edit", "delete"], is_enabled=True)
        UserModulePermission.objects.create(user=cls.coord_user, module="grants", actions=["view"], is_enabled=True)

        # Grants
        cls.g_a = Grant.objects.create(project=cls.proj, organization=cls.coord_a, total_amount=Decimal("1000"))
        cls.g_child = Grant.objects.create(project=cls.proj, organization=cls.child_a, total_amount=Decimal("500"))
        cls.g_b = Grant.objects.create(project=cls.proj, organization=cls.coord_b, total_amount=Decimal("2000"))
        cls.g_train = Grant.objects.create(project=cls.proj_train, organization=cls.coord_a, total_amount=Decimal("999"))
        # Spend 400 against coord A's grant.
        GrantDisbursement.objects.create(grant=cls.g_a, date=date(2026, 3, 1), amount=Decimal("600"))
        GrantExpenditure.objects.create(grant=cls.g_a, date=date(2026, 3, 15), amount=Decimal("400"))

    def _client(self, user):
        c = APIClient()
        c.force_authenticate(user=user)
        return c

    def _ids(self, resp):
        data = resp.data.get("results", resp.data) if isinstance(resp.data, dict) else resp.data
        return {row["id"] for row in data}

    def test_dark_by_default(self):
        """A user with no grants grant is denied (module is deny-by-default)."""
        resp = self._client(self.no_access).get("/api/grants/")
        self.assertEqual(resp.status_code, 403)

    def test_admin_sees_live_grants_not_training(self):
        resp = self._client(self.admin).get("/api/grants/")
        self.assertEqual(resp.status_code, 200)
        ids = self._ids(resp)
        self.assertEqual(ids, {self.g_a.id, self.g_child.id, self.g_b.id})
        self.assertNotIn(self.g_train.id, ids)

    def test_coordinator_scoped_to_own_subtree(self):
        resp = self._client(self.coord_user).get("/api/grants/")
        self.assertEqual(resp.status_code, 200)
        ids = self._ids(resp)
        self.assertEqual(ids, {self.g_a.id, self.g_child.id})   # own + descendant
        self.assertNotIn(self.g_b.id, ids)                       # other coordinator hidden

    def test_coordinator_is_read_only(self):
        resp = self._client(self.coord_user).post("/api/grants/", {
            "project": self.proj.id, "organization": self.coord_a.id, "total_amount": "100",
        })
        self.assertEqual(resp.status_code, 403)

    def test_finance_can_create_in_scope_but_not_cross_org(self):
        c = self._client(self.finance)
        ok = c.post("/api/grants/", {"project": self.proj.id, "organization": self.coord_a.id, "total_amount": "300"})
        self.assertEqual(ok.status_code, 201)
        denied = c.post("/api/grants/", {"project": self.proj.id, "organization": self.coord_b.id, "total_amount": "300"})
        self.assertEqual(denied.status_code, 403)

    def test_summary_rollup_math(self):
        resp = self._client(self.admin).get("/api/grants/summary/")
        self.assertEqual(resp.status_code, 200)
        grand = resp.data["grand_total"]
        self.assertEqual(Decimal(str(grand["awarded"])), Decimal("3500"))   # 1000+500+2000 (live only)
        self.assertEqual(Decimal(str(grand["spent"])), Decimal("400"))
        self.assertEqual(Decimal(str(grand["disbursed"])), Decimal("600"))
        by_org = {r["organization_id"]: r for r in resp.data["organizations"]}
        self.assertAlmostEqual(by_org[self.coord_a.id]["burn_pct"], 40.0)    # 400/1000
        self.assertAlmostEqual(by_org[self.coord_b.id]["burn_pct"], 0.0)     # 0/2000
