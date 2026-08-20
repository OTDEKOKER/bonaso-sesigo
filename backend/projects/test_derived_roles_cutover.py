"""Parity + read-through tests for the Rep 3b cutover.

Locks in the contract that the flag-gated canonical read-through
(``projects.derived_roles.coordinator_org_ids`` / ``sub_grantee_org_ids``):

  * under HIERARCHY_SOURCE='global' (the default) returns EXACTLY the stored
    is_coordinator / is_sub_grantee boolean set — i.e. production behaviour is
    unchanged, byte-for-byte, until the flag is flipped; and
  * under HIERARCHY_SOURCE='project' returns the set DERIVED from the canonical
    ProjectOrganizationHierarchy (derive_role_flags).

The two sources are made to DISAGREE on purpose (the "is_coordinator reverts /
stale coordinator" drift) so the tests prove each flag reads the right source.
"""
from __future__ import annotations

import datetime

from django.test import TestCase, override_settings

from organizations.models import Organization
from projects.models import Project, ProjectOrganization, ProjectOrganizationHierarchy
from projects.derived_roles import (
    coordinator_org_ids,
    sub_grantee_org_ids,
    hierarchy_source,
)


def _org(name, code):
    return Organization.objects.create(name=name, code=code, type="ngo")


class HierarchySourceFlagTest(TestCase):
    def test_default_is_global(self):
        # No override → settings default.
        self.assertEqual(hierarchy_source(), "global")

    @override_settings(HIERARCHY_SOURCE="project")
    def test_project_value(self):
        self.assertEqual(hierarchy_source(), "project")

    @override_settings(HIERARCHY_SOURCE="nonsense")
    def test_invalid_falls_back_to_global(self):
        self.assertEqual(hierarchy_source(), "global")


class Rep3bParityTest(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.p = Project.objects.create(
            name="Parity", code="PARITY1", is_training=False, status="active",
            start_date=datetime.date(2025, 4, 1), end_date=datetime.date(2026, 3, 31),
        )
        cls.lead = _org("BONASO", "PBON")            # overseer (role=lead)
        cls.coordA = _org("Coordinator A", "PCA")    # AGREEMENT: stored True + parent edge
        cls.subA1 = _org("Sub A1", "PSA1")           # AGREEMENT: stored True + child edge
        cls.drift_stale = _org("Stale Coord", "PDS") # stored True, NO parent edge (stale boolean)
        cls.drift_missing = _org("Reset Coord", "PDM")  # stored False, IS a parent edge (reset boolean)
        cls.subC = _org("Sub C", "PSC")              # child of drift_missing
        cls.inactive_coord = _org("Inactive Coord", "PIC")  # stored True + parent edge, PO inactive
        cls.subD = _org("Sub D", "PSD")

        def po(o, role, *, is_coord=False, is_sub=False, is_active=True):
            return ProjectOrganization.objects.create(
                project=cls.p, organization=o, role=role,
                is_coordinator=is_coord, is_sub_grantee=is_sub, is_active=is_active,
            )

        po(cls.lead, "lead")
        po(cls.coordA, "coordinator", is_coord=True)
        po(cls.subA1, "sub_grantee", is_sub=True)
        po(cls.drift_stale, "coordinator", is_coord=True)          # stored True…
        po(cls.drift_missing, "coordinator", is_coord=False)       # …stored False
        po(cls.subC, "sub_grantee", is_sub=True)
        po(cls.inactive_coord, "coordinator", is_coord=True, is_active=False)
        po(cls.subD, "sub_grantee", is_sub=True)

        def edge(parent, child):
            ProjectOrganizationHierarchy.objects.create(
                project=cls.p, parent_organization=parent,
                child_organization=child, is_active=True,
            )

        edge(cls.lead, cls.coordA)
        edge(cls.coordA, cls.subA1)
        edge(cls.drift_missing, cls.subC)     # drift_missing IS a parent → derived coordinator
        edge(cls.inactive_coord, cls.subD)    # inactive_coord is a parent edge
        # NB: drift_stale has NO edge → derived says NOT a coordinator.

    # ---- global (default): stored booleans, byte-for-byte ------------------
    def test_global_coordinator_is_stored_boolean_set(self):
        # active_only=False → every stored is_coordinator=True org.
        self.assertEqual(
            coordinator_org_ids(self.p, active_only=False),
            {self.coordA.id, self.drift_stale.id, self.inactive_coord.id},
        )

    def test_global_active_only_drops_inactive_membership(self):
        self.assertEqual(
            coordinator_org_ids(self.p, active_only=True),
            {self.coordA.id, self.drift_stale.id},  # inactive_coord excluded
        )

    def test_global_matches_the_legacy_orm_filter_exactly(self):
        legacy = set(
            ProjectOrganization.objects.filter(
                project=self.p, is_coordinator=True, is_active=True,
            ).values_list("organization_id", flat=True)
        )
        self.assertEqual(coordinator_org_ids(self.p, active_only=True), legacy)

    def test_global_sub_grantee_is_stored_boolean_set(self):
        self.assertEqual(
            sub_grantee_org_ids(self.p, active_only=True),
            {self.subA1.id, self.subC.id, self.subD.id},
        )

    # ---- project: derived from ProjectOrganizationHierarchy ----------------
    @override_settings(HIERARCHY_SOURCE="project")
    def test_project_coordinator_is_derived_set(self):
        # Parent edges, excluding overseer role (lead). inactive_coord is a
        # parent edge → included when active_only=False.
        self.assertEqual(
            coordinator_org_ids(self.p, active_only=False),
            {self.coordA.id, self.drift_missing.id, self.inactive_coord.id},
        )

    @override_settings(HIERARCHY_SOURCE="project")
    def test_project_active_only_intersects_active_membership(self):
        self.assertEqual(
            coordinator_org_ids(self.p, active_only=True),
            {self.coordA.id, self.drift_missing.id},  # inactive_coord excluded
        )

    # ---- the drift proves each flag reads its own source -------------------
    @override_settings(HIERARCHY_SOURCE="project")
    def test_drift_directions_are_source_specific(self):
        # stale boolean: present under global, absent under project
        with override_settings(HIERARCHY_SOURCE="global"):
            g = coordinator_org_ids(self.p, active_only=False)
        p = coordinator_org_ids(self.p, active_only=False)
        self.assertIn(self.drift_stale.id, g)
        self.assertNotIn(self.drift_stale.id, p)
        # reset boolean: absent under global, present under project
        self.assertNotIn(self.drift_missing.id, g)
        self.assertIn(self.drift_missing.id, p)

    def test_agreement_when_booleans_are_synced(self):
        # When stored booleans match the hierarchy, both sources agree.
        with override_settings(HIERARCHY_SOURCE="global"):
            g = coordinator_org_ids(self.p, active_only=True)
        with override_settings(HIERARCHY_SOURCE="project"):
            p = coordinator_org_ids(self.p, active_only=True)
        # coordA agrees in both; the drift orgs are the only disagreements.
        self.assertEqual(g & p, {self.coordA.id})
        self.assertEqual(g ^ p, {self.drift_stale.id, self.drift_missing.id})

    def test_none_project_returns_empty(self):
        self.assertEqual(coordinator_org_ids(None), set())
        self.assertEqual(sub_grantee_org_ids(None), set())
