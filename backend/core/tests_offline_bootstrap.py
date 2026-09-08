from datetime import date

from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from organizations.models import Organization
from projects.models import Project, ProjectIndicator, ProjectOrganization
from indicators.models import Indicator

User = get_user_model()


class OfflineBootstrapTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.coord = Organization.objects.create(code="COORD", name="Coordinator", type="ngo")
        cls.org = Organization.objects.create(code="ORG", name="Field Org", type="district", parent=cls.coord)
        cls.sub = Organization.objects.create(code="SUB", name="Sub Grantee", type="district", parent=cls.org)

        cls.user = User.objects.create_user(
            username="collector", email="c@example.com", password="pw", role="collector",
            organization=cls.org,
        )

        cls.live_proj = Project.objects.create(
            code="LIVE", name="Live P", start_date=date(2026, 1, 1), end_date=date(2026, 12, 31),
            is_training=False,
        )
        cls.train_proj = Project.objects.create(
            code="TRAIN", name="Train P", start_date=date(2026, 1, 1), end_date=date(2026, 12, 31),
            is_training=True,
        )
        for p in (cls.live_proj, cls.train_proj):
            p.organizations.add(cls.org)

        cls.ind = Indicator.objects.create(code="IND-1", name="People reached")
        ProjectIndicator.objects.create(project=cls.live_proj, indicator=cls.ind, target_group="PLHIV")
        ProjectIndicator.objects.create(project=cls.train_proj, indicator=cls.ind, target_group="Youth")

        ProjectOrganization.objects.create(
            project=cls.live_proj, organization=cls.org, role="sub_grantee",
            districts=["Gaborone"], localities=["Block 6"], is_training=False,
        )

    def test_bootstrap_requires_auth(self):
        self.assertEqual(self.client.get("/api/offline/bootstrap/").status_code, 401)

    def test_live_package_excludes_training(self):
        self.client.force_authenticate(self.user)
        data = self.client.get("/api/offline/bootstrap/").json()
        self.assertEqual(data["mode"], "live")
        codes = {p["code"] for p in data["projects"]}
        self.assertIn("LIVE", codes)
        self.assertNotIn("TRAIN", codes)
        self.assertEqual(data["organization"]["code"], "ORG")
        # coordinator (parent) and sub-grantee (child) resolved
        self.assertIn("COORD", {o["code"] for o in data["coordinator_organizations"]})
        self.assertIn("SUB", {o["code"] for o in data["sub_grantees"]})
        self.assertIn("PLHIV", data["target_groups"])
        self.assertNotIn("Youth", data["target_groups"])  # training-only
        self.assertIn("Gaborone", data["districts"])
        self.assertTrue(data["projects"][0]["reporting_periods"])  # quarters generated

    def test_training_package_only_training(self):
        # Training mode is now bound to the signed JWT claim, not a query param.
        from rest_framework_simplejwt.tokens import AccessToken
        token = AccessToken.for_user(self.user)
        token["mode"] = "training"
        self.client.force_authenticate(self.user, token=token)
        data = self.client.get("/api/offline/bootstrap/").json()
        self.assertEqual(data["mode"], "training")
        codes = {p["code"] for p in data["projects"]}
        self.assertEqual(codes, {"TRAIN"})
        self.assertIn("Youth", data["target_groups"])

    # ------------------------------------------------------------------
    # Respondent-access protection (Phase 1). The offline package carries
    # respondent personal data (unique_id + full name), so it must be gated to
    # data-handling roles — org scope alone must never expose personal data to an
    # external ``client`` (read-only funder) or an unknown role.
    # ------------------------------------------------------------------
    def test_bootstrap_denied_for_client_role(self):
        client_user = User.objects.create_user(
            username="funder", email="f@example.com", password="pw", role="client",
            organization=self.org,
        )
        self.client.force_authenticate(client_user)
        self.assertEqual(self.client.get("/api/offline/bootstrap/").status_code, 403)

    def test_bootstrap_allowed_for_data_roles(self):
        for role in ("officer", "manager", "collector"):
            u = User.objects.create_user(
                username=f"u_{role}", email=f"{role}@example.com", password="pw",
                role=role, organization=self.org,
            )
            self.client.force_authenticate(u)
            self.assertEqual(
                self.client.get("/api/offline/bootstrap/").status_code, 200,
                msg=f"{role} should reach offline bootstrap",
            )

    def test_respondent_pii_only_reachable_by_data_role(self):
        from respondents.models import Respondent
        Respondent.objects.create(
            unique_id="R-1", first_name="Jane", last_name="Doe", organization=self.org,
        )
        # Data role (collector) receives the respondent (personal data present).
        self.client.force_authenticate(self.user)
        data = self.client.get("/api/offline/bootstrap/").json()
        labels = {r["label"] for r in data["respondents"]}
        self.assertTrue(any("Jane Doe" in lbl for lbl in labels))
        # Client role is denied the whole package -> never receives the PII.
        client_user = User.objects.create_user(
            username="funder2", email="f2@example.com", password="pw", role="client",
            organization=self.org,
        )
        self.client.force_authenticate(client_user)
        self.assertEqual(self.client.get("/api/offline/bootstrap/").status_code, 403)
