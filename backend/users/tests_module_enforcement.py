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
        # Admin explicitly disables the organizations module for the officer.
        UserModulePermission.objects.create(
            user=self.officer, module="organizations", is_enabled=False, actions=[],
        )
        self._auth(self.officer)
        self.assertEqual(self.client.get("/api/organizations/").status_code, 403)
        # A module that was NOT denied stays reachable (no collateral lockout).
        self.assertEqual(self.client.get("/api/indicators/").status_code, 200)

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
