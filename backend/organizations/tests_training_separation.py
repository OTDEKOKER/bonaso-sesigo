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

    def _req_token(self, qs="", mode=None):
        """Build a request whose verified JWT carries a `mode` claim (H1)."""
        r = self._req(qs)
        # Mirror a validated AccessToken: token_mode reads request._auth.get('mode').
        r._auth = {"mode": mode} if mode is not None else {}
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

    # ---- H1: server-bound mode via signed JWT claim ---------------------
    def test_token_claim_forces_training_read_even_without_param(self):
        # A training-stamped token sees ONLY training data even though the
        # request carries no training_only param.
        from organizations.access import is_training_only_request, training_view_mode
        r = self._req_token(qs="", mode="training")
        self.assertTrue(is_training_only_request(r))
        self.assertEqual(training_view_mode(r), "training")
        qs = apply_training_filter(Aggregate.objects.all(), r, project_lookup="project")
        self.assertEqual(set(qs.values_list("project__is_training", flat=True)), {True})

    def test_token_claim_overrides_param_attempt_to_read_live(self):
        # The leak the audit flagged: a training user dropping the param to read
        # live data. With a training-bound token they cannot — the claim wins.
        from organizations.access import training_view_mode
        r = self._req_token(qs="?training_only=false&include_training=true", mode="training")
        self.assertEqual(training_view_mode(r), "training")

    def test_training_token_cannot_write_to_live(self):
        with self.assertRaises(PermissionDenied):
            assert_project_write_allowed(self._req_token(mode="training"), self.live_proj)

    def test_no_claim_falls_back_to_param(self):
        # Backward compatibility: tokens without the claim behave exactly as before.
        from organizations.access import is_training_only_request
        self.assertFalse(is_training_only_request(self._req_token(qs="", mode=None)))
        self.assertTrue(is_training_only_request(self._req_token(qs="?training_only=true", mode=None)))

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

    # ---- endpoint-level (real viewsets) --------------------------------
    def _vs_codes(self, viewset_cls, qs=""):
        from rest_framework.test import APIRequestFactory
        w = APIRequestFactory().get("/api/x/" + qs)
        r = Request(w); r.user = self.admin
        v = viewset_cls(); v.request = r; v.kwargs = {}; v.format_kwarg = None; v.action = "list"
        return set(v.get_queryset().values_list("code", flat=True))

    def test_indicator_viewset_live_hides_demo(self):
        from indicators.views import IndicatorViewSet
        live = self._vs_codes(IndicatorViewSet, "")
        train = self._vs_codes(IndicatorViewSet, "?training_only=true")
        self.assertNotIn("DEMO-IND-T", live)
        self.assertIn("LIVE-IND", live)
        self.assertEqual(train, {"DEMO-IND-T"})

    def test_organization_viewset_live_hides_demo(self):
        from organizations.views import OrganizationViewSet
        live = self._vs_codes(OrganizationViewSet, "")
        train = self._vs_codes(OrganizationViewSet, "?training_only=true")
        self.assertNotIn("DEMO-ORG-T", live)
        self.assertIn("LIVE-ORG", live)
        self.assertEqual(train, {"DEMO-ORG-T"})

    def test_project_viewset_admin_live_hides_training(self):
        # Regression: admins were exempted from the project training filter, so
        # is_training projects leaked into the live project dropdowns. Live mode
        # must exclude them even for an admin.
        from projects.views import ProjectViewSet
        live = self._vs_codes(ProjectViewSet, "")
        self.assertIn("LIVE-P", live)
        self.assertNotIn("DEMO-P", live)

    def test_project_viewset_admin_training_shows_only_training(self):
        from projects.views import ProjectViewSet
        train = self._vs_codes(ProjectViewSet, "?training_only=true")
        self.assertEqual(train, {"DEMO-P"})

    def test_project_viewset_admin_include_training_shows_all(self):
        # The explicit admin escape hatch still surfaces everything.
        from projects.views import ProjectViewSet
        allp = self._vs_codes(ProjectViewSet, "?include_training=true")
        self.assertIn("LIVE-P", allp)
        self.assertIn("DEMO-P", allp)

    def test_project_viewset_token_training_hides_live(self):
        # A training-stamped JWT binds the session: live projects stay hidden
        # even if the client omits the query param.
        from projects.views import ProjectViewSet
        w = APIRequestFactory().get("/api/projects/")
        r = Request(w); r.user = self.admin; r._auth = {"mode": "training"}
        v = ProjectViewSet(); v.request = r; v.kwargs = {}; v.format_kwarg = None; v.action = "list"
        codes = set(v.get_queryset().values_list("code", flat=True))
        self.assertEqual(codes, {"DEMO-P"})

    def test_indicator_trends_excludes_demo_in_live(self):
        # The demo indicator has only a training-project aggregate; in live mode
        # its trend series must contain no approved values.
        from analysis.views import indicator_trends
        from rest_framework.test import APIRequestFactory, force_authenticate
        r = APIRequestFactory().get("/api/analysis/indicators/%d/trends/" % self.demo_ind.id)
        force_authenticate(r, user=self.admin)
        resp = indicator_trends(r, indicator_id=self.demo_ind.id)
        total = sum(pt.get("value", 0) or 0 for pt in (resp.data.get("series") or resp.data.get("points") or []))
        self.assertEqual(total, 0)
