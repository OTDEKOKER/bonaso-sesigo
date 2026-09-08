"""Tests for the project hierarchy facade (projects.hierarchy_service).

Enforces the core architectural rule: project hierarchy is answered from that
project's ProjectOrganizationHierarchy (POH), never the global
Organization.parent tree — and two projects may hold DIFFERENT structures for
the same organisations simultaneously (different programme years).
"""
from __future__ import annotations

import datetime

from django.test import TestCase

from organizations.models import Organization
from projects.models import Project, ProjectOrganization, ProjectOrganizationHierarchy
from projects import hierarchy_service as hs

_N = iter(range(1, 10_000))


def _org(name, parent=None):
    return Organization.objects.create(name=name, code=f"HS{next(_N)}", type="ngo", parent=parent)


def _project(code):
    return Project.objects.create(
        name=code, code=code, is_training=False, status="active",
        start_date=datetime.date(2025, 4, 1), end_date=datetime.date(2026, 3, 31),
    )


def _po(project, org, role):
    return ProjectOrganization.objects.create(project=project, organization=org, role=role, is_active=True)


def _edge(project, parent, child, active=True):
    return ProjectOrganizationHierarchy.objects.create(
        project=project, parent_organization=parent, child_organization=child, is_active=active,
    )


class HierarchyServiceTest(TestCase):
    @classmethod
    def setUpTestData(cls):
        # Shared organisations across two projects (different programme years).
        cls.bonaso = _org("BONASO")
        cls.bonela = _org("BONELA")
        cls.hpp = _org("HPP")
        cls.orgX = _org("Org X")
        cls.coordA = _org("Coord A")
        cls.sub1 = _org("Sub 1")
        cls.sub2 = _org("Sub 2")

        # Project A: BONASO(lead) -> BONELA(coord) -> Org X ; BONASO -> CoordA -> {sub1, sub2}
        cls.pa = _project("PROJ-A")
        _po(cls.pa, cls.bonaso, "lead")
        _po(cls.pa, cls.bonela, "coordinator")
        _po(cls.pa, cls.orgX, "sub_grantee")
        _po(cls.pa, cls.coordA, "coordinator")
        _po(cls.pa, cls.sub1, "sub_grantee")
        _po(cls.pa, cls.sub2, "sub_grantee")
        _edge(cls.pa, cls.bonaso, cls.bonela)
        _edge(cls.pa, cls.bonela, cls.orgX)
        _edge(cls.pa, cls.bonaso, cls.coordA)
        _edge(cls.pa, cls.coordA, cls.sub1)
        _edge(cls.pa, cls.coordA, cls.sub2)

        # Project B: BONASO(lead) -> HPP(coord) -> Org X   (Org X has a DIFFERENT parent)
        cls.pb = _project("PROJ-B")
        _po(cls.pb, cls.bonaso, "lead")
        _po(cls.pb, cls.hpp, "coordinator")
        _po(cls.pb, cls.orgX, "sub_grantee")
        _edge(cls.pb, cls.bonaso, cls.hpp)
        _edge(cls.pb, cls.hpp, cls.orgX)

    # ---- structural queries come from POH ----
    def test_parent_children_ancestors_descendants(self):
        self.assertEqual(hs.get_project_parent(self.pa, self.orgX), self.bonela.id)
        self.assertEqual(hs.get_project_children(self.pa, self.coordA), {self.sub1.id, self.sub2.id})
        self.assertEqual(hs.get_project_ancestors(self.pa, self.orgX), [self.bonela.id, self.bonaso.id])
        self.assertEqual(
            hs.get_project_descendants(self.pa, self.bonaso),
            {self.bonela.id, self.orgX.id, self.coordA.id, self.sub1.id, self.sub2.id},
        )
        self.assertEqual(hs.get_project_descendants(self.pa, self.sub1), set())  # leaf

    # ---- CRITICAL INVARIANT (§13): same org, different parent per project ----
    def test_same_org_different_parent_in_each_project(self):
        self.assertEqual(hs.get_project_parent(self.pa, self.orgX), self.bonela.id)
        self.assertEqual(hs.get_project_parent(self.pb, self.orgX), self.hpp.id)
        # Both remain valid simultaneously.
        self.assertIn(self.orgX.id, hs.get_project_descendants(self.pa, self.bonela))
        self.assertIn(self.orgX.id, hs.get_project_descendants(self.pb, self.hpp))
        # In project B, Org X is under HPP — NOT under BONELA (BONELA isn't in B).
        self.assertNotIn(self.orgX.id, hs.get_project_descendants(self.pb, self.bonela))

    # ---- project isolation ----
    def test_project_isolation(self):
        # BONELA coordinates Org X in A, but is not even in B's hierarchy edges.
        self.assertEqual(hs.get_project_children(self.pa, self.bonela), {self.orgX.id})
        self.assertEqual(hs.get_project_children(self.pb, self.bonela), set())
        self.assertEqual(hs.get_project_children(self.pb, self.hpp), {self.orgX.id})
        self.assertEqual(hs.get_project_children(self.pa, self.hpp), set())

    # ---- scope from POH ----
    def test_scope(self):
        self.assertEqual(hs.get_project_scope(self.pa, self.bonela), {self.bonela.id, self.orgX.id})
        self.assertEqual(hs.get_project_scope(self.pa, self.coordA), {self.coordA.id, self.sub1.id, self.sub2.id})
        # lead sees the whole project
        self.assertEqual(
            hs.get_project_scope(self.pa, self.bonaso),
            {self.bonaso.id, self.bonela.id, self.orgX.id, self.coordA.id, self.sub1.id, self.sub2.id},
        )
        self.assertEqual(hs.get_project_scope(self.pa, self.sub1), {self.sub1.id})  # leaf: self only

    # ---- roles derived from POH ----
    def test_roles_derived_from_poh(self):
        self.assertTrue(hs.get_project_role(self.pa, self.bonela)["is_coordinator"])
        self.assertFalse(hs.get_project_role(self.pa, self.bonela)["is_sub_grantee"])  # under the lead
        self.assertTrue(hs.get_project_role(self.pa, self.orgX)["is_sub_grantee"])     # under a coordinator
        self.assertFalse(hs.get_project_role(self.pa, self.bonaso)["is_coordinator"])  # lead != coordinator

    # ---- global Organization.parent independence ----
    def test_global_tree_does_not_determine_project_hierarchy(self):
        # Point Org X's GLOBAL parent at HPP; project A must still say BONELA.
        self.orgX.parent = self.hpp
        self.orgX.save(update_fields=["parent"])
        self.assertEqual(hs.get_project_parent(self.pa, self.orgX), self.bonela.id)
        self.assertEqual(hs.get_project_parent(self.pb, self.orgX), self.hpp.id)
        # Now detach the global parent entirely; POH answers are unchanged.
        self.orgX.parent = None
        self.orgX.save(update_fields=["parent"])
        self.assertEqual(hs.get_project_parent(self.pa, self.orgX), self.bonela.id)
        self.assertEqual(hs.get_project_scope(self.pa, self.bonela), {self.bonela.id, self.orgX.id})

    # ---- inactive edges are ignored ----
    def test_inactive_edges_excluded(self):
        ProjectOrganizationHierarchy.objects.filter(
            project=self.pa, parent_organization=self.coordA, child_organization=self.sub2,
        ).update(is_active=False)
        self.assertEqual(hs.get_project_children(self.pa, self.coordA), {self.sub1.id})
        self.assertEqual(hs.get_project_scope(self.pa, self.coordA), {self.coordA.id, self.sub1.id})
