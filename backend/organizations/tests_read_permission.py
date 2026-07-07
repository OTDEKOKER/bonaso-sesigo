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
