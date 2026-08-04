"""Tests for the CSO Mapping questionnaire API."""
from __future__ import annotations

import hashlib
import uuid
from datetime import timedelta
from io import BytesIO

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase as _DRFAPITestCase

from .models import CsoMappingDraft, CsoMappingSubmission
from .schema import field_is_active, iter_answerable_fields, load_schema

User = get_user_model()


# Isolate every CSO API test to a per-process in-memory cache. The public submit
# throttle stores its counters in the shared file-based cache; without this they
# would accumulate across test runs (and could collide with other state). This is
# also safer than clearing the shared cache. Shadowing the name keeps the test
# classes below unchanged.
@override_settings(
    CACHES={
        "default": {
            "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
            "LOCATION": "cso-mapping-tests",
        }
    },
    CSO_MAPPING_DRAFT_TTL_DAYS=14,
)
class APITestCase(_DRFAPITestCase):
    def _pre_setup(self):
        super()._pre_setup()
        # Reset the (isolated) throttle cache before each test so the public
        # submit/draft rate limits do not accumulate across the suite.
        from django.core.cache import cache

        cache.clear()


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
    """Fix A: raw submissions are admin-only; is_staff alone must not grant access."""

    def setUp(self):
        self.admin = User.objects.create_user(
            username="admin1", email="admin1@example.com", password="x", role="admin"
        )
        self.officer = User.objects.create_user(
            username="officer1", email="officer1@example.com", password="x", role="officer"
        )
        self.manager = User.objects.create_user(
            username="manager1", email="manager1@example.com", password="x", role="manager"
        )
        # A non-administrator who merely has the Django admin-site is_staff flag.
        self.staff_only = User.objects.create_user(
            username="staff1", email="staff1@example.com", password="x",
            role="officer", is_staff=True,
        )
        self.superuser = User.objects.create_user(
            username="root1", email="root1@example.com", password="x",
            role="officer", is_superuser=True,
        )
        self.client.post(
            reverse("cso-mapping-submit"), build_valid_payload("cso"), format="json"
        )

    def _list_status(self, user):
        self.client.force_authenticate(user)
        return self.client.get(reverse("cso-submissions-list")).status_code

    def test_anonymous_denied(self):
        resp = self.client.get(reverse("cso-submissions-list"))
        self.assertIn(resp.status_code, (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN))

    def test_officer_denied(self):
        self.assertEqual(self._list_status(self.officer), status.HTTP_403_FORBIDDEN)

    def test_manager_denied(self):
        self.assertEqual(self._list_status(self.manager), status.HTTP_403_FORBIDDEN)

    def test_is_staff_alone_denied(self):
        # The core of Fix A: is_staff=True must NOT unlock personal data.
        self.assertEqual(self._list_status(self.staff_only), status.HTTP_403_FORBIDDEN)

    def test_admin_allowed(self):
        self.assertEqual(self._list_status(self.admin), status.HTTP_200_OK)

    def test_superuser_allowed(self):
        self.assertEqual(self._list_status(self.superuser), status.HTTP_200_OK)

    def test_detail_summary_export_are_all_admin_gated(self):
        sub = CsoMappingSubmission.objects.get()
        targets = [
            reverse("cso-submissions-detail", kwargs={"pk": sub.pk}),
            reverse("cso-submissions-summary"),
            reverse("cso-submissions-export"),
        ]
        for url in targets:
            self.client.force_authenticate(self.officer)
            self.assertEqual(self.client.get(url).status_code, status.HTTP_403_FORBIDDEN, url)
            self.client.force_authenticate(self.admin)
            self.assertEqual(self.client.get(url).status_code, status.HTTP_200_OK, url)

    def test_admin_export_is_hardened_three_sheet_workbook(self):
        from openpyxl import load_workbook

        self.client.force_authenticate(self.admin)
        resp = self.client.get(reverse("cso-submissions-export"))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(
            resp["Content-Type"],
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
        wb = load_workbook(BytesIO(resp.content))
        self.assertEqual(
            wb.sheetnames,
            ["Health Service CSOs", "Coordinating Bodies", "Strategic Structures"],
        )
        cso = wb["Health Service CSOs"]
        self.assertEqual(cso.max_row, 2)  # header + 1 CSO submission
        self.assertEqual(cso.freeze_panes, "A2")  # header frozen
        self.assertIsNotNone(cso.auto_filter.ref)  # filters enabled
        headers = [cell.value for cell in cso[1]]
        self.assertTrue(any(h and "nature of your CSO" in h for h in headers))
        # A category with no submissions still gets a header-only sheet.
        self.assertEqual(wb["Coordinating Bodies"].max_row, 1)


class IdempotencyTests(APITestCase):
    """Fix B: a repeated questionnaire attempt must not create a second row."""

    def setUp(self):
        self.url = reverse("cso-mapping-submit")

    def test_same_client_id_creates_one_row_and_replays_receipt(self):
        payload = build_valid_payload("cso")
        payload["client_submission_id"] = str(uuid.uuid4())
        first = self.client.post(self.url, payload, format="json")
        self.assertEqual(first.status_code, status.HTTP_201_CREATED, first.data)
        again = self.client.post(self.url, payload, format="json")
        self.assertEqual(again.status_code, status.HTTP_200_OK)  # replay, not created
        self.assertEqual(CsoMappingSubmission.objects.count(), 1)
        self.assertEqual(first.data["reference"], again.data["reference"])

    def test_different_client_id_creates_second_row(self):
        p1 = build_valid_payload("cso"); p1["client_submission_id"] = str(uuid.uuid4())
        p2 = build_valid_payload("cso"); p2["client_submission_id"] = str(uuid.uuid4())
        self.client.post(self.url, p1, format="json")
        self.client.post(self.url, p2, format="json")
        self.assertEqual(CsoMappingSubmission.objects.count(), 2)

    def test_invalid_client_id_rejected(self):
        payload = build_valid_payload("cso")
        payload["client_submission_id"] = "not-a-uuid"
        resp = self.client.post(self.url, payload, format="json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("client_submission_id", resp.data)

    def test_db_unique_constraint_blocks_concurrent_duplicate(self):
        from django.db import IntegrityError, transaction

        cid = uuid.uuid4()
        CsoMappingSubmission.objects.create(respondent_type="cso", client_submission_id=cid)
        with self.assertRaises(IntegrityError), transaction.atomic():
            CsoMappingSubmission.objects.create(respondent_type="cso", client_submission_id=cid)


class ReceiptTests(APITestCase):
    """Fix G: the response exposes a public reference, not the sequential PK."""

    def test_receipt_shape(self):
        resp = self.client.post(
            reverse("cso-mapping-submit"), build_valid_payload("cso"), format="json"
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertNotIn("id", resp.data)  # do not leak the sequential PK
        self.assertRegex(resp.data["reference"], r"^CSO-\d{4}-[0-9A-F]{8}$")
        self.assertIn("responding_entity", resp.data)
        self.assertIn("submitted_at", resp.data)


class ExcelInjectionTests(APITestCase):
    """Fix H: respondent-supplied formulas are neutralised in the workbook."""

    def setUp(self):
        self.admin = User.objects.create_user(
            username="ad", email="ad@example.com", password="x", role="admin"
        )

    def test_formula_values_are_neutralised_but_db_unchanged(self):
        from openpyxl import load_workbook

        payload = build_valid_payload("cso")
        payload["responding_entity"] = '=HYPERLINK("https://example.com","Click")'
        payload["annex2_a2_1a"] = "@SUM(A1:A3)"
        payload["annex2_a2_1b"] = "+1+1"
        payload["annex2_a2_1c"] = "-2+3"
        self.client.post(reverse("cso-mapping-submit"), payload, format="json")

        sub = CsoMappingSubmission.objects.get()
        # The database keeps the exact original value.
        self.assertEqual(sub.responding_entity, '=HYPERLINK("https://example.com","Click")')
        self.assertEqual(sub.answers["annex2_a2_1a"], "@SUM(A1:A3)")

        self.client.force_authenticate(self.admin)
        resp = self.client.get(reverse("cso-submissions-export"))
        wb = load_workbook(BytesIO(resp.content))
        cso = wb["Health Service CSOs"]
        cell_values = [c.value for row in cso.iter_rows(min_row=2) for c in row]
        dangerous = [
            v for v in cell_values if isinstance(v, str) and v[:1] in ("=", "+", "-", "@")
        ]
        self.assertEqual(dangerous, [], f"un-neutralised formula cells: {dangerous}")


class AuditTests(APITestCase):
    """Fix I: admin views and exports are recorded in the audit stream."""

    def setUp(self):
        self.admin = User.objects.create_user(
            username="ad", email="ad@example.com", password="x", role="admin"
        )
        self.client.post(
            reverse("cso-mapping-submit"), build_valid_payload("cso"), format="json"
        )
        self.sub = CsoMappingSubmission.objects.get()

    def test_detail_view_is_audited(self):
        from audit.models import AuditEvent

        self.client.force_authenticate(self.admin)
        self.client.get(reverse("cso-submissions-detail", kwargs={"pk": self.sub.pk}))
        self.assertTrue(
            AuditEvent.objects.filter(
                action="view", object_type="cso_submission", object_id=str(self.sub.pk)
            ).exists()
        )

    def test_export_is_audited_with_count_and_actor(self):
        from audit.models import AuditEvent

        self.client.force_authenticate(self.admin)
        self.client.get(reverse("cso-submissions-export"))
        event = (
            AuditEvent.objects.filter(action="export", object_type="cso_submission")
            .order_by("-id")
            .first()
        )
        self.assertIsNotNone(event)
        self.assertEqual(event.metadata.get("records"), 1)
        self.assertEqual(event.actor, self.admin)


class SchemaIntegrityTests(APITestCase):
    """Fix K: branch isolation + final confirmation are enforced by the schema."""

    def test_annex_branches_are_isolated_and_confirmation_enforced(self):
        schema = load_schema()
        gate = {
            "annex2": "cso",
            "annex3": "coordinating_body",
            "annex4": "strategic_structure",
        }
        all_types = ["cso", "coordinating_body", "strategic_structure"]
        for section in schema["sections"]:
            for field in section["fields"]:
                for prefix, owner in gate.items():
                    if not field["name"].startswith(prefix):
                        continue
                    # Active only under its owning respondent type (checks section
                    # AND field relevance — path-intro notes are gated per-field).
                    for rtype in all_types:
                        ctx = {"consent": "yes", "respondent_type": rtype}
                        active = field_is_active(section, field, ctx)
                        if rtype == owner:
                            self.assertTrue(active, f"{field['name']} inactive for {owner}")
                        else:
                            self.assertFalse(active, f"{field['name']} leaked into {rtype}")
        confirm = next(
            f
            for s in schema["sections"]
            for f in s["fields"]
            if f["name"] == "information_confirmed"
        )
        self.assertTrue(confirm["required"])
        self.assertEqual(confirm["constraint"]["value"], "yes")


def _create_draft(client, answers=None, step=0, client_submission_id=None):
    body = {"answers": answers or {}, "current_step": step, "form_version": "test"}
    if client_submission_id:
        body["client_submission_id"] = client_submission_id
    return client.post(reverse("cso-mapping-draft-create"), body, format="json")


def _detail_url(token):
    return reverse("cso-mapping-draft-detail", kwargs={"token": token})


def _submit_url(token):
    return reverse("cso-mapping-draft-submit", kwargs={"token": token})


class DraftLifecycleTests(APITestCase):
    """Section C: create / update / retrieve / delete / expire / complete."""

    def test_create_returns_opaque_token_and_state(self):
        resp = _create_draft(self.client, {"consent": "yes"}, step=1)
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        self.assertIn("resume_token", resp.data)
        self.assertGreater(len(resp.data["resume_token"]), 30)  # high-entropy token
        self.assertEqual(resp.data["current_step"], 1)
        self.assertIn("expires_at", resp.data)

    def test_raw_token_is_not_stored_only_its_hash(self):
        resp = _create_draft(self.client, {"consent": "yes"})
        raw = resp.data["resume_token"]
        draft = CsoMappingDraft.objects.get()
        self.assertEqual(draft.token_hash, hashlib.sha256(raw.encode()).hexdigest())
        self.assertNotEqual(draft.token_hash, raw)  # not the raw token
        # The raw token appears in no stored text field.
        for value in (draft.token_hash, draft.form_version, str(draft.answers)):
            self.assertNotIn(raw, value)

    def test_update_and_retrieve(self):
        token = _create_draft(self.client, {"consent": "yes"}).data["resume_token"]
        put = self.client.put(
            _detail_url(token),
            {"answers": {"consent": "yes", "respondent_type": "cso"}, "current_step": 2},
            format="json",
        )
        self.assertEqual(put.status_code, status.HTTP_200_OK)
        got = self.client.get(_detail_url(token))
        self.assertEqual(got.status_code, status.HTTP_200_OK)
        self.assertEqual(got.data["current_step"], 2)
        self.assertEqual(got.data["answers"]["respondent_type"], "cso")

    def test_invalid_token_is_404(self):
        self.assertEqual(
            self.client.get(_detail_url("nope")).status_code, status.HTTP_404_NOT_FOUND
        )
        self.assertEqual(
            self.client.put(_detail_url("nope"), {"answers": {}}, format="json").status_code,
            status.HTTP_404_NOT_FOUND,
        )

    def test_expired_token_is_404(self):
        token = _create_draft(self.client, {"consent": "yes"}).data["resume_token"]
        CsoMappingDraft.objects.update(expires_at=timezone.now() - timedelta(minutes=1))
        self.assertEqual(
            self.client.get(_detail_url(token)).status_code, status.HTTP_404_NOT_FOUND
        )

    def test_deleted_token_is_404(self):
        token = _create_draft(self.client, {"consent": "yes"}).data["resume_token"]
        self.assertEqual(
            self.client.delete(_detail_url(token)).status_code, status.HTTP_204_NO_CONTENT
        )
        self.assertEqual(
            self.client.get(_detail_url(token)).status_code, status.HTTP_404_NOT_FOUND
        )

    def test_delete_unknown_token_still_204(self):
        # Does not reveal whether the token existed.
        self.assertEqual(
            self.client.delete(_detail_url("nope")).status_code, status.HTTP_204_NO_CONTENT
        )

    @override_settings(CSO_MAPPING_DRAFT_TTL_DAYS=1)
    def test_expiry_uses_configured_ttl(self):
        resp = _create_draft(self.client, {"consent": "yes"})
        draft = CsoMappingDraft.objects.get()
        delta = draft.expires_at - timezone.now()
        self.assertGreater(delta, timedelta(hours=23))
        self.assertLess(delta, timedelta(hours=25))

    def test_expired_drafts_cleanup_command(self):
        keep = _create_draft(self.client, {"consent": "yes"}).data["resume_token"]
        gone = _create_draft(self.client, {"consent": "yes"}).data["resume_token"]
        CsoMappingDraft.objects.filter(
            token_hash=CsoMappingDraft.hash_token(gone)
        ).update(expires_at=timezone.now() - timedelta(days=1))
        call_command("cleanup_cso_drafts")
        self.assertTrue(
            CsoMappingDraft.objects.filter(token_hash=CsoMappingDraft.hash_token(keep)).exists()
        )
        self.assertFalse(
            CsoMappingDraft.objects.filter(token_hash=CsoMappingDraft.hash_token(gone)).exists()
        )


class DraftValidationTests(APITestCase):
    """Section C: drafts are lenient on required, strict on choices/size/branch."""

    def _put(self, answers):
        token = _create_draft(self.client, {"consent": "yes"}).data["resume_token"]
        return self.client.put(_detail_url(token), {"answers": answers}, format="json"), token

    def test_required_fields_may_stay_incomplete(self):
        resp, _ = self._put({"consent": "yes", "respondent_type": "cso"})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)  # no required-field block

    def test_invalid_choice_rejected(self):
        resp, _ = self._put({"consent": "yes", "respondent_type": "not_valid"})
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_oversized_value_rejected(self):
        resp, _ = self._put({"consent": "yes", "respondent_type": "cso", "annex2_a2_1a": "x" * 20001})
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_unknown_field_ignored(self):
        resp, token = self._put({"consent": "yes", "totally_unknown": "x"})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        got = self.client.get(_detail_url(token))
        self.assertNotIn("totally_unknown", got.data["answers"])

    def test_inactive_branch_answers_stripped(self):
        resp, token = self._put({"consent": "yes", "respondent_type": "cso", "annex3_a3_1a": "x"})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        got = self.client.get(_detail_url(token))
        self.assertNotIn("annex3_a3_1a", got.data["answers"])

    def test_respondent_type_change_removes_old_branch(self):
        token = _create_draft(self.client, {"consent": "yes"}).data["resume_token"]
        self.client.put(
            _detail_url(token),
            {"answers": {"consent": "yes", "respondent_type": "cso", "annex2_a2_1a": "x"}},
            format="json",
        )
        self.client.put(
            _detail_url(token),
            {"answers": {"consent": "yes", "respondent_type": "coordinating_body"}},
            format="json",
        )
        answers = self.client.get(_detail_url(token)).data["answers"]
        self.assertNotIn("annex2_a2_1a", answers)
        self.assertEqual(answers["respondent_type"], "coordinating_body")


class DraftSubmitTests(APITestCase):
    """Section C: atomic draft -> submission conversion + idempotency."""

    def test_final_submit_validates_all_required(self):
        token = _create_draft(self.client, {"consent": "yes"}).data["resume_token"]
        # Missing required annex answers -> full validation fails; nothing created.
        resp = self.client.post(
            _submit_url(token),
            {"consent": "yes", "respondent_type": "cso", "responding_entity": "X"},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(CsoMappingSubmission.objects.count(), 0)
        # Draft is untouched (conversion is atomic).
        self.assertEqual(self.client.get(_detail_url(token)).status_code, status.HTTP_200_OK)

    def test_conversion_creates_one_submission_and_completes_draft(self):
        token = _create_draft(self.client, {"consent": "yes"}).data["resume_token"]
        payload = build_valid_payload("cso")
        payload["client_submission_id"] = str(uuid.uuid4())
        resp = self.client.post(_submit_url(token), payload, format="json")
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        self.assertEqual(CsoMappingSubmission.objects.count(), 1)
        draft = CsoMappingDraft.objects.get()
        self.assertIsNotNone(draft.completed_at)
        self.assertEqual(draft.submission, CsoMappingSubmission.objects.get())
        self.assertEqual(draft.answers, {})  # personal data cleared after conversion
        # A completed draft cannot be resumed.
        self.assertEqual(self.client.get(_detail_url(token)).status_code, status.HTTP_404_NOT_FOUND)

    def test_repeated_final_submit_returns_same_receipt_no_duplicate(self):
        token = _create_draft(self.client, {"consent": "yes"}).data["resume_token"]
        payload = build_valid_payload("cso")
        payload["client_submission_id"] = str(uuid.uuid4())
        first = self.client.post(_submit_url(token), payload, format="json")
        second = self.client.post(_submit_url(token), payload, format="json")
        self.assertEqual(first.status_code, status.HTTP_201_CREATED)
        self.assertEqual(second.status_code, status.HTTP_200_OK)
        self.assertEqual(first.data["reference"], second.data["reference"])
        self.assertEqual(CsoMappingSubmission.objects.count(), 1)

    def test_different_client_id_creates_separate_submission(self):
        for _ in range(2):
            token = _create_draft(self.client, {"consent": "yes"}).data["resume_token"]
            payload = build_valid_payload("cso")
            payload["client_submission_id"] = str(uuid.uuid4())
            self.client.post(_submit_url(token), payload, format="json")
        self.assertEqual(CsoMappingSubmission.objects.count(), 2)

    def test_public_draft_flow_writes_no_audit_events(self):
        from audit.models import AuditEvent

        token = _create_draft(self.client, {"consent": "yes"}).data["resume_token"]
        self.client.put(
            _detail_url(token),
            {"answers": {"consent": "yes", "respondent_type": "cso"}},
            format="json",
        )
        payload = build_valid_payload("cso")
        payload["client_submission_id"] = str(uuid.uuid4())
        self.client.post(_submit_url(token), payload, format="json")
        # No personal questionnaire data is written to the audit stream by the
        # public flow (audit records only admin views/exports).
        self.assertEqual(AuditEvent.objects.count(), 0)

    def test_draft_endpoints_are_throttled(self):
        from .views import DraftCreateView, DraftDetailView, DraftSubmitView

        self.assertEqual(DraftCreateView.throttle_scope, "cso_mapping")
        self.assertEqual(DraftDetailView.throttle_scope, "cso_mapping_draft")
        self.assertEqual(DraftSubmitView.throttle_scope, "cso_mapping")


class DraftConfigCheckTests(APITestCase):
    """Section C: production must configure the draft retention (TTL) explicitly."""

    def test_check_errors_when_prod_ttl_missing(self):
        import os

        from .checks import draft_ttl_configured

        with override_settings(DEBUG=False):
            saved = os.environ.pop("CSO_MAPPING_DRAFT_TTL_DAYS", None)
            try:
                errors = draft_ttl_configured(None)
                self.assertTrue(any(e.id == "cso_mapping.E001" for e in errors))
            finally:
                if saved is not None:
                    os.environ["CSO_MAPPING_DRAFT_TTL_DAYS"] = saved

    def test_check_passes_when_prod_ttl_set(self):
        import os

        from .checks import draft_ttl_configured

        with override_settings(DEBUG=False):
            saved = os.environ.get("CSO_MAPPING_DRAFT_TTL_DAYS")
            os.environ["CSO_MAPPING_DRAFT_TTL_DAYS"] = "30"
            try:
                self.assertEqual(draft_ttl_configured(None), [])
            finally:
                if saved is None:
                    os.environ.pop("CSO_MAPPING_DRAFT_TTL_DAYS", None)
                else:
                    os.environ["CSO_MAPPING_DRAFT_TTL_DAYS"] = saved
