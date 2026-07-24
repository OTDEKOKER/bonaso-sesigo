"""Mandatory confidentiality acknowledgement gate (users app).

The frontend blocks every protected page until ``/me`` reports
``needs_acknowledgement == False``. Acceptance is recorded once per
``(user, version)`` with the environment taken from the signed JWT ``mode``
claim, and the gate re-prompts whenever ``CONFIDENTIALITY_ACK_VERSION`` changes.
"""
from django.test import override_settings
from rest_framework.test import APITestCase

from organizations.models import Organization
from users.models import User, ConfidentialityAcknowledgement

ACK_URL = "/api/users/confidentiality-acknowledgement/"
ME_URL = "/api/users/me/"
LOGIN_URL = "/api/users/request-token/"
VERSION = "test-v1"


@override_settings(CONFIDENTIALITY_ACK_VERSION=VERSION)
class ConfidentialityAckTests(APITestCase):
    def setUp(self):
        self.org = Organization.objects.create(name="Org C", code="ORG_CONF", type="district")
        self.user = User.objects.create_user(
            username="conf_user", email="conf@example.com",
            password="TestPass123!", role="officer", organization=self.org,
        )

    def _access_token(self, **extra):
        resp = self.client.post(
            LOGIN_URL,
            {"username": "conf_user", "password": "TestPass123!", **extra},
            format="json",
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        return resp.data["access"]

    def _auth(self, **extra):
        """Authenticate the test client with a token carrying the mode claim."""
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self._access_token(**extra)}")

    def _me_confidentiality(self):
        resp = self.client.get(ME_URL)
        self.assertEqual(resp.status_code, 200, resp.data)
        return resp.data["confidentiality"]

    # --- gate status via /me -------------------------------------------------
    def test_me_reports_needs_acknowledgement_before_accept(self):
        self._auth()
        conf = self._me_confidentiality()
        self.assertEqual(conf["required_version"], VERSION)
        self.assertTrue(conf["needs_acknowledgement"])

    def test_rejection_path_user_who_never_accepts_stays_blocked(self):
        # A user who signs out instead of accepting records nothing and stays gated.
        self._auth()
        self.assertFalse(
            ConfidentialityAcknowledgement.objects.filter(user=self.user).exists()
        )
        self.assertTrue(self._me_confidentiality()["needs_acknowledgement"])

    # --- acceptance ----------------------------------------------------------
    def test_accept_records_row_and_clears_gate(self):
        self._auth()
        resp = self.client.post(ACK_URL)
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertFalse(resp.data["needs_acknowledgement"])
        row = ConfidentialityAcknowledgement.objects.get(user=self.user, version=VERSION)
        self.assertEqual(row.environment, "live")
        self.assertIsNotNone(row.accepted_at)
        self.assertFalse(self._me_confidentiality()["needs_acknowledgement"])

    def test_accept_records_training_environment_from_claim(self):
        self._auth(mode="training")
        self.client.post(ACK_URL)
        row = ConfidentialityAcknowledgement.objects.get(user=self.user, version=VERSION)
        self.assertEqual(row.environment, "training")

    def test_accept_is_idempotent(self):
        self._auth()
        self.client.post(ACK_URL)
        self.client.post(ACK_URL)
        self.assertEqual(
            ConfidentialityAcknowledgement.objects.filter(
                user=self.user, version=VERSION
            ).count(),
            1,
        )

    def test_unauthenticated_cannot_accept(self):
        resp = self.client.post(ACK_URL)
        self.assertIn(resp.status_code, (401, 403))
        self.assertFalse(ConfidentialityAcknowledgement.objects.exists())

    # --- version change re-prompts ------------------------------------------
    def test_version_bump_reprompts_and_records_separately(self):
        self._auth()
        self.client.post(ACK_URL)  # accept test-v1
        self.assertFalse(self._me_confidentiality()["needs_acknowledgement"])

        with override_settings(CONFIDENTIALITY_ACK_VERSION="test-v2"):
            conf = self._me_confidentiality()
            self.assertEqual(conf["required_version"], "test-v2")
            self.assertTrue(conf["needs_acknowledgement"])
            self.client.post(ACK_URL)  # accept the new version
            self.assertFalse(self._me_confidentiality()["needs_acknowledgement"])
            self.assertTrue(
                ConfidentialityAcknowledgement.objects.filter(
                    user=self.user, version="test-v2"
                ).exists()
            )
        # the original acceptance is retained as an audit record
        self.assertTrue(
            ConfidentialityAcknowledgement.objects.filter(
                user=self.user, version=VERSION
            ).exists()
        )
