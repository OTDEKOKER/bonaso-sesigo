"""Backend permission/enforcement tests for the events (activities) module.

Mirrors users/tests_module_enforcement.py: confirms the events API requires
authentication and honours explicit module denials server-side (not just the
sidebar). Closes audit finding F-G1 (events had no dedicated test file).
"""
from rest_framework.test import APITestCase
from rest_framework_simplejwt.tokens import AccessToken

from organizations.models import Organization
from users.models import User, UserModulePermission

EVENTS_URL = "/api/activities/"


class EventsPermissionTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.org = Organization.objects.create(name="Org Ev", code="ORG_EV", type="district")
        cls.officer = User.objects.create_user(
            username="ev_officer", email="ev_officer@example.com", password="x",
            role="officer", organization=cls.org,
        )

    def _auth(self, user):
        token = AccessToken.for_user(user)
        token["mode"] = "live"
        self.client.force_authenticate(user, token=token)

    def test_requires_authentication(self):
        self.assertEqual(self.client.get(EVENTS_URL).status_code, 401)

    def test_unconfigured_user_reaches_module(self):
        # No explicit row -> module gate does not block (role/scope still apply).
        self._auth(self.officer)
        self.assertEqual(self.client.get(EVENTS_URL).status_code, 200)

    def test_explicit_deny_blocks_events_api(self):
        UserModulePermission.objects.create(
            user=self.officer, module="events", is_enabled=False, actions=[],
        )
        self._auth(self.officer)
        self.assertEqual(self.client.get(EVENTS_URL).status_code, 403)

    def test_view_only_grant_blocks_create(self):
        UserModulePermission.objects.create(
            user=self.officer, module="events", is_enabled=True, actions=["view"],
        )
        self._auth(self.officer)
        # view granted -> list allowed
        self.assertEqual(self.client.get(EVENTS_URL).status_code, 200)
        # create NOT granted -> POST denied by the action-verb gate (403),
        # never a 400/201 (i.e. the permission layer rejects before validation).
        self.assertEqual(self.client.post(EVENTS_URL, {}, format="json").status_code, 403)
