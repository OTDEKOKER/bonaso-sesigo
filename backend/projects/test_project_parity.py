"""Read-only tests for the check_project_parity management command.

These build an in-memory scenario that exercises the exact business cases from
the audit (Coordinator A non-reporting; Coordinator B coordinator+implementer;
sub-grantee workbook inheritance; a sub-grantee indicator exception; a 3-way
hierarchy mismatch) and assert:

  * the command runs and exits successfully,
  * it reports the expected parity flags,
  * it performs ZERO database writes.

The Django test runner uses an isolated, throwaway test database that is created
and destroyed per run — no dev or production data is touched.
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


def _org(name, code, otype="ngo"):
    return Organization.objects.create(name=name, code=code, type=otype)


def _ind(n):
    return Indicator.objects.create(name=f"Indicator {n}", code=f"IND{n}", type="number")


class CheckProjectParityScenarioTest(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.project = Project.objects.create(
            name="Parity Test Project", code="PARITY1", is_training=False,
            status="active",
            start_date=datetime.date(2025, 4, 1), end_date=datetime.date(2026, 3, 31),
        )

        # Organizations
        cls.coordA = _org("Coordinator A", "COORDA")
        cls.subA1 = _org("Sub A1", "SUBA1")
        cls.subA2 = _org("Sub A2", "SUBA2")
        cls.coordB = _org("Coordinator B", "COORDB")
        cls.subB1 = _org("Sub B1", "SUBB1")
        cls.subB2 = _org("Sub B2", "SUBB2")
        cls.orphan = _org("Orphan Flagged Coord", "ORPHAN")

        # Indicators 1..8 (+ 5 used as the sub-grantee exception)
        cls.ind = {n: _ind(n) for n in (1, 2, 3, 4, 5, 7, 8)}
        for i in cls.ind.values():
            ProjectIndicator.objects.create(project=cls.project, indicator=i)

        # ProjectOrganization rows (roles + flags)
        def po(org, role, coord=False, sub=False, impl=True, can_report=True):
            return ProjectOrganization.objects.create(
                project=cls.project, organization=org, role=role,
                is_coordinator=coord, is_sub_grantee=sub, is_implementer=impl,
                can_report_indicators=can_report, is_active=True,
            )

        cls.po_coordA = po(cls.coordA, "coordinator", coord=True, impl=False, can_report=False)
        cls.po_subA1 = po(cls.subA1, "sub_grantee", sub=True)
        cls.po_subA2 = po(cls.subA2, "sub_grantee", sub=True)
        cls.po_coordB = po(cls.coordB, "coordinator", coord=True, impl=True)  # coordinator + implementer
        cls.po_subB1 = po(cls.subB1, "sub_grantee", sub=True)
        cls.po_subB2 = po(cls.subB2, "sub_grantee", sub=True)
        # Flag set but NO parent edge -> contradiction
        cls.po_orphan = po(cls.orphan, "implementing_partner", coord=True)

        # Hierarchy TABLE edges: A->A1, A->A2, B->B1, B->B2
        for parent, child in (
            (cls.coordA, cls.subA1), (cls.coordA, cls.subA2),
            (cls.coordB, cls.subB1), (cls.coordB, cls.subB2),
        ):
            ProjectOrganizationHierarchy.objects.create(
                project=cls.project, parent_organization=parent,
                child_organization=child, is_active=True,
            )

        # parent_assignment: set ONLY for the A branch -> disagrees with table for B
        cls.po_subA1.parent_assignment = cls.po_coordA
        cls.po_subA1.save(update_fields=["parent_assignment"])
        cls.po_subA2.parent_assignment = cls.po_coordA
        cls.po_subA2.save(update_fields=["parent_assignment"])

        # hierarchy_overrides JSON: omit B->B2 -> disagrees with table for B2
        cls.project.hierarchy_overrides = {
            str(cls.coordA.id): [str(cls.subA1.id), str(cls.subA2.id)],
            str(cls.coordB.id): [str(cls.subB1.id)],
        }
        cls.project.save(update_fields=["hierarchy_overrides"])

        # Assignments
        def assign(org, ns):
            for n in ns:
                pi = ProjectIndicator.objects.get(project=cls.project, indicator=cls.ind[n])
                ProjectIndicatorAssignment.objects.create(
                    project_indicator=pi, organization=org,
                    assignment_source="manual", is_active=True,
                )

        assign(cls.subA1, (1, 3, 7, 5))  # 5 is the exception (not in Layout A)
        assign(cls.subA2, (1, 3, 7))
        assign(cls.coordB, (2, 4, 8))
        assign(cls.subB1, (2, 4, 8))
        assign(cls.subB2, (2, 4, 8))
        assign(cls.orphan, (1,))
        # coordA: intentionally NO assignments (non-reporting coordinator)

        # Workbook layouts: A owned by coordA {1,3,7}; B owned by coordB {2,4,8}
        def layout(owner, ns):
            wl = WorkbookLayout.objects.create(
                coordinator_organization=owner, name=f"WB {owner.code}",
                mode="live", is_active=True,
            )
            for idx, n in enumerate(ns):
                WorkbookLayoutItem.objects.create(
                    layout=wl, indicator=cls.ind[n], order_index=idx,
                )
            return wl

        layout(cls.coordA, (1, 3, 7))
        layout(cls.coordB, (2, 4, 8))

    def _run_json(self):
        out = StringIO()
        call_command("check_project_parity", "--json", "--project", str(self.project.id), stdout=out)
        return json.loads(out.getvalue())

    def _org_block(self, report, org_id):
        p = report["projects"][0]
        return next(o for o in p["organizations"] if o["org_id"] == org_id)

    def test_command_runs_and_reports_project(self):
        report = self._run_json()
        self.assertTrue(report["meta"]["read_only"])
        self.assertEqual(len(report["projects"]), 1)
        self.assertEqual(report["projects"][0]["project_code"], "PARITY1")

    def test_hierarchy_mismatch_detected(self):
        report = self._run_json()
        hp = report["projects"][0]["hierarchy_parity"]
        self.assertEqual(hp["status"], "HIERARCHY_MISMATCH")
        # table has B->B1,B->B2 that parent_assignment lacks
        self.assertTrue(hp["table_vs_parent_assignment_symdiff"])
        # table has B->B2 that JSON lacks
        self.assertIn([self.coordB.id, self.subB2.id], hp["table_vs_json_symdiff"])

    def test_coordinator_A_non_reporting_owns_workbook(self):
        o = self._org_block(self._run_json(), self.coordA.id)
        self.assertEqual(o["workbook"]["resolution"], "SELF")
        self.assertEqual(o["workbook"]["owner_org_id"], self.coordA.id)
        self.assertEqual(o["effective"]["assigned_indicator_ids"], [])  # no assignments
        self.assertEqual(o["effective"]["effective_indicator_ids"], [])
        self.assertNotIn("CAN_REPORT_TRUE_NO_ASSIGNMENTS", o["flags"])  # can_report=False

    def test_coordinator_B_is_also_implementer_without_contradiction(self):
        o = self._org_block(self._run_json(), self.coordB.id)
        self.assertEqual(o["workbook"]["resolution"], "SELF")
        self.assertEqual(o["workbook"]["owner_org_id"], self.coordB.id)
        self.assertEqual(o["effective"]["effective_indicator_ids"],
                         sorted(self.ind[n].id for n in (2, 4, 8)))
        self.assertTrue(o["flags_stored"]["is_coordinator"])
        self.assertTrue(o["flags_stored"]["is_implementer"])
        # No contradiction flags for a legitimate coordinator+implementer
        self.assertNotIn("COORDINATOR_FLAG_BUT_NO_PARENT_EDGE", o["flags"])
        self.assertNotIn("PARENT_EDGE_BUT_NOT_COORDINATOR", o["flags"])

    def test_subgrantee_inherits_workbook_and_exception_flagged(self):
        o = self._org_block(self._run_json(), self.subA1.id)
        self.assertEqual(o["workbook"]["resolution"], "ANCESTOR")
        self.assertEqual(o["workbook"]["owner_org_id"], self.coordA.id)
        self.assertEqual(o["effective"]["effective_indicator_ids"],
                         sorted(self.ind[n].id for n in (1, 3, 7)))
        # Indicator 5 is assigned to A1 but NOT placed in Layout A -> excluded.
        self.assertEqual(o["effective"]["assigned_not_in_workbook"], [self.ind[5].id])
        self.assertIn("ASSIGNED_NOT_IN_WORKBOOK", o["flags"])

    def test_subgrantee_B1_inherits_coordinator_B_workbook(self):
        o = self._org_block(self._run_json(), self.subB1.id)
        self.assertEqual(o["workbook"]["resolution"], "ANCESTOR")
        self.assertEqual(o["workbook"]["owner_org_id"], self.coordB.id)

    def test_orphan_coordinator_flag_without_parent_edge(self):
        o = self._org_block(self._run_json(), self.orphan.id)
        self.assertIn("COORDINATOR_FLAG_BUT_NO_PARENT_EDGE", o["flags"])
        # No hierarchy edges for orphan -> no layout resolves -> full assigned pool.
        self.assertEqual(o["workbook"]["resolution"], "NONE")
        self.assertEqual(o["effective"]["effective_indicator_ids"], [self.ind[1].id])

    def test_coordinator_subtree_matches_resolver(self):
        report = self._run_json()
        coords = report["projects"][0]["coordinators"]
        a = next(c for c in coords if c["coordinator_org_id"] == self.coordA.id)
        self.assertEqual(a["direct_children"], sorted([self.subA1.id, self.subA2.id]))
        # Subtree (descendants + self) and the runtime resolver scope should agree.
        self.assertEqual(a["subtree_vs_resolver_symdiff"], [])

    def test_command_performs_zero_writes(self):
        counts_before = {
            m.__name__: m.objects.count()
            for m in (Project, ProjectOrganization, ProjectOrganizationHierarchy,
                      ProjectIndicator, ProjectIndicatorAssignment, WorkbookLayout,
                      WorkbookLayoutItem, Organization, Indicator)
        }
        self._run_json()
        counts_after = {
            m.__name__: m.objects.count()
            for m in (Project, ProjectOrganization, ProjectOrganizationHierarchy,
                      ProjectIndicator, ProjectIndicatorAssignment, WorkbookLayout,
                      WorkbookLayoutItem, Organization, Indicator)
        }
        self.assertEqual(counts_before, counts_after)

    def test_human_output_renders_and_is_safe(self):
        out = StringIO()
        call_command("check_project_parity", "--project", str(self.project.id), stdout=out)
        text = out.getvalue()
        self.assertIn("PROJECT PARITY REPORT (READ-ONLY)", text)
        self.assertIn("RAW DATA IS UNCHANGED.", text)
        self.assertIn("NO DATA WAS MODIFIED", text)


class CheckProjectParityCleanMatchTest(TestCase):
    """When all three representations agree, status is HIERARCHY_MATCH."""

    @classmethod
    def setUpTestData(cls):
        cls.project = Project.objects.create(
            name="Clean Project", code="CLEAN1", is_training=False, status="active",
            start_date=datetime.date(2025, 4, 1), end_date=datetime.date(2026, 3, 31),
        )
        cls.coord = _org("Coord", "CCOORD")
        cls.sub = _org("Sub", "CSUB")
        cls.po_coord = ProjectOrganization.objects.create(
            project=cls.project, organization=cls.coord, role="coordinator",
            is_coordinator=True, is_active=True,
        )
        cls.po_sub = ProjectOrganization.objects.create(
            project=cls.project, organization=cls.sub, role="sub_grantee",
            is_sub_grantee=True, is_active=True, parent_assignment=cls.po_coord,
        )
        ProjectOrganizationHierarchy.objects.create(
            project=cls.project, parent_organization=cls.coord,
            child_organization=cls.sub, is_active=True,
        )
        cls.project.hierarchy_overrides = {str(cls.coord.id): [str(cls.sub.id)]}
        cls.project.save(update_fields=["hierarchy_overrides"])

    def test_all_three_agree(self):
        out = StringIO()
        call_command("check_project_parity", "--json", "--project", str(self.project.id), stdout=out)
        report = json.loads(out.getvalue())
        self.assertEqual(
            report["projects"][0]["hierarchy_parity"]["status"], "HIERARCHY_MATCH"
        )


class CheckProjectParityStructuralTest(TestCase):
    """Structural read-only warnings: conflicting parents, cycles, inactive edges,
    and a sub-grantee owning its own layout (override)."""

    def _report(self, project):
        out = StringIO()
        call_command("check_project_parity", "--json", "--project", str(project.id), stdout=out)
        return json.loads(out.getvalue())["projects"][0]

    def _project(self, code):
        return Project.objects.create(
            name=code, code=code, is_training=False, status="active",
            start_date=datetime.date(2025, 4, 1), end_date=datetime.date(2026, 3, 31),
        )

    def test_multiple_active_parents_flagged(self):
        p = self._project("MULTIP")
        c1, c2, shared = _org("C1", "C1X"), _org("C2", "C2X"), _org("Shared", "SHX")
        for o, role, coord in ((c1, "coordinator", True), (c2, "coordinator", True),
                               (shared, "sub_grantee", False)):
            ProjectOrganization.objects.create(project=p, organization=o, role=role,
                                               is_coordinator=coord, is_sub_grantee=not coord, is_active=True)
        for parent in (c1, c2):
            ProjectOrganizationHierarchy.objects.create(
                project=p, parent_organization=parent, child_organization=shared, is_active=True)
        rep = self._report(p)
        self.assertIn(shared.id, rep["hierarchy_parity"]["structural_warnings"]["multi_parent_orgs"])
        sblock = next(o for o in rep["organizations"] if o["org_id"] == shared.id)
        self.assertIn("MULTIPLE_ACTIVE_PARENTS", sblock["flags"])

    def test_cyclic_edge_flagged(self):
        p = self._project("CYCLE")
        x, y = _org("X", "XCY"), _org("Y", "YCY")
        for o in (x, y):
            ProjectOrganization.objects.create(project=p, organization=o, role="implementing_partner", is_active=True)
        ProjectOrganizationHierarchy.objects.create(project=p, parent_organization=x, child_organization=y, is_active=True)
        ProjectOrganizationHierarchy.objects.create(project=p, parent_organization=y, child_organization=x, is_active=True)
        rep = self._report(p)
        self.assertTrue(rep["hierarchy_parity"]["structural_warnings"]["cyclic_edge_pairs"])

    def test_inactive_hierarchy_edge_ignored(self):
        p = self._project("INACT")
        coord, sub = _org("Coord", "ICO"), _org("Sub", "ISU")
        ProjectOrganization.objects.create(project=p, organization=coord, role="coordinator", is_coordinator=True, is_active=True)
        ProjectOrganization.objects.create(project=p, organization=sub, role="sub_grantee", is_sub_grantee=True, is_active=True)
        # INACTIVE edge -> must not appear in the runtime table edge set.
        ProjectOrganizationHierarchy.objects.create(
            project=p, parent_organization=coord, child_organization=sub, is_active=False)
        rep = self._report(p)
        self.assertEqual(rep["hierarchy_parity"]["table_edges"], [])
        sblock = next(o for o in rep["organizations"] if o["org_id"] == sub.id)
        self.assertFalse(sblock["hierarchy"]["is_child_edge"])

    def test_subgrantee_own_layout_overrides_inherited(self):
        p = self._project("OVR")
        coord, sub = _org("Coord", "OCO"), _org("Sub", "OSU")
        ProjectOrganization.objects.create(project=p, organization=coord, role="coordinator", is_coordinator=True, is_active=True)
        ProjectOrganization.objects.create(project=p, organization=sub, role="sub_grantee", is_sub_grantee=True, is_active=True)
        ProjectOrganizationHierarchy.objects.create(project=p, parent_organization=coord, child_organization=sub, is_active=True)
        i1, i2 = _ind(101), _ind(102)
        for i in (i1, i2):
            ProjectIndicator.objects.create(project=p, indicator=i)
            ProjectIndicatorAssignment.objects.create(
                project_indicator=ProjectIndicator.objects.get(project=p, indicator=i),
                organization=sub, assignment_source="manual", is_active=True)
        # Coordinator layout AND the sub-grantee's own layout both active.
        wl_c = WorkbookLayout.objects.create(coordinator_organization=coord, name="C", mode="live", is_active=True)
        WorkbookLayoutItem.objects.create(layout=wl_c, indicator=i1, order_index=0)
        wl_s = WorkbookLayout.objects.create(coordinator_organization=sub, name="S", mode="live", is_active=True)
        WorkbookLayoutItem.objects.create(layout=wl_s, indicator=i2, order_index=0)
        rep = self._report(p)
        sblock = next(o for o in rep["organizations"] if o["org_id"] == sub.id)
        # Own layout wins (SELF), not the inherited coordinator layout.
        self.assertEqual(sblock["workbook"]["resolution"], "SELF")
        self.assertEqual(sblock["workbook"]["owner_org_id"], sub.id)
