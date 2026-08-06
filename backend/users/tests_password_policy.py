"""DPA password-expiry policy + admin-approved reset-request workflow.

Covers:
- User.set_password stamps password_changed_at (the expiry clock).
- is_password_expired / password_status under enabled / disabled / null cases.
- /me exposes password_status.
- Self-service change-password (wrong current, same-as-old, success resets clock).
- Public reset-request (matched, unmatched/anti-enumeration, no duplicate pending).
- Admin list/approve/reject (admin-gated; approve resets password + closes request).
"""
from datetime import timedelta

from django.core.cache import cache
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APITestCase

from organizations.models import Organization
from users.models import User, PasswordResetRequest

ME_URL = "/api/users/me/"
LOGIN_URL = "/api/users/request-token/"
CHANGE_URL = "/api/users/change-password/"
REQUEST_URL = "/api/users/password-reset-request/"
LIST_URL = "/api/users/password-reset-requests/"


@override_settings(PASSWORD_EXPIRY_DAYS=90, PASSWORD_EXPIRY_WARN_DAYS=14)
class PasswordPolicyTests(APITestCase):
    def setUp(self):
        cache.clear()  # reset shared throttle history between tests
        self.org = Organization.objects.create(name="Org P", code="ORG_PW", type="district")
        self.user = User.objects.create_user(
            username="pw_user", email="pw@example.com",
            password="OldPass123!", role="officer", organization=self.org,
        )
        self.admin = User.objects.create_user(
            username="pw_admin", email="admin@example.com",
            password="AdminPass123!", role="admin", organization=self.org,
        )

    def _token(self, username, password):
        resp = self.client.post(LOGIN_URL, {"username": username, "password": password}, format="json")
        return resp

    def _auth(self, user):
        self.client.force_authenticate(user=user)

    # --- model / stamping ----------------------------------------------------
    def test_set_password_stamps_timestamp(self):
        self.assertIsNotNone(self.user.password_changed_at)
        before = self.user.password_changed_at
        self.user.password_changed_at = timezone.now() - timedelta(days=10)
        self.user.set_password("BrandNew123!")
        self.assertGreater(self.user.password_changed_at, before - timedelta(days=10))

    def test_fresh_user_not_expired(self):
        self.assertFalse(self.user.is_password_expired)

    def test_old_password_is_expired(self):
        self.user.password_changed_at = timezone.now() - timedelta(days=91)
        self.assertTrue(self.user.is_password_expired)

    def test_null_timestamp_treated_expired(self):
        self.user.password_changed_at = None
        self.assertTrue(self.user.is_password_expired)

    @override_settings(PASSWORD_EXPIRY_DAYS=0)
    def test_disabled_never_expires(self):
        self.user.password_changed_at = timezone.now() - timedelta(days=999)
        self.assertFalse(self.user.is_password_expired)
        status = self.user.password_status()
        self.assertFalse(status["expiry_enabled"])
        self.assertFalse(status["expired"])

    def test_me_exposes_password_status(self):
        self._auth(self.user)
        resp = self.client.get(ME_URL)
        self.assertEqual(resp.status_code, 200, resp.data)
        ps = resp.data["password_status"]
        self.assertTrue(ps["expiry_enabled"])
        self.assertFalse(ps["expired"])
        self.assertIn("days_remaining", ps)

    def test_me_reports_expired_for_stale_password(self):
        self.user.password_changed_at = timezone.now() - timedelta(days=100)
        self.user.save(update_fields=["password_changed_at"])
        self._auth(self.user)
        resp = self.client.get(ME_URL)
        self.assertTrue(resp.data["password_status"]["expired"])

    # --- self-service change -------------------------------------------------
    def test_change_wrong_current_rejected(self):
        self._auth(self.user)
        resp = self.client.post(CHANGE_URL, {
            "old_password": "WRONG", "new_password": "NextPass123!",
            "confirm_password": "NextPass123!",
        }, format="json")
        self.assertEqual(resp.status_code, 400)
        self.assertIn("old_password", resp.data)

    def test_change_same_as_old_rejected(self):
        self._auth(self.user)
        resp = self.client.post(CHANGE_URL, {
            "old_password": "OldPass123!", "new_password": "OldPass123!",
            "confirm_password": "OldPass123!",
        }, format="json")
        self.assertEqual(resp.status_code, 400)
        self.assertIn("new_password", resp.data)

    def test_change_success_resets_clock_and_password(self):
        # Make the account expired first.
        self.user.password_changed_at = timezone.now() - timedelta(days=100)
        self.user.save(update_fields=["password_changed_at"])
        self._auth(self.user)
        resp = self.client.post(CHANGE_URL, {
            "old_password": "OldPass123!", "new_password": "NextPass123!",
            "confirm_password": "NextPass123!",
        }, format="json")
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertFalse(resp.data["password_status"]["expired"])
        # New password works, old one does not.
        self.client.force_authenticate(user=None)
        self.assertEqual(self._token("pw_user", "NextPass123!").status_code, 200)
        self.assertNotEqual(self._token("pw_user", "OldPass123!").status_code, 200)

    # --- public reset request ------------------------------------------------
    def test_request_matched_creates_pending(self):
        resp = self.client.post(REQUEST_URL, {"identifier": "pw_user", "note": "forgot"}, format="json")
        self.assertEqual(resp.status_code, 200)
        req = PasswordResetRequest.objects.get(identifier__iexact="pw_user")
        self.assertEqual(req.user_id, self.user.id)
        self.assertEqual(req.status, "pending")

    def test_request_unmatched_is_generic(self):
        matched = self.client.post(REQUEST_URL, {"identifier": "pw_user"}, format="json")
        cache.clear()
        unmatched = self.client.post(REQUEST_URL, {"identifier": "ghost_user"}, format="json")
        # Same generic body regardless of whether the account exists.
        self.assertEqual(matched.status_code, 200)
        self.assertEqual(unmatched.status_code, 200)
        self.assertEqual(matched.data["detail"], unmatched.data["detail"])
        self.assertIsNone(PasswordResetRequest.objects.get(identifier__iexact="ghost_user").user_id)

    def test_request_no_duplicate_pending(self):
        self.client.post(REQUEST_URL, {"identifier": "pw_user"}, format="json")
        self.client.post(REQUEST_URL, {"identifier": "pw_user"}, format="json")
        self.assertEqual(
            PasswordResetRequest.objects.filter(identifier__iexact="pw_user", status="pending").count(),
            1,
        )

    # --- admin queue ---------------------------------------------------------
    def test_list_requires_admin(self):
        PasswordResetRequest.objects.create(identifier="pw_user", user=self.user)
        self._auth(self.user)
        self.assertEqual(self.client.get(LIST_URL).status_code, 403)
        self._auth(self.admin)
        resp = self.client.get(LIST_URL)
        self.assertEqual(resp.status_code, 200)
        # List endpoint is paginated: {count, next, previous, results}.
        self.assertEqual(resp.data["count"], 1)
        self.assertEqual(len(resp.data["results"]), 1)

    def test_admin_approve_resets_password(self):
        req = PasswordResetRequest.objects.create(identifier="pw_user", user=self.user)
        self._auth(self.admin)
        resp = self.client.post(f"{LIST_URL}{req.id}/approve/", {
            "new_password": "AdminSet123!", "resolution_note": "verified by phone",
        }, format="json")
        self.assertEqual(resp.status_code, 200, resp.data)
        req.refresh_from_db()
        self.assertEqual(req.status, "approved")
        self.assertEqual(req.resolved_by_id, self.admin.id)
        self.client.force_authenticate(user=None)
        self.assertEqual(self._token("pw_user", "AdminSet123!").status_code, 200)

    def test_approve_requires_admin(self):
        req = PasswordResetRequest.objects.create(identifier="pw_user", user=self.user)
        self._auth(self.user)
        resp = self.client.post(f"{LIST_URL}{req.id}/approve/", {"new_password": "Nope12345!"}, format="json")
        self.assertEqual(resp.status_code, 403)

    def test_approve_unmatched_rejected(self):
        req = PasswordResetRequest.objects.create(identifier="ghost", user=None)
        self._auth(self.admin)
        resp = self.client.post(f"{LIST_URL}{req.id}/approve/", {"new_password": "Whatever123!"}, format="json")
        self.assertEqual(resp.status_code, 400)

    def test_approve_already_resolved_rejected(self):
        req = PasswordResetRequest.objects.create(identifier="pw_user", user=self.user, status="approved")
        self._auth(self.admin)
        resp = self.client.post(f"{LIST_URL}{req.id}/approve/", {"new_password": "Whatever123!"}, format="json")
        self.assertEqual(resp.status_code, 400)

    def test_admin_reject(self):
        req = PasswordResetRequest.objects.create(identifier="pw_user", user=self.user)
        self._auth(self.admin)
        resp = self.client.post(f"{LIST_URL}{req.id}/reject/", {"resolution_note": "not the account owner"}, format="json")
        self.assertEqual(resp.status_code, 200)
        req.refresh_from_db()
        self.assertEqual(req.status, "rejected")
