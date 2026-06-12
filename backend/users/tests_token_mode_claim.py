"""Every issued JWT must carry a signed environment ``mode`` claim (H1+).

The claim is the sole server-side source of truth for training/live isolation,
so it must be present on the access token, survive refresh+rotation, and reflect
the login's requested mode.
"""
from rest_framework.test import APITestCase
from rest_framework_simplejwt.tokens import AccessToken

from organizations.models import Organization
from users.models import User


class TokenModeClaimTests(APITestCase):
    LOGIN_URL = "/api/users/request-token/"
    REFRESH_URL = "/api/users/token/refresh/"

    def setUp(self):
        self.org = Organization.objects.create(name="Org M", code="ORG_MODE", type="district")
        self.user = User.objects.create_user(
            username="mode_user", email="mode@example.com",
            password="TestPass123!", role="officer", organization=self.org,
        )

    def _login(self, **extra):
        return self.client.post(
            self.LOGIN_URL,
            {"username": "mode_user", "password": "TestPass123!", **extra},
            format="json",
        )

    def test_live_login_stamps_live_claim(self):
        resp = self._login()
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(AccessToken(resp.data["access"])["mode"], "live")

    def test_training_login_stamps_training_claim(self):
        resp = self._login(mode="training")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(AccessToken(resp.data["access"])["mode"], "training")

    def test_unknown_mode_defaults_to_live(self):
        resp = self._login(mode="hacker")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(AccessToken(resp.data["access"])["mode"], "live")

    def test_live_only_user_cannot_login_training(self):
        self.user.environment_access = "live"
        self.user.save(update_fields=["environment_access"])
        resp = self._login(mode="training")
        self.assertEqual(resp.status_code, 403)
        # but live login still works and is stamped live
        ok = self._login()
        self.assertEqual(ok.status_code, 200)
        self.assertEqual(AccessToken(ok.data["access"])["mode"], "live")

    def test_training_only_user_cannot_login_live(self):
        self.user.environment_access = "training"
        self.user.save(update_fields=["environment_access"])
        self.assertEqual(self._login().status_code, 403)
        self.assertEqual(self._login(mode="training").status_code, 200)

    def test_both_user_can_login_either(self):
        self.assertEqual(self._login().status_code, 200)
        self.assertEqual(self._login(mode="training").status_code, 200)

    def test_mode_claim_survives_refresh_and_rotation(self):
        resp = self._login(mode="training")
        refresh = resp.data["refresh"]
        r2 = self.client.post(self.REFRESH_URL, {"refresh": refresh}, format="json")
        self.assertEqual(r2.status_code, 200)
        self.assertEqual(AccessToken(r2.data["access"])["mode"], "training")
        # ROTATE_REFRESH_TOKENS=True: the rotated refresh must keep the claim too.
        if "refresh" in r2.data:
            from rest_framework_simplejwt.tokens import RefreshToken
            self.assertEqual(RefreshToken(r2.data["refresh"])["mode"], "training")
