"""Read-only tests for simulate_workbook_eligibility_impact.

Verifies the what-if math (current per-org assignment vs inherited coordinator
workbook), the no-workbook rule, and that the command performs ZERO writes.
Runs against the isolated test database.
"""
from __future__ import annotations

import datetime
import json
from io import StringIO

from django.core.management import call_command
from django.test import TestCase

from organizations.models import Organization
from indicators.models import Indicator
from projects.models import (
    Project,
    ProjectIndicator,
    ProjectIndicatorAssignment,
    ProjectOrganization,
    ProjectOrganizationHierarchy,
    WorkbookLayout,
    WorkbookLayoutItem,
)


def _org(name, code):
    return Organization.objects.create(name=name, code=code, type="ngo")


def _ind(n):
    return Indicator.objects.create(name=f"Indicator {n}", code=f"IND{n}", type="number")


class WorkbookEligibilityImpactTest(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.p = Project.objects.create(
            name="Impact", code="IMPACT1", is_training=False, status="active",
            start_date=datetime.date(2025, 4, 1), end_date=datetime.date(2026, 3, 31),
        )
        cls.coordA = _org("Coordinator A", "ICA")
        cls.subA1 = _org("Sub A1", "ISA1")
        cls.orphan = _org("Orphan", "IORPH")
        cls.ind = {n: _ind(n) for n in (1, 2, 3, 5, 7)}
        for i in cls.ind.values():
            ProjectIndicator.objects.create(project=cls.p, indicator=i)

        def po(o, role, coord=False, sub=False):
            return ProjectOrganization.objects.create(
                project=cls.p, organization=o, role=role, is_coordinator=coord,
                is_sub_grantee=sub, is_active=True, can_report_indicators=True)
        po(cls.coordA, "coordinator", coord=True)
        po(cls.subA1, "sub_grantee", sub=True)
        po(cls.orphan, "implementing_partner")

        ProjectOrganizationHierarchy.objects.create(
            project=cls.p, parent_organization=cls.coordA, child_organization=cls.subA1, is_active=True)

        def assign(o, ns):
            for n in ns:
                pi = ProjectIndicator.objects.get(project=cls.p, indicator=cls.ind[n])
                ProjectIndicatorAssignment.objects.create(
                    project_indicator=pi, organization=o, assignment_source="manual", is_active=True)
        assign(cls.coordA, (1, 3, 7))   # coordinator implements its own workbook set
        assign(cls.subA1, (1, 3, 5))    # sub currently differs (has 5, lacks 7)
        assign(cls.orphan, (2,))        # orphan: no hierarchy, no workbook

        wl = WorkbookLayout.objects.create(
            coordinator_organization=cls.coordA, name="WB A", mode="live", is_active=True)
        for idx, n in enumerate((1, 3, 7)):
            WorkbookLayoutItem.objects.create(layout=wl, indicator=cls.ind[n], order_index=idx)

    def _run(self, rule="deny"):
        out = StringIO()
        call_command("simulate_workbook_eligibility_impact", "--json",
                     "--project", str(self.p.id), "--no-workbook-rule", rule, stdout=out)
        return json.loads(out.getvalue())["projects"][0]

    def _org(self, rep, org_id):
        return next(o for o in rep["organizations"] if o["org_id"] == org_id)

    def test_coordinator_self_workbook_unchanged(self):
        o = self._org(self._run(), self.coordA.id)
        self.assertEqual(o["proposed_source"], "workbook_self")
        self.assertEqual(o["gained_ids"], [])
        self.assertEqual(o["lost_ids"], [])

    def test_subgrantee_inherits_and_diff_reported(self):
        o = self._org(self._run(), self.subA1.id)
        self.assertEqual(o["proposed_source"], f"workbook_inherited_from_{self.coordA.id}")
        self.assertEqual(o["gained_ids"], [self.ind[7].id])   # inherits 7 from coordinator wb
        self.assertEqual(o["lost_ids"], [self.ind[5].id])     # loses its own extra 5
        self.assertIn("WOULD_GAIN", o["flags"])
        self.assertIn("WOULD_LOSE", o["flags"])

    def test_no_workbook_deny_loses_all(self):
        o = self._org(self._run("deny"), self.orphan.id)
        self.assertIn("NO_WORKBOOK", o["flags"])
        self.assertIn("WOULD_LOSE_ALL_ELIGIBILITY", o["flags"])
        self.assertEqual(o["proposed_eligible_ids"], [])
        self.assertEqual(o["lost_ids"], [self.ind[2].id])

    def test_no_workbook_keep_assignment_preserves(self):
        o = self._org(self._run("keep_assignment"), self.orphan.id)
        self.assertEqual(o["proposed_eligible_ids"], [self.ind[2].id])
        self.assertEqual(o["lost_ids"], [])

    def test_summary_counts(self):
        rep = self._run()
        s = rep["summary"]
        self.assertEqual(s["organizations"], 3)
        self.assertEqual(s["no_workbook"], 1)

    def test_zero_writes(self):
        models = (Project, ProjectOrganization, ProjectOrganizationHierarchy,
                  ProjectIndicator, ProjectIndicatorAssignment, WorkbookLayout,
                  WorkbookLayoutItem, Organization, Indicator)
        before = {m.__name__: m.objects.count() for m in models}
        self._run()
        after = {m.__name__: m.objects.count() for m in models}
        self.assertEqual(before, after)
