"""Backend permission/enforcement tests for the flags module.

Closes audit finding F-G1 (flags had no dedicated test file). Confirms the
flags API requires authentication and honours explicit module denials.
"""
from rest_framework.test import APITestCase
from rest_framework_simplejwt.tokens import AccessToken

from organizations.models import Organization
from users.models import User, UserModulePermission

FLAGS_URL = "/api/flags/"


class FlagsPermissionTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.org = Organization.objects.create(name="Org Fl", code="ORG_FL", type="district")
        cls.officer = User.objects.create_user(
            username="fl_officer", email="fl_officer@example.com", password="x",
            role="officer", organization=cls.org,
        )

    def _auth(self, user):
        token = AccessToken.for_user(user)
        token["mode"] = "live"
        self.client.force_authenticate(user, token=token)

    def test_requires_authentication(self):
        self.assertEqual(self.client.get(FLAGS_URL).status_code, 401)

    def test_unconfigured_user_reaches_module(self):
        self._auth(self.officer)
        self.assertEqual(self.client.get(FLAGS_URL).status_code, 200)

    def test_explicit_deny_blocks_flags_api(self):
        UserModulePermission.objects.create(
            user=self.officer, module="flags", is_enabled=False, actions=[],
        )
        self._auth(self.officer)
        self.assertEqual(self.client.get(FLAGS_URL).status_code, 403)

    def test_enabled_empty_actions_also_denies(self):
        UserModulePermission.objects.create(
            user=self.officer, module="flags", is_enabled=True, actions=[],
        )
        self._auth(self.officer)
        self.assertEqual(self.client.get(FLAGS_URL).status_code, 403)
