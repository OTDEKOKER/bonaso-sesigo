"""Tests for projects.hierarchy_validation and its wiring into set_hierarchy_links.

The validator rejects structurally-invalid hierarchies (self-loop, multi-parent,
cycle, inactive endpoint, cross-project) and never rewrites anything; valid
hierarchies pass unchanged.
"""
from __future__ import annotations

import datetime

from django.test import TestCase
from rest_framework.test import APIClient

from organizations.models import Organization
from users.models import User
from projects.models import Project, ProjectOrganization, ProjectOrganizationHierarchy
from projects.hierarchy_validation import validate_project_hierarchy_edges


def _org(n, c): return Organization.objects.create(name=n, code=c, type="ngo")


class HierarchyValidatorUnitTest(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.p = Project.objects.create(
            name="HV", code="HV1", is_training=False, status="active",
            start_date=datetime.date(2025, 4, 1), end_date=datetime.date(2026, 3, 31))
        cls.a, cls.b, cls.c = _org("A", "HA"), _org("B", "HB"), _org("C", "HC")
        cls.outside = _org("Outside", "HOUT")
        for o in (cls.a, cls.b, cls.c):
            ProjectOrganization.objects.create(project=cls.p, organization=o, role="implementing_partner", is_active=True)
        # 'outside' is NOT a member of the project

    def test_valid_tree_passes(self):
        self.assertIsNone(validate_project_hierarchy_edges(self.p, {(self.a.id, self.b.id), (self.a.id, self.c.id)}))

    def test_self_loop_rejected(self):
        self.assertIn("its own parent", validate_project_hierarchy_edges(self.p, {(self.a.id, self.a.id)}))

    def test_multiple_parents_rejected(self):
        err = validate_project_hierarchy_edges(self.p, {(self.a.id, self.c.id), (self.b.id, self.c.id)})
        self.assertIn("more than one parent", err)

    def test_multiple_parents_allowed_when_opted_in(self):
        self.assertIsNone(validate_project_hierarchy_edges(
            self.p, {(self.a.id, self.c.id), (self.b.id, self.c.id)}, allow_multiple_parents=True))

    def test_cycle_rejected(self):
        err = validate_project_hierarchy_edges(self.p, {(self.a.id, self.b.id), (self.b.id, self.c.id), (self.c.id, self.a.id)})
        self.assertIn("circular", err)

    def test_cross_project_endpoint_rejected(self):
        err = validate_project_hierarchy_edges(self.p, {(self.a.id, self.outside.id)})
        self.assertIn("not members of this project", err)

    def test_inactive_endpoint_rejected(self):
        ProjectOrganization.objects.filter(project=self.p, organization=self.c).update(is_active=False)
        err = validate_project_hierarchy_edges(self.p, {(self.a.id, self.c.id)})
        self.assertIn("Inactive", err)


class SetHierarchyLinksApiTest(TestCase):
    """The wiring: set_hierarchy_links returns 400 on invalid input and 200 on valid."""

    @classmethod
    def setUpTestData(cls):
        cls.admin = User.objects.create_user(
            username="hvadmin", email="hv@example.com", password="x", role="admin", is_staff=True)
        cls.p = Project.objects.create(
            name="HVAPI", code="HVAPI1", is_training=False, status="active",
            start_date=datetime.date(2025, 4, 1), end_date=datetime.date(2026, 3, 31))
        cls.a, cls.b, cls.c = _org("A", "AAP"), _org("B", "BAP"), _org("C", "CAP")
        for o in (cls.a, cls.b, cls.c):
            ProjectOrganization.objects.create(project=cls.p, organization=o, role="implementing_partner", is_active=True)

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    def _post(self, links):
        return self.client.post(f"/api/manage/projects/{self.p.id}/set_hierarchy_links/",
                                {"links": links, "replace": True}, format="json")

    def test_valid_hierarchy_saved(self):
        r = self._post([{"parent_organization_id": self.a.id, "child_organization_id": self.b.id}])
        self.assertEqual(r.status_code, 200, r.content)
        self.assertTrue(ProjectOrganizationHierarchy.objects.filter(
            project=self.p, parent_organization=self.a, child_organization=self.b, is_active=True).exists())

    def test_cycle_rejected_no_write(self):
        r = self._post([
            {"parent_organization_id": self.a.id, "child_organization_id": self.b.id},
            {"parent_organization_id": self.b.id, "child_organization_id": self.a.id},
        ])
        self.assertEqual(r.status_code, 400)
        self.assertIn("circular", r.json()["detail"])
        self.assertEqual(ProjectOrganizationHierarchy.objects.filter(project=self.p, is_active=True).count(), 0)

    def test_multi_parent_rejected(self):
        r = self._post([
            {"parent_organization_id": self.a.id, "child_organization_id": self.c.id},
            {"parent_organization_id": self.b.id, "child_organization_id": self.c.id},
        ])
        self.assertEqual(r.status_code, 400)
        self.assertIn("more than one parent", r.json()["detail"])
