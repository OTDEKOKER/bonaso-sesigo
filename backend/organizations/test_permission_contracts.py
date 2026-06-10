"""Role -> capability contract matrix for the aggregate review/approve gates.

Phase 3 (permission architecture hardening). These are pure-unit assertions over
the authorization helpers in ``organizations.access`` — the single source of
truth for who may review vs. approve aggregate data. They lock the contract so a
future refactor cannot silently widen a role's powers.

Role mapping to the prompt's matrix:
    Admin          -> role="admin" (also superuser/staff)
    Manager        -> role="manager"   (final approver)
    Reviewer       -> role="officer"   (review/flag/reject only)
    Data Collector -> role="collector" (submit only)
    Client         -> role="client"
    Coordinator / Sub-Grantee are org-hierarchy *positions*, not roles, and are
    covered by the API isolation tests in ``aggregates/test_permissions.py``.
"""
from django.test import SimpleTestCase

from organizations.access import (
    can_approve_aggregates,
    can_review_aggregates,
    can_submit_aggregates,
    is_organization_admin,
)


class _StubUser:
    """Minimal stand-in so the role gates can be asserted without the DB."""

    def __init__(self, role=None, is_superuser=False, is_staff=False):
        self.role = role
        self.is_superuser = is_superuser
        self.is_staff = is_staff


class RoleCapabilityContractTests(SimpleTestCase):
    # (role, is_admin, can_submit, can_review, can_approve)
    MATRIX = [
        ("admin", True, True, True, True),
        ("manager", False, True, True, True),
        ("officer", False, True, True, False),
        ("collector", False, True, False, False),
        ("client", False, False, False, False),
    ]

    def test_role_capability_matrix(self):
        for role, expect_admin, expect_submit, expect_review, expect_approve in self.MATRIX:
            user = _StubUser(role=role)
            with self.subTest(role=role):
                self.assertEqual(is_organization_admin(user), expect_admin)
                self.assertEqual(can_submit_aggregates(user), expect_submit)
                self.assertEqual(can_review_aggregates(user), expect_review)
                self.assertEqual(can_approve_aggregates(user), expect_approve)

    def test_superuser_is_treated_as_admin(self):
        user = _StubUser(role="collector", is_superuser=True)
        self.assertTrue(is_organization_admin(user))
        self.assertTrue(can_submit_aggregates(user))
        self.assertTrue(can_review_aggregates(user))
        self.assertTrue(can_approve_aggregates(user))

    def test_staff_is_treated_as_admin(self):
        user = _StubUser(role="officer", is_staff=True)
        self.assertTrue(is_organization_admin(user))
        self.assertTrue(can_submit_aggregates(user))
        self.assertTrue(can_approve_aggregates(user))

    def test_client_cannot_submit(self):
        self.assertFalse(can_submit_aggregates(_StubUser(role="client")))

    def test_none_user_has_no_capabilities(self):
        self.assertFalse(is_organization_admin(None))
        self.assertFalse(can_submit_aggregates(None))
        self.assertFalse(can_review_aggregates(None))
        self.assertFalse(can_approve_aggregates(None))

    def test_unknown_role_has_no_capabilities(self):
        user = _StubUser(role="something_new")
        self.assertFalse(is_organization_admin(user))
        self.assertFalse(can_submit_aggregates(user))
        self.assertFalse(can_review_aggregates(user))
        self.assertFalse(can_approve_aggregates(user))
