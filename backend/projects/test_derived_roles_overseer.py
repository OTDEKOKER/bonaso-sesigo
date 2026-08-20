"""Overseer-exclusion semantics for derived sub-grantee status.

Locks in the refined rule (approved reconciliation step):

    coordinator = child-facing: org is a PARENT of a non-overseer edge
                  (role NOT in {lead, funder}).
    sub_grantee = org is a CHILD of an active edge whose PARENT is NOT an
                  overseer (lead/funder).

So an org sitting directly under the lead/funder (e.g. the NSC 2026/27
coordinators under BONASO) is a coordinator, NOT a sub-grantee. A genuine
middle tier (coordinator under ANOTHER coordinator) is BOTH.

Read-only logic tests — no data is mutated outside the test database.
"""
from __future__ import annotations

import datetime

from django.test import TestCase, override_settings

from organizations.models import Organization
from projects.models import Project, ProjectOrganization, ProjectOrganizationHierarchy
from projects.derived_roles import (
    derive_role_flags,
    coordinator_org_ids,
    sub_grantee_org_ids,
)

_CODE = iter(range(1, 10_000))


def _project(code):
    return Project.objects.create(
        name=code, code=code, is_training=False, status="active",
        start_date=datetime.date(2025, 4, 1), end_date=datetime.date(2026, 3, 31),
    )


def _org(name):
    return Organization.objects.create(name=name, code=f"OV{next(_CODE)}", type="ngo")


def _po(project, org, role, *, is_active=True):
    return ProjectOrganization.objects.create(
        project=project, organization=org, role=role, is_active=is_active,
    )


def _edge(project, parent, child, *, is_active=True):
    return ProjectOrganizationHierarchy.objects.create(
        project=project, parent_organization=parent, child_organization=child,
        is_active=is_active,
    )


