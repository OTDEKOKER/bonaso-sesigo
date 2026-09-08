"""Rep-1 parity: project-scoped org visibility vs the legacy global tree.

get_user_organization_ids (no project arg) is the entrypoint behind org-visibility
scoping for ~36 runtime data reads. Under HIERARCHY_SOURCE='global' (default) it
walks the global Organization.parent tree; under 'project' it uses the union of
the user's ProjectOrganizationHierarchy subtree across assigned projects and does
NOT consult the global tree.

These tests prove:
  * default 'global' behaviour is unchanged (global tree),
  * 'project' mode excludes global-tree-only descendants that are not in the
    user's project hierarchy,
  * the safe fallbacks (admin, no-assignment) keep the legacy path so nobody is
    locked out.
"""
from __future__ import annotations

import datetime

from django.test import TestCase, override_settings

from organizations.models import Organization
from organizations.access import get_user_organization_ids
from projects.models import Project, ProjectOrganization, ProjectOrganizationHierarchy
from users.models import User

_N = iter(range(1, 10_000))


def _org(name, parent=None):
    return Organization.objects.create(name=name, code=f"R1{next(_N)}", type="ngo", parent=parent)


class Rep1OrgScopeTest(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.p = Project.objects.create(
            name="Rep1", code="REP1", is_training=False, status="active",
            start_date=datetime.date(2025, 4, 1), end_date=datetime.date(2026, 3, 31),
        )
        cls.coord = _org("Coord")
        # subS is BOTH a global child of coord AND a POH child of coord in project.
        cls.subS = _org("SubS", parent=cls.coord)
        # globalOnly is a global child of coord but NOT in the project / not in POH.
        cls.globalOnly = _org("GlobalOnly", parent=cls.coord)

        for o, role in [(cls.coord, "coordinator"), (cls.subS, "sub_grantee")]:
            ProjectOrganization.objects.create(project=cls.p, organization=o, role=role, is_active=True)
        ProjectOrganizationHierarchy.objects.create(
            project=cls.p, parent_organization=cls.coord, child_organization=cls.subS, is_active=True,
        )

        cls.user = User.objects.create(username="coord_officer", email="coord@t.test", role="officer", organization=cls.coord)
        cls.user.assigned_projects.add(cls.p)

    def test_global_mode_uses_global_tree(self):
        # Default flag: coord + ALL global descendants (subS + globalOnly).
        ids = set(get_user_organization_ids(self.user))
        self.assertEqual(ids, {self.coord.id, self.subS.id, self.globalOnly.id})
        self.assertIn(self.globalOnly.id, ids)

    @override_settings(HIERARCHY_SOURCE="project")
    def test_project_mode_uses_poh_not_global_tree(self):
        # Project scope: coord + its POH subtree (subS) — NOT the global-only child.
        ids = set(get_user_organization_ids(self.user))
        self.assertEqual(ids, {self.coord.id, self.subS.id})
        self.assertNotIn(self.globalOnly.id, ids)

    @override_settings(HIERARCHY_SOURCE="project")
    def test_project_mode_no_assignments_falls_back_to_legacy(self):
        # A user with no assigned projects is indeterminate -> legacy tree (no lockout).
        u = User.objects.create(username="unassigned", email="unassigned@t.test", role="officer", organization=self.coord)
        ids = set(get_user_organization_ids(u))
        self.assertIn(self.globalOnly.id, ids)  # legacy global-tree behaviour retained

    @override_settings(HIERARCHY_SOURCE="project")
    def test_project_mode_sub_grantee_sees_only_self(self):
        u = User.objects.create(username="sub_officer", email="sub@t.test", role="officer", organization=self.subS)
        u.assigned_projects.add(self.p)
        ids = set(get_user_organization_ids(u))
        self.assertEqual(ids, {self.subS.id})  # leaf sub-grantee: itself only

    def test_no_organization_returns_empty(self):
        u = User.objects.create(username="orgless", email="orgless@t.test", role="officer", organization=None)
        self.assertEqual(get_user_organization_ids(u), [])

    @override_settings(HIERARCHY_SOURCE="project")
    def test_explicit_project_arg_path_unchanged(self):
        # Passing a project still routes through the per-project resolver (unchanged).
        ids = set(get_user_organization_ids(self.user, project=self.p))
        self.assertIn(self.coord.id, ids)
        self.assertIn(self.subS.id, ids)
