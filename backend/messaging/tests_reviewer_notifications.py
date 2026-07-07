"""Regression tests: M&E Officers must be notified of their organization's
queued review reports.

M&E Officers are the first-tier reviewers of their own organization's submitted
aggregate data (organizations.access.can_review_aggregates; the ``officer`` role
default grants ``aggregates:review``). ``_resolve_reviewer_users`` previously
resolved only admins and M&E Managers, so an officer never received the
"awaiting review" notification that links to their org's queued reports. These
tests lock in that officers are included, org-scoped like managers.
"""
from django.test import TestCase
from django.contrib.auth import get_user_model

from organizations.models import Organization
from messaging.notifications import get_reviewer_users_for_organization

User = get_user_model()


class ReviewerResolutionTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.parent_org = Organization.objects.create(
            name="Coordinator Org", code="REV-COORD", type="regional")
        cls.org = Organization.objects.create(
            name="Reporting Org", code="REV-ORG", type="ngo", parent=cls.parent_org)
        cls.other_org = Organization.objects.create(
            name="Unrelated Org", code="REV-OTHER", type="ngo")

        cls.admin = User.objects.create_user(
            username="rev_admin", email="rev_admin@example.com", password="x",
            is_superuser=True, is_staff=True, role="admin",
        )
        cls.officer = User.objects.create_user(
            username="rev_officer", email="rev_officer@example.com", password="x",
            role="officer", organization=cls.org,
        )
        cls.manager = User.objects.create_user(
            username="rev_manager", email="rev_manager@example.com", password="x",
            role="manager", organization=cls.org,
        )
        # Coordinator-level officer above the reporting org — should also be pinged
        # for descendant-org submissions (org scope = self + descendants).
        cls.parent_officer = User.objects.create_user(
            username="rev_parent_officer", email="rev_parent_officer@example.com", password="x",
            role="officer", organization=cls.parent_org,
        )
        # Officer at an unrelated org must NOT be notified.
        cls.other_officer = User.objects.create_user(
            username="rev_other_officer", email="rev_other_officer@example.com", password="x",
            role="officer", organization=cls.other_org,
        )

    def _recipient_ids(self, org_id, **kwargs):
        return {u.id for u in get_reviewer_users_for_organization(org_id, **kwargs)}

    def test_officer_of_org_is_notified(self):
        ids = self._recipient_ids(self.org.id)
        self.assertIn(self.officer.id, ids)

    def test_manager_and_admin_still_notified(self):
        ids = self._recipient_ids(self.org.id)
        self.assertIn(self.manager.id, ids)
        self.assertIn(self.admin.id, ids)

    def test_coordinator_officer_notified_for_descendant_org(self):
        ids = self._recipient_ids(self.org.id)
        self.assertIn(self.parent_officer.id, ids)

    def test_unrelated_officer_not_notified(self):
        ids = self._recipient_ids(self.org.id)
        self.assertNotIn(self.other_officer.id, ids)

    def test_actor_excluded(self):
        ids = self._recipient_ids(self.org.id, exclude_user_ids=[self.officer.id])
        self.assertNotIn(self.officer.id, ids)
