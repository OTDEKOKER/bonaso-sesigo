"""Tests for the opt-in workbook-driven eligibility flag
(settings.WORKBOOK_ELIGIBILITY_PROJECT_IDS) in
projects.assignment_rules.get_assigned_indicator_ids_for_organization.

Flag OFF (default) must reproduce today's per-org assignment behaviour exactly;
flag ON resolves eligibility from the org's own/inherited coordinator workbook,
with a safe fallback to assignment when no workbook resolves.
"""
from __future__ import annotations

import datetime

from django.test import TestCase, override_settings

from organizations.models import Organization
from indicators.models import Indicator
from projects.models import (
    Project, ProjectIndicator, ProjectIndicatorAssignment,
    ProjectOrganization, ProjectOrganizationHierarchy,
    WorkbookLayout, WorkbookLayoutItem,
)
from projects.assignment_rules import (
    get_assigned_indicator_ids_for_organization,
    is_indicator_assigned_to_organization,
)


def _org(n, c): return Organization.objects.create(name=n, code=c, type="ngo")
def _ind(n): return Indicator.objects.create(name=f"I{n}", code=f"WBE{n}", type="number")


class WorkbookEligibilityFlagTest(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.p = Project.objects.create(
            name="Flag", code="FLAG1", is_training=False, status="active",
            start_date=datetime.date(2025, 4, 1), end_date=datetime.date(2026, 3, 31),
        )
        cls.coordA = _org("Coord A", "FCA")
        cls.subA1 = _org("Sub A1", "FSA1")
        cls.orphan = _org("Orphan", "FORPH")
        cls.ind = {n: _ind(n) for n in (1, 3, 5, 7, 9)}
        for i in cls.ind.values():
            ProjectIndicator.objects.create(project=cls.p, indicator=i)
        for o, role, coord, sub in (
            (cls.coordA, "coordinator", True, False),
            (cls.subA1, "sub_grantee", False, True),
            (cls.orphan, "implementing_partner", False, False),
        ):
            ProjectOrganization.objects.create(
                project=cls.p, organization=o, role=role, is_coordinator=coord,
                is_sub_grantee=sub, is_active=True, can_report_indicators=True)
        ProjectOrganizationHierarchy.objects.create(
            project=cls.p, parent_organization=cls.coordA,
            child_organization=cls.subA1, is_active=True)

        def assign(o, ns):
            for n in ns:
                pi = ProjectIndicator.objects.get(project=cls.p, indicator=cls.ind[n])
                ProjectIndicatorAssignment.objects.create(
                    project_indicator=pi, organization=o, assignment_source="manual", is_active=True)
        assign(cls.coordA, (1, 3))       # assignment differs from workbook
        assign(cls.subA1, (1, 3, 5))     # assignment differs from inherited workbook
        assign(cls.orphan, (9,))         # orphan: no workbook

        wl = WorkbookLayout.objects.create(
            coordinator_organization=cls.coordA, name="WB A", mode="live", is_active=True)
        for idx, n in enumerate((1, 3, 7)):   # workbook = {1,3,7}
            WorkbookLayoutItem.objects.create(layout=wl, indicator=cls.ind[n], order_index=idx)

    def _elig(self, org):
        return get_assigned_indicator_ids_for_organization(project=self.p, organization_id=org.id)

    # ---- flag OFF (default): today's assignment behaviour ----
    def test_flag_off_uses_assignment(self):
        self.assertEqual(self._elig(self.coordA), {self.ind[1].id, self.ind[3].id})
        self.assertEqual(self._elig(self.subA1), {self.ind[1].id, self.ind[3].id, self.ind[5].id})
        self.assertEqual(self._elig(self.orphan), {self.ind[9].id})

    # ---- flag ON for this project ----
    def test_flag_on_coordinator_uses_own_workbook(self):
        with override_settings(WORKBOOK_ELIGIBILITY_PROJECT_IDS={self.p.id}):
            self.assertEqual(self._elig(self.coordA),
                             {self.ind[1].id, self.ind[3].id, self.ind[7].id})

    def test_flag_on_subgrantee_inherits_coordinator_workbook(self):
        with override_settings(WORKBOOK_ELIGIBILITY_PROJECT_IDS={self.p.id}):
            # inherits {1,3,7}; its own assignment of 5 no longer confers eligibility
            self.assertEqual(self._elig(self.subA1),
                             {self.ind[1].id, self.ind[3].id, self.ind[7].id})

    def test_flag_on_orphan_without_workbook_falls_back_to_assignment(self):
        with override_settings(WORKBOOK_ELIGIBILITY_PROJECT_IDS={self.p.id}):
            self.assertEqual(self._elig(self.orphan), {self.ind[9].id})  # no loss

    def test_flag_on_flips_write_gate(self):
        with override_settings(WORKBOOK_ELIGIBILITY_PROJECT_IDS={self.p.id}):
            # 7 is in the inherited workbook but not in subA1's assignment -> now eligible
            self.assertTrue(is_indicator_assigned_to_organization(
                project=self.p, indicator_id=self.ind[7].id, organization_id=self.subA1.id))
            # 5 is in subA1's assignment but not in the workbook -> no longer eligible
            self.assertFalse(is_indicator_assigned_to_organization(
                project=self.p, indicator_id=self.ind[5].id, organization_id=self.subA1.id))

    def test_flag_only_affects_listed_projects(self):
        # Flag on for a DIFFERENT project id -> this project stays on assignment.
        with override_settings(WORKBOOK_ELIGIBILITY_PROJECT_IDS={self.p.id + 999}):
            self.assertEqual(self._elig(self.coordA), {self.ind[1].id, self.ind[3].id})

    def test_subgrantee_own_workbook_overrides_inherited(self):
        # subA1 gets its OWN workbook {5} -> under the flag it uses that, not coordA's.
        wl = WorkbookLayout.objects.create(
            coordinator_organization=self.subA1, name="WB Sub", mode="live", is_active=True)
        WorkbookLayoutItem.objects.create(layout=wl, indicator=self.ind[5], order_index=0)
        with override_settings(WORKBOOK_ELIGIBILITY_PROJECT_IDS={self.p.id}):
            self.assertEqual(self._elig(self.subA1), {self.ind[5].id})
