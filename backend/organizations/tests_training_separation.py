"""
Regression tests for Sesigo Live System vs Training Mode separation.

Covers the guarantees finalised across the rollout:
- writes cannot cross the live/training boundary (and a query parameter alone
  cannot misroute a write — the target project's is_training is the authority);
- dashboards, aggregates, and shared org/indicator lists are mode-isolated;
- demo (training-only) orgs/indicators are hidden from live lists.
"""
from datetime import date

from django.test import TestCase
from django.contrib.auth import get_user_model
from rest_framework.test import APIRequestFactory, force_authenticate
from rest_framework.request import Request
from rest_framework.exceptions import PermissionDenied

from projects.models import Project
from organizations.models import Organization
from indicators.models import Indicator
from aggregates.models import Aggregate
from organizations.access import (
    assert_project_write_allowed,
    apply_training_filter,
    apply_training_filter_via_projects,
)
from analysis.views import DashboardView

User = get_user_model()


class TrainingSeparationTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.admin = User.objects.create_user(username="admin_t", password="x", is_superuser=True, is_staff=True)
        cls.factory = APIRequestFactory()

        cls.live_proj = Project.objects.create(
            name="Live P", code="LIVE-P", status="active",
            start_date=date(2026, 1, 1), end_date=date(2026, 12, 31), is_training=False)
        cls.train_proj = Project.objects.create(
            name="Demo P", code="DEMO-P", status="active",
            start_date=date(2026, 1, 1), end_date=date(2026, 12, 31), is_training=True)

        cls.live_org = Organization.objects.create(name="Live Org", code="LIVE-ORG", type="partner")
        cls.demo_org = Organization.objects.create(name="DEMO Org", code="DEMO-ORG-T", type="partner")
        cls.live_proj.organizations.add(cls.live_org)
        cls.train_proj.organizations.add(cls.demo_org)

        cls.live_ind = Indicator.objects.create(name="Live Ind", code="LIVE-IND", type="number")
        cls.demo_ind = Indicator.objects.create(name="DEMO Ind", code="DEMO-IND-T", type="number")
        cls.live_proj.indicators.add(cls.live_ind)
        cls.train_proj.indicators.add(cls.demo_ind)

        Aggregate.objects.create(indicator=cls.live_ind, project=cls.live_proj, organization=cls.live_org,
                                 period_start=date(2026, 1, 1), period_end=date(2026, 3, 31), value={"total": 10}, status="approved")
        Aggregate.objects.create(indicator=cls.demo_ind, project=cls.train_proj, organization=cls.demo_org,
                                 period_start=date(2026, 1, 1), period_end=date(2026, 3, 31), value={"total": 5}, status="approved")

    def _req(self, qs=""):
        w = self.factory.get("/api/x/" + qs)
        r = Request(w)
        r.user = self.admin
        return r

    # ---- write boundary -------------------------------------------------
    def test_live_write_to_live_allowed(self):
        assert_project_write_allowed(self._req(""), self.live_proj)  # no raise

    def test_live_write_to_training_rejected(self):
        with self.assertRaises(PermissionDenied):
            assert_project_write_allowed(self._req(""), self.train_proj)

    def test_training_write_to_training_allowed(self):
        assert_project_write_allowed(self._req("?training_only=true"), self.train_proj)

    def test_training_write_to_live_rejected(self):
        with self.assertRaises(PermissionDenied):
            assert_project_write_allowed(self._req("?training_only=true"), self.live_proj)

    def test_param_alone_cannot_route_write_to_wrong_scope(self):
        # include_training (admin read-all) must NOT let a live-intent write land
        # in a training project, and a live param must not write to training.
        with self.assertRaises(PermissionDenied):
            assert_project_write_allowed(self._req("?include_training=true"), self.train_proj)

    # ---- read isolation -------------------------------------------------
    def test_aggregates_live_excludes_training(self):
        qs = apply_training_filter(Aggregate.objects.all(), self._req(""), project_lookup="project")
        self.assertEqual(qs.count(), 1)
        self.assertEqual(qs.first().project, self.live_proj)

    def test_aggregates_training_excludes_live(self):
        qs = apply_training_filter(Aggregate.objects.all(), self._req("?training_only=true"), project_lookup="project")
        self.assertEqual(qs.count(), 1)
        self.assertEqual(qs.first().project, self.train_proj)

    def test_indicators_live_hides_demo(self):
        qs = apply_training_filter_via_projects(Indicator.objects.all(), self._req(""))
        codes = set(qs.values_list("code", flat=True))
        self.assertIn("LIVE-IND", codes)
        self.assertNotIn("DEMO-IND-T", codes)

    def test_indicators_training_shows_only_demo(self):
        qs = apply_training_filter_via_projects(Indicator.objects.all(), self._req("?training_only=true"))
        codes = set(qs.values_list("code", flat=True))
        self.assertEqual(codes, {"DEMO-IND-T"})

    def test_orgs_live_hides_demo(self):
        qs = apply_training_filter_via_projects(Organization.objects.all(), self._req(""))
        codes = set(qs.values_list("code", flat=True))
        self.assertIn("LIVE-ORG", codes)
        self.assertNotIn("DEMO-ORG-T", codes)

    def test_orgs_training_shows_only_demo(self):
        qs = apply_training_filter_via_projects(Organization.objects.all(), self._req("?training_only=true"))
        self.assertEqual(set(qs.values_list("code", flat=True)), {"DEMO-ORG-T"})

    # ---- dashboard totals ----------------------------------------------
    def _overview(self, qs=""):
        r = self.factory.get("/api/analysis/dashboard/overview/" + qs)
        force_authenticate(r, user=self.admin)
        return DashboardView.as_view({"get": "overview"})(r).data

    def test_dashboard_live_excludes_training_assessments(self):
        live = self._overview("")
        train = self._overview("?training_only=true")
        # live active projects counts only the live one; training only the demo one
        self.assertEqual(live["active_projects"], 1)
        self.assertEqual(train["active_projects"], 1)