class OverseerExclusionTest(TestCase):
    # A. coordinator -> implementing partner
    def test_A_child_of_coordinator_is_sub_grantee(self):
        p = _project("OVA")
        coord, ip = _org("Coord A"), _org("IP A")
        _po(p, coord, "coordinator")
        _po(p, ip, "implementing_partner")
        _edge(p, coord, ip)
        flags = derive_role_flags(p)
        self.assertTrue(flags[coord.id]["is_coordinator"])
        self.assertTrue(flags[ip.id]["is_sub_grantee"])
        self.assertFalse(flags[ip.id]["is_coordinator"])

    # B. lead -> coordinator  (the real NSC case: a coordinator UNDER BONASO that
    #    has its own sub-grantees). Coordinator status comes from being a PARENT
    #    of a non-overseer edge, so give it a sub-grantee.
    def test_B_child_of_lead_is_not_sub_grantee(self):
        p = _project("OVB")
        lead, coord, sub = _org("BONASO"), _org("Coord B"), _org("Sub B")
        _po(p, lead, "lead")
        _po(p, coord, "coordinator")
        _po(p, sub, "implementing_partner")
        _edge(p, lead, coord)     # coord sits under the lead …
        _edge(p, coord, sub)      # … and has a real sub-grantee → it's a coordinator
        flags = derive_role_flags(p)
        self.assertTrue(flags[coord.id]["is_coordinator"])   # parent of a non-overseer edge
        self.assertFalse(flags[coord.id]["is_sub_grantee"])  # only parent is the lead
        self.assertTrue(flags[sub.id]["is_sub_grantee"])

    # C. funder -> organisation
    def test_C_child_of_funder_is_not_sub_grantee(self):
        p = _project("OVC")
        funder, org = _org("Funder"), _org("Under Funder")
        _po(p, funder, "funder")
        _po(p, org, "coordinator")
        _edge(p, funder, org)
        flags = derive_role_flags(p)
        self.assertFalse(flags[org.id]["is_sub_grantee"])

    # D. nested: lead -> coordinator -> implementing partner
    def test_D_nested_valid_hierarchy(self):
        p = _project("OVD")
        lead, coord, ip = _org("Lead D"), _org("Coord D"), _org("IP D")
        _po(p, lead, "lead")
        _po(p, coord, "coordinator")
        _po(p, ip, "implementing_partner")
        _edge(p, lead, coord)
        _edge(p, coord, ip)
        flags = derive_role_flags(p)
        # lead: neither
        self.assertFalse(flags[lead.id]["is_coordinator"])
        self.assertFalse(flags[lead.id]["is_sub_grantee"])
        # coordinator: coordinator only (its parent is the lead)
        self.assertTrue(flags[coord.id]["is_coordinator"])
        self.assertFalse(flags[coord.id]["is_sub_grantee"])
        # implementing partner: sub-grantee only
        self.assertFalse(flags[ip.id]["is_coordinator"])
        self.assertTrue(flags[ip.id]["is_sub_grantee"])

    # E. multiple parents / edges
    def test_E1_child_of_both_lead_and_coordinator_is_sub_grantee(self):
        # A non-overseer parent edge is enough → sub-grantee even if it also has
        # an overseer parent edge.
        p = _project("OVE1")
        lead, coord, org = _org("Lead E1"), _org("Coord E1"), _org("Dual E1")
        _po(p, lead, "lead")
        _po(p, coord, "coordinator")
        _po(p, org, "implementing_partner")
        _edge(p, lead, org)     # overseer parent
        _edge(p, coord, org)    # real coordinator parent
        _edge(p, coord, _org("filler"))  # give coord a child so it's a coordinator
        flags = derive_role_flags(p)
        self.assertTrue(flags[org.id]["is_sub_grantee"])

    def test_E2_middle_tier_under_coordinator_is_both(self):
        # coordinator under ANOTHER coordinator: coordinator AND sub-grantee.
        p = _project("OVE2")
        lead, top, mid, leaf = _org("Lead E2"), _org("Top E2"), _org("Mid E2"), _org("Leaf E2")
        _po(p, lead, "lead")
        _po(p, top, "coordinator")
        _po(p, mid, "coordinator")
        _po(p, leaf, "implementing_partner")
        _edge(p, lead, top)     # top under lead → coordinator only
        _edge(p, top, mid)      # mid under a real coordinator → sub-grantee
        _edge(p, mid, leaf)     # mid is itself a parent → coordinator
        flags = derive_role_flags(p)
        self.assertTrue(flags[top.id]["is_coordinator"])
        self.assertFalse(flags[top.id]["is_sub_grantee"])
        self.assertTrue(flags[mid.id]["is_coordinator"])   # parent of leaf
        self.assertTrue(flags[mid.id]["is_sub_grantee"])   # child of a coordinator
        self.assertTrue(flags[leaf.id]["is_sub_grantee"])

    def test_E3_child_of_lead_only_is_not_sub_grantee(self):
        p = _project("OVE3")
        lead, a, b = _org("Lead E3"), _org("A E3"), _org("B E3")
        _po(p, lead, "lead")
        _po(p, a, "coordinator")
        _po(p, b, "coordinator")
        _edge(p, lead, a)
        _edge(p, lead, b)
        flags = derive_role_flags(p)
        self.assertFalse(flags[a.id]["is_sub_grantee"])
        self.assertFalse(flags[b.id]["is_sub_grantee"])

    # F. inactive hierarchy edge
    def test_F_inactive_edge_yields_no_derived_role(self):
        p = _project("OVF")
        coord, ip = _org("Coord F"), _org("IP F")
        _po(p, coord, "coordinator")
        _po(p, ip, "implementing_partner")
        _edge(p, coord, ip, is_active=False)
        flags = derive_role_flags(p)
        self.assertFalse(flags[ip.id]["is_sub_grantee"])   # edge inactive
        self.assertFalse(flags[coord.id]["is_coordinator"])  # no active children

    # G. active_only excludes inactive ProjectOrganization membership
    @override_settings(HIERARCHY_SOURCE="project")
    def test_G_active_only_excludes_inactive_membership(self):
        p = _project("OVG")
        coord, ip = _org("Coord G"), _org("IP G")
        _po(p, coord, "coordinator", is_active=False)   # inactive coordinator PO
        _po(p, ip, "implementing_partner", is_active=False)  # inactive sub-grantee PO
        _edge(p, coord, ip)   # active edge
        # derive_role_flags is membership-agnostic → still derives the roles.
        flags = derive_role_flags(p)
        self.assertTrue(flags[coord.id]["is_coordinator"])
        self.assertTrue(flags[ip.id]["is_sub_grantee"])
        # …but the scope helpers with active_only=True drop inactive memberships.
        self.assertNotIn(coord.id, coordinator_org_ids(p, active_only=True))
        self.assertNotIn(ip.id, sub_grantee_org_ids(p, active_only=True))
        # active_only=False keeps them (pure derived set).
        self.assertIn(coord.id, coordinator_org_ids(p, active_only=False))
        self.assertIn(ip.id, sub_grantee_org_ids(p, active_only=False))

    # H. existing coordinator behaviour is unchanged by the sub-grantee refinement
    @override_settings(HIERARCHY_SOURCE="project")
    def test_H_coordinator_derivation_unchanged(self):
        p = _project("OVH")
        lead, coord, ip = _org("Lead H"), _org("Coord H"), _org("IP H")
        _po(p, lead, "lead")
        _po(p, coord, "coordinator")
        _po(p, ip, "implementing_partner")
        _edge(p, lead, coord)
        _edge(p, coord, ip)
        flags = derive_role_flags(p)
        # lead is a parent edge but an overseer → still not a coordinator.
        self.assertFalse(flags[lead.id]["is_coordinator"])
        # coord is a parent of a non-overseer edge → coordinator (unchanged).
        self.assertTrue(flags[coord.id]["is_coordinator"])
        self.assertEqual(coordinator_org_ids(p, active_only=True), {coord.id})
