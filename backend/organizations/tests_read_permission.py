"""Regression: reading the organization tree must not require the write-oriented
``organizations`` module grant.

An M&E Officer legitimately has NO Organizations *management* access (an explicit
disabled ``organizations`` UserModulePermission row keeps that module out of
their sidebar). But the aggregates review queue derives a coordinator's
descendant scope from the org LIST endpoint, so blocking that read collapses the
queue to the officer's own org and hides every child-org report awaiting review.
Reads are org-scoped by get_queryset, so they stay safe; only writes remain
gated.
"""
from rest_framework.test import APIRequestFactory, force_authenticate

from django.test import TestCase
from django.contrib.auth import get_user_model

from organizations.models import Organization
from organizations.views import OrganizationViewSet
from users.models import UserModulePermission

User = get_user_model()


class OrganizationReadPermissionTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.coord = Organization.objects.create(name="Coord", code="ORP-COORD", type="regional")
        cls.child = Organization.objects.create(name="Child", code="ORP-CHILD", type="ngo", parent=cls.coord)

        cls.officer = User.objects.create_user(
            username="orp_officer", email="orp_officer@example.com", password="x",
            role="officer", organization=cls.coord,
        )
        # Admin has explicitly DISABLED the organizations module for this officer
        # (no management access, module hidden from the sidebar).
        UserModulePermission.objects.create(
            user=cls.officer, module="organizations", actions=[], is_enabled=False,
        )

    def test_officer_with_org_module_disabled_can_read_list(self):
        factory = APIRequestFactory()
        req = factory.get("/api/organizations/")
        force_authenticate(req, user=self.officer)
        resp = OrganizationViewSet.as_view({"get": "list"})(req)
        resp.render()
        self.assertEqual(resp.status_code, 200)
        ids = {int(o["id"]) for o in resp.data["results"]}
        # Sees own org AND its descendant (needed to scope the review queue).
        self.assertIn(self.coord.id, ids)
        self.assertIn(self.child.id, ids)

    def test_officer_with_org_module_disabled_still_cannot_create(self):
        factory = APIRequestFactory()
        req = factory.post("/api/organizations/", {"name": "New", "code": "ORP-NEW"})
        force_authenticate(req, user=self.officer)
        resp = OrganizationViewSet.as_view({"post": "create"})(req)
        self.assertEqual(resp.status_code, 403)


class OrganizationTreeScopeTests(TestCase):
    """Regression: GET /api/organizations/tree/ must not leak the whole org list.

    ``OrganizationTreeSerializer`` recurses into every active child, so returning
    the global roots exposes EVERY organisation (name/code/type) to any
    authenticated user — bypassing the org scoping the endpoint's open read
    permission relies on. Non-admins must only see their own org subtree; admins
    keep the full tree.
    """

    @classmethod
    def setUpTestData(cls):
        # Two independent coordinator subtrees (unrelated root orgs).
        cls.coord_a = Organization.objects.create(name="Coord A", code="TREE-A", type="regional")
        cls.child_a = Organization.objects.create(name="Child A", code="TREE-A-C", type="ngo", parent=cls.coord_a)
        cls.coord_b = Organization.objects.create(name="Coord B", code="TREE-B", type="regional")

        cls.officer = User.objects.create_user(
            username="tree_officer", email="tree_officer@example.com", password="x",
            role="officer", organization=cls.coord_a,
        )
        cls.admin = User.objects.create_user(
            username="tree_admin", email="tree_admin@example.com", password="x",
            role="admin", organization=cls.coord_a,
        )

    def _tree(self, user):
        factory = APIRequestFactory()
        req = factory.get("/api/organizations/tree/")
        force_authenticate(req, user=user)
        resp = OrganizationViewSet.as_view({"get": "tree"})(req)
        resp.render()
        self.assertEqual(resp.status_code, 200)
        return resp.data

    @staticmethod
    def _flatten_ids(nodes):
        ids = set()
        for node in nodes:
            ids.add(int(node["id"]))
            ids |= OrganizationTreeScopeTests._flatten_ids(node.get("children", []))
        return ids

    def test_non_admin_tree_excludes_unrelated_root(self):
        ids = self._flatten_ids(self._tree(self.officer))
        self.assertIn(self.coord_a.id, ids)      # own org
        self.assertIn(self.child_a.id, ids)      # own descendant
        self.assertNotIn(self.coord_b.id, ids)   # unrelated coordinator must NOT leak

    def test_admin_tree_includes_all_roots(self):
        ids = self._flatten_ids(self._tree(self.admin))
        self.assertIn(self.coord_a.id, ids)
        self.assertIn(self.coord_b.id, ids)
