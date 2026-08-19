"""Tests for projects.derived_roles — coordinator/sub-grantee derived purely from
the canonical hierarchy + role. Behaviour-neutral helper (nothing wired to
runtime); these lock in the derivation rule found during the live audit.
"""
from __future__ import annotations

import datetime

from django.test import TestCase

from organizations.models import Organization
from projects.models import Project, ProjectOrganization, ProjectOrganizationHierarchy
from projects.derived_roles import derive_role_flags, is_derived_coordinator


def _org(name, code):
    return Organization.objects.create(name=name, code=code, type="ngo")


class DerivedRolesTest(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.p = Project.objects.create(
            name="Roles", code="ROLES1", is_training=False, status="active",
            start_date=datetime.date(2025, 4, 1), end_date=datetime.date(2026, 3, 31),
        )
        cls.lead = _org("BONASO", "BON")       # role=lead, sits ABOVE coordinators
        cls.coordA = _org("Coordinator A", "CA")
        cls.subA1 = _org("Sub A1", "SA1")
        cls.midB = _org("Mid B", "MB")          # coordinator that is also a child
        cls.subB1 = _org("Sub B1", "SB1")

        def po(o, role):
            return ProjectOrganization.objects.create(
                project=cls.p, organization=o, role=role, is_active=True)
        po(cls.lead, "lead")
        po(cls.coordA, "coordinator")
        po(cls.subA1, "sub_grantee")
        po(cls.midB, "coordinator")
        po(cls.subB1, "sub_grantee")

        def edge(parent, child):
            ProjectOrganizationHierarchy.objects.create(
                project=cls.p, parent_organization=parent, child_organization=child, is_active=True)
        edge(cls.lead, cls.coordA)   # lead is a PARENT of coordinator A
        edge(cls.lead, cls.midB)
        edge(cls.coordA, cls.subA1)
        edge(cls.midB, cls.subB1)    # midB is both a child (of lead) and a parent (of subB1)

    def test_lead_parent_is_not_a_coordinator(self):
        flags = derive_role_flags(self.p)
        self.assertFalse(flags[self.lead.id]["is_coordinator"])   # role=lead excluded
        self.assertFalse(flags[self.lead.id]["is_sub_grantee"])

    def test_coordinator_is_derived_from_parent_edge(self):
        flags = derive_role_flags(self.p)
        self.assertTrue(flags[self.coordA.id]["is_coordinator"])
        self.assertTrue(flags[self.coordA.id]["is_sub_grantee"])   # coordA is under the lead

    def test_subgrantee_leaf(self):
        flags = derive_role_flags(self.p)
        self.assertFalse(flags[self.subA1.id]["is_coordinator"])
        self.assertTrue(flags[self.subA1.id]["is_sub_grantee"])

    def test_mid_tier_is_coordinator_and_subgrantee(self):
        flags = derive_role_flags(self.p)
        self.assertTrue(flags[self.midB.id]["is_coordinator"])     # parent of subB1
        self.assertTrue(flags[self.midB.id]["is_sub_grantee"])     # child of lead

    def test_convenience_helper(self):
        self.assertTrue(is_derived_coordinator(self.p, self.coordA.id))
        self.assertFalse(is_derived_coordinator(self.p, self.lead.id))

    def test_inactive_edge_ignored(self):
        # deactivate coordA->subA1: subA1 no longer a derived sub-grantee
        ProjectOrganizationHierarchy.objects.filter(
            project=self.p, parent_organization=self.coordA, child_organization=self.subA1
        ).update(is_active=False)
        flags = derive_role_flags(self.p)
        self.assertFalse(flags[self.subA1.id]["is_sub_grantee"])
        self.assertFalse(flags[self.coordA.id]["is_coordinator"])  # no active children left
