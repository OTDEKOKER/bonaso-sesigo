"""Tests for the CSO Mapping questionnaire API."""
from __future__ import annotations

from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from .models import CsoMappingSubmission
from .schema import field_is_active, iter_answerable_fields, load_schema

User = get_user_model()


def build_valid_payload(respondent_type: str = "cso") -> dict:
    """Construct a complete, valid submission for a given respondent branch."""
    schema = load_schema()
    ctx = {"consent": "yes", "respondent_type": respondent_type, "information_confirmed": "yes"}
    payload = dict(ctx)
    for section, field in iter_answerable_fields(schema):
        if not field_is_active(section, field, ctx):
            continue
        name = field["name"]
        if name in payload:
            continue
        if field["type"] == "select_one":
            payload[name] = field["choices"][0]["name"]
        elif name == "respondent_email":
            payload[name] = "respondent@example.org"
        else:
            payload[name] = f"Answer for {name}"
    return payload


class SchemaEndpointTests(APITestCase):
    def test_schema_is_public(self):
        resp = self.client.get(reverse("cso-mapping-schema"))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertIn("sections", resp.data)
        self.assertTrue(len(resp.data["sections"]) > 0)


class SubmissionCreateTests(APITestCase):
    def setUp(self):
        self.url = reverse("cso-mapping-submit")

    def test_valid_cso_submission_is_stored_locally(self):
        payload = build_valid_payload("cso")
        resp = self.client.post(self.url, payload, format="json")
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        self.assertEqual(CsoMappingSubmission.objects.count(), 1)
        sub = CsoMappingSubmission.objects.get()
        self.assertTrue(sub.consent)
        self.assertEqual(sub.respondent_type, "cso")
        self.assertTrue(sub.information_confirmed)
        # Annex 2 answers land in the JSON blob; other annexes are absent.
        self.assertIn("annex2_a2_1a", sub.answers)
        self.assertFalse(any(k.startswith("annex3_") for k in sub.answers))
        self.assertFalse(any(k.startswith("annex4_") for k in sub.answers))

    def test_consent_is_required(self):
        payload = build_valid_payload("cso")
        payload["consent"] = "no"
        resp = self.client.post(self.url, payload, format="json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("consent", resp.data)
        self.assertEqual(CsoMappingSubmission.objects.count(), 0)

    def test_missing_required_admin_field_rejected(self):
        payload = build_valid_payload("cso")
        payload["responding_entity"] = ""
        resp = self.client.post(self.url, payload, format="json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("responding_entity", resp.data)

    def test_missing_required_annex_field_rejected(self):
        payload = build_valid_payload("cso")
        payload["annex2_a2_1a"] = ""
        resp = self.client.post(self.url, payload, format="json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("annex2_a2_1a", resp.data)

    def test_information_confirmed_must_be_yes(self):
        payload = build_valid_payload("cso")
        payload["information_confirmed"] = "no"
        resp = self.client.post(self.url, payload, format="json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("information_confirmed", resp.data)

    def test_invalid_select_choice_rejected(self):
        payload = build_valid_payload("cso")
        payload["respondent_type"] = "not_a_real_type"
        resp = self.client.post(self.url, payload, format="json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_inactive_branch_answers_are_ignored(self):
        # A CSO respondent who somehow also sends an Annex 3 answer: it must be
        # neither required nor stored.
        payload = build_valid_payload("cso")
        payload["annex3_a3_1a"] = "stray value"
        resp = self.client.post(self.url, payload, format="json")
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        sub = CsoMappingSubmission.objects.get()
        self.assertNotIn("annex3_a3_1a", sub.answers)

    def test_coordinating_body_branch(self):
        payload = build_valid_payload("coordinating_body")
        resp = self.client.post(self.url, payload, format="json")
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        sub = CsoMappingSubmission.objects.get()
        self.assertIn("annex3_a3_1a", sub.answers)


class StaffAccessTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            username="admin1", email="admin1@example.com", password="x", role="admin"
        )
        self.officer = User.objects.create_user(
            username="officer1", email="officer1@example.com", password="x", role="officer"
        )
        self.client.post(
            reverse("cso-mapping-submit"), build_valid_payload("cso"), format="json"
        )

    def test_anonymous_cannot_list(self):
        resp = self.client.get(reverse("cso-submissions-list"))
        self.assertIn(resp.status_code, (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN))

    def test_non_admin_cannot_list(self):
        self.client.force_authenticate(self.officer)
        resp = self.client.get(reverse("cso-submissions-list"))
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_admin_can_list_and_export(self):
        self.client.force_authenticate(self.admin)
        list_resp = self.client.get(reverse("cso-submissions-list"))
        self.assertEqual(list_resp.status_code, status.HTTP_200_OK)
        self.assertEqual(list_resp.data["count"], 1)

        export_resp = self.client.get(reverse("cso-submissions-export"))
        self.assertEqual(export_resp.status_code, status.HTTP_200_OK)
        self.assertEqual(export_resp["Content-Type"], "text/csv")
        body = export_resp.content.decode("utf-8")
        self.assertIn("annex2_a2_1a", body)
