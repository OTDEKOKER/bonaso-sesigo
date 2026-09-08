"""Test the Phase-5 parity gate command (hierarchy_scope_parity).

The command is read-only; these assert it correctly detects and classifies
global-tree vs POH scope differences.
"""
from __future__ import annotations

import datetime
import io
import json

from django.core.management import call_command
from django.test import TestCase

from organizations.models import Organization
from projects.models import Project, ProjectOrganization, ProjectOrganizationHierarchy

_N = iter(range(1, 10_000))


def _org(name, parent=None):
    return Organization.objects.create(name=name, code=f"PA{next(_N)}", type="ngo", parent=parent)


class HierarchyScopeParityCommandTest(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.coord = _org("Coord")
        # POH child (in project) + a global-only child (not in project).
        cls.sub = _org("Sub", parent=cls.coord)
        cls.global_only = _org("GlobalOnly", parent=cls.coord)

        cls.p = Project.objects.create(
            name="P", code="PARITY-CMD", is_training=False, status="active",
            start_date=datetime.date(2025, 4, 1), end_date=datetime.date(2026, 3, 31),
        )
        ProjectOrganization.objects.create(project=cls.p, organization=cls.coord, role="coordinator", is_active=True)
        ProjectOrganization.objects.create(project=cls.p, organization=cls.sub, role="sub_grantee", is_active=True)
        ProjectOrganizationHierarchy.objects.create(
            project=cls.p, parent_organization=cls.coord, child_organization=cls.sub, is_active=True,
        )

    def _run_json(self):
        out = io.StringIO()
        call_command("hierarchy_scope_parity", "--project", str(self.p.id), "--json", stdout=out)
        return json.loads(out.getvalue())

    def test_detects_global_only_removal(self):
        report = self._run_json()
        self.assertTrue(report["read_only"])
        proj = report["projects"][0]
        self.assertEqual(proj["project_id"], self.p.id)
        # The coordinator loses the global-only child under POH (tightening).
        coord_diff = next(d for d in proj["differences"] if d["org_id"] == self.coord.id)
        global_only_ids = {x["id"] for x in coord_diff["global_only"]}
        self.assertIn(self.global_only.id, global_only_ids)
        self.assertEqual(coord_diff["project_only"], [])  # no unexpected widening
        self.assertEqual(proj["total_project_only_added"], 0)

    def test_writes_nothing(self):
        before = (
            Organization.objects.count(),
            ProjectOrganizationHierarchy.objects.count(),
            ProjectOrganization.objects.count(),
        )
        self._run_json()
        after = (
            Organization.objects.count(),
            ProjectOrganizationHierarchy.objects.count(),
            ProjectOrganization.objects.count(),
        )
        self.assertEqual(before, after)
