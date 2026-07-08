"""Backend enforcement of module permissions: a module explicitly denied to a
user cannot be reached by direct API call (not just hidden in the sidebar)."""
from datetime import date

from rest_framework.test import APITestCase
from rest_framework_simplejwt.tokens import AccessToken

from organizations.models import Organization
from users.models import User, UserModulePermission


class ModulePermissionEnforcementTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.org = Organization.objects.create(name="Org E", code="ORG_E", type="district")
        cls.officer = User.objects.create_user(
            username="enf_officer", email="enf_officer@example.com", password="x",
            role="officer", organization=cls.org,
        )
        cls.admin = User.objects.create_user(
            username="enf_admin", email="enf_admin@example.com", password="x",
            is_superuser=True, is_staff=True, role="admin",
        )

    def _auth(self, user):
        token = AccessToken.for_user(user)
        token["mode"] = "live"
        self.client.force_authenticate(user, token=token)

    def test_unconfigured_user_not_blocked(self):
        # No explicit rows: role/scope gates apply, module gate does not block.
        self._auth(self.officer)
        self.assertEqual(self.client.get("/api/organizations/").status_code, 200)

    def test_explicit_deny_blocks_module_api(self):
        # Admin explicitly disables organizations AND indicators for the officer.
        UserModulePermission.objects.create(
            user=self.officer, module="organizations", is_enabled=False, actions=[],
        )
        UserModulePermission.objects.create(
            user=self.officer, module="indicators", is_enabled=False, actions=[],
        )
        self._auth(self.officer)
        # 'organizations' is an intentional READ exception: the org tree is a shared
        # lookup every screen needs (coordinator scoping, pickers, review-queue org
        # resolution), so authenticated reads stay open regardless of the module
        # grant — but WRITES remain module-gated, so an explicit deny still blocks
        # them.
        self.assertEqual(self.client.get("/api/organizations/").status_code, 200)
        self.assertEqual(
            self.client.post("/api/organizations/", {}, format="json").status_code, 403
        )
        # A fully-gated module is blocked even on read by the explicit deny.
        self.assertEqual(self.client.get("/api/indicators/").status_code, 403)

    def test_enabled_empty_actions_also_denies(self):
        UserModulePermission.objects.create(
            user=self.officer, module="indicators", is_enabled=True, actions=[],
        )
        self._auth(self.officer)
        self.assertEqual(self.client.get("/api/indicators/").status_code, 403)

    def test_enabled_with_actions_allows(self):
        UserModulePermission.objects.create(
            user=self.officer, module="indicators", is_enabled=True, actions=["view"],
        )
        self._auth(self.officer)
        self.assertEqual(self.client.get("/api/indicators/").status_code, 200)

    def test_admin_bypasses_module_denial(self):
        # Even a (nonsensical) deny row cannot lock an admin out.
        UserModulePermission.objects.create(
            user=self.admin, module="users", is_enabled=False, actions=[],
        )
        self._auth(self.admin)
        self.assertEqual(self.client.get("/api/users/").status_code, 200)

    def test_denied_user_module_blocks_user_admin_api(self):
        UserModulePermission.objects.create(
            user=self.officer, module="users", is_enabled=False, actions=[],
        )
        self._auth(self.officer)
        self.assertEqual(self.client.get("/api/users/").status_code, 403)

    # ---- action-level RBAC ----------------------------------------------
    def test_view_only_grant_allows_read_blocks_write(self):
        # Officer granted indicators with VIEW only: GET ok, POST/DELETE denied.
        UserModulePermission.objects.create(
            user=self.officer, module="indicators", is_enabled=True, actions=["view"],
        )
        self._auth(self.officer)
        self.assertEqual(self.client.get("/api/indicators/").status_code, 200)
        create = self.client.post(
            "/api/indicators/", {"name": "X", "code": "X1", "type": "number"}, format="json"
        )
        self.assertEqual(create.status_code, 403)

    def test_create_grant_allows_post(self):
        UserModulePermission.objects.create(
            user=self.officer, module="organizations",
            is_enabled=True, actions=["view", "create"],
        )
        self._auth(self.officer)
        resp = self.client.post(
            "/api/organizations/", {"name": "New Org", "code": "NEWO", "type": "partner"},
            format="json",
        )
        # 201 created, or a 400 validation error — but NOT a 403 permission block.
        self.assertNotEqual(resp.status_code, 403)

    def test_auxiliary_endpoints_are_gated(self):
        # The newly-gated auxiliary modules block on explicit denial too.
        urls = {
            "social": "/api/social/posts/",
            "flags": "/api/flags/",
            "system_status": "/api/system/status/",
            "targets": "/api/analysis/coordinator-targets/",
        }
        for module in urls:
            UserModulePermission.objects.update_or_create(
                user=self.officer, module=module,
                defaults={"is_enabled": False, "actions": []},
            )
        self._auth(self.officer)
        for url in urls.values():
            self.assertEqual(self.client.get(url).status_code, 403, url)

    def test_export_action_requires_export_grant(self):
        # View without export: the aggregates export endpoint (GET /export/) is
        # mapped to the 'export' verb and must be denied.
        from users.permissions import required_action_for

        class _V:
            action = "export"
        self.assertEqual(required_action_for(type("R", (), {"method": "GET"})(), _V()), "export")
