"""Tests for the read-only dry_run_hierarchy_canonicalization command."""
from __future__ import annotations

import datetime
import json
from io import StringIO

from django.core.management import call_command
from django.test import TestCase

from organizations.models import Organization
from projects.models import Project, ProjectOrganization, ProjectOrganizationHierarchy


def _org(n, c): return Organization.objects.create(name=n, code=c, type="ngo")


class DryRunCanonicalizationTest(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.p = Project.objects.create(
            name="DR", code="DR1", is_training=False, status="active",
            start_date=datetime.date(2025, 4, 1), end_date=datetime.date(2026, 3, 31))
        cls.lead = _org("BONASO", "DBON")
        cls.coord = _org("Coord", "DCO")
        cls.sub = _org("Sub", "DSU")
        cls.stray = _org("Stray flagged", "DST")

        # coord: parent of sub (canonical) but stored is_coordinator=False -> should change
        ProjectOrganization.objects.create(project=cls.p, organization=cls.lead, role="lead",
                                           is_coordinator=True, is_active=True)  # lead wrongly flagged coord
        po_coord = ProjectOrganization.objects.create(project=cls.p, organization=cls.coord, role="coordinator",
                                                      is_coordinator=False, is_active=True)
        ProjectOrganization.objects.create(project=cls.p, organization=cls.sub, role="sub_grantee",
                                           is_sub_grantee=False, is_active=True)  # stored wrong
        ProjectOrganization.objects.create(project=cls.p, organization=cls.stray, role="implementing_partner",
                                           is_coordinator=True, is_active=True)  # flagged but no edge

        ProjectOrganizationHierarchy.objects.create(project=cls.p, parent_organization=cls.lead,
                                                    child_organization=cls.coord, is_active=True)
        ProjectOrganizationHierarchy.objects.create(project=cls.p, parent_organization=cls.coord,
                                                    child_organization=cls.sub, is_active=True)

    def _run(self):
        out = StringIO()
        call_command("dry_run_hierarchy_canonicalization", "--json", "--project", str(self.p.id), stdout=out)
        return json.loads(out.getvalue())["projects"][0]

    def test_reports_flag_changes(self):
        rep = self._run()
        self.assertGreaterEqual(rep["would_change"]["flags"], 1)
        changed = {c["org_id"]: c for c in rep["flag_changes"]}
        # lead wrongly flagged coordinator -> derived False (lead excluded)
        self.assertIn(self.lead.id, changed)
        self.assertFalse(changed[self.lead.id]["is_coordinator"]["derived"])
        # coord stored False -> derived True (parent edge, role=coordinator)
        self.assertTrue(changed[self.coord.id]["is_coordinator"]["derived"])
        # stray flagged coordinator but no edge -> derived False
        self.assertIn(self.stray.id, changed)
        self.assertFalse(changed[self.stray.id]["is_coordinator"]["derived"])

    def test_reports_parent_assignment_changes(self):
        rep = self._run()
        self.assertGreaterEqual(rep["would_change"]["parent_assignment"], 1)

    def test_zero_writes(self):
        from projects.models import WorkbookLayoutItem  # noqa
        models = (Project, ProjectOrganization, ProjectOrganizationHierarchy, Organization)
        before = {m.__name__: m.objects.count() for m in models}
        self._run()
        after = {m.__name__: m.objects.count() for m in models}
        self.assertEqual(before, after)
