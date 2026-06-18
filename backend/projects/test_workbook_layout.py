"""Tests for the coordinator Workbook Layout feature.

Covers: permissions (admin / coordinator / sub-grantee), layout-driven ordering,
section headings, sub-organisation inheritance, skipping non-applicable
indicators, appending new indicators under "Unordered Indicators", duplicate
prevention, and the default-ordering fallback when no layout exists.
"""
from datetime import date

from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from django.test import TestCase
from rest_framework.test import APIClient

from aggregates import reporting_workbook as rw
from indicators.models import Indicator
from organizations.models import Organization
from projects.models import (
    Project,
    ProjectOrganizationHierarchy,
    WorkbookLayout,
    WorkbookLayoutItem,
)
from projects.workbook_layout import (
    UNORDERED_SECTION,
    order_plans_by_layout,
    resolve_layout_for_org,
)
from projects.workbook_layout_views import can_edit_workbook_layout

User = get_user_model()


def _plan(ind):
    return rw.IndicatorPlan(indicator=ind, config=rw.resolve_matrix_config(ind), target=None)


class WorkbookLayoutSetup(TestCase):
    def setUp(self):
        self.coord = Organization.objects.create(name="BONEPWA", code="BONEPWA")
        self.sub = Organization.objects.create(name="Sub Org", code="SUB", parent=self.coord)
        self.other = Organization.objects.create(name="Other Coord", code="OTHER")
        self.project = Project.objects.create(
            name="NAHPA SC", code="NSC", start_date=date(2026, 4, 1), end_date=date(2027, 3, 31),
        )
        ProjectOrganizationHierarchy.objects.create(
            project=self.project, parent_organization=self.coord, child_organization=self.sub,
        )
        self.i1 = Indicator.objects.create(name="HIV tests", code="I1")
        self.i2 = Indicator.objects.create(name="Condoms", code="I2")
        self.i3 = Indicator.objects.create(name="NCD screening", code="I3")

        self.admin = User.objects.create_user(
            username="admin", email="a@x.com", password="pw", role="admin",
        )
        self.coord_user = User.objects.create_user(
            username="coord", email="c@x.com", password="pw", role="officer",
            organization=self.coord,
        )
        self.sub_user = User.objects.create_user(
            username="sub", email="s@x.com", password="pw", role="officer",
            organization=self.sub,
        )

    def _layout(self, coordinator=None, mode="live"):
        return WorkbookLayout.objects.create(
            coordinator_organization=coordinator or self.coord, name="BONEPWA Layout", mode=mode,
        )


class CanEditPermissionTests(WorkbookLayoutSetup):
    def test_admin_can_edit_any(self):
        self.assertTrue(can_edit_workbook_layout(self.admin, self.coord.id))
        self.assertTrue(can_edit_workbook_layout(self.admin, self.other.id))

    def test_manager_can_edit_any(self):
        mgr = User.objects.create_user(username="m", email="m@x.com", password="pw", role="manager")
        self.assertTrue(can_edit_workbook_layout(mgr, self.coord.id))

    def test_coordinator_user_only_own(self):
        self.assertTrue(can_edit_workbook_layout(self.coord_user, self.coord.id))
        self.assertFalse(can_edit_workbook_layout(self.coord_user, self.other.id))

    def test_sub_grantee_cannot_edit(self):
        self.assertFalse(can_edit_workbook_layout(self.sub_user, self.coord.id))

    def test_client_cannot_edit(self):
        client = User.objects.create_user(
            username="cl", email="cl@x.com", password="pw", role="client", organization=self.coord,
        )
        self.assertFalse(can_edit_workbook_layout(client, self.coord.id))


class WorkbookLayoutAPITests(WorkbookLayoutSetup):
    def _create_payload(self):
        return {
            "coordinator_organization": self.coord.id,
            "name": "BONEPWA Workbook Layout",
            "items": [
                {"section_title": "HIV Testing", "order_index": 0},
                {"indicator": self.i1.id, "order_index": 1},
            ],
        }

    def test_admin_can_create_layout(self):
        client = APIClient()
        client.force_authenticate(self.admin)
        resp = client.post("/api/manage/workbook-layouts/", self._create_payload(), format="json")
        self.assertEqual(resp.status_code, 201, resp.content)
        layout = WorkbookLayout.objects.get(id=resp.data["id"])
        self.assertEqual(layout.mode, "live")
        self.assertEqual(layout.created_by, self.admin)
        self.assertEqual(layout.items.count(), 2)

    def test_coordinator_user_can_create_and_edit_own(self):
        client = APIClient()
        client.force_authenticate(self.coord_user)
        resp = client.post("/api/manage/workbook-layouts/", self._create_payload(), format="json")
        self.assertEqual(resp.status_code, 201, resp.content)
        layout_id = resp.data["id"]
        resp2 = client.patch(
            f"/api/manage/workbook-layouts/{layout_id}/", {"name": "Renamed"}, format="json",
        )
        self.assertEqual(resp2.status_code, 200, resp2.content)

    def test_stale_save_is_rejected_with_409(self):
        client = APIClient()
        client.force_authenticate(self.admin)
        created = client.post("/api/manage/workbook-layouts/", self._create_payload(), format="json")
        self.assertEqual(created.status_code, 201, created.content)
        layout_id = created.data["id"]
        original_updated_at = created.data["updated_at"]

        # Another editor saves first (moves updated_at forward).
        ahead = client.patch(
            f"/api/manage/workbook-layouts/{layout_id}/", {"name": "Saved by someone else"}, format="json",
        )
        self.assertEqual(ahead.status_code, 200, ahead.content)

        # Our save carries the stale updated_at → rejected, not clobbered.
        stale = client.patch(
            f"/api/manage/workbook-layouts/{layout_id}/",
            {"name": "My stale change", "expected_updated_at": original_updated_at},
            format="json",
        )
        self.assertEqual(stale.status_code, 409, stale.content)
        self.assertEqual(WorkbookLayout.objects.get(id=layout_id).name, "Saved by someone else")

        # Re-fetching the current updated_at lets the save through.
        current = client.get(f"/api/manage/workbook-layouts/{layout_id}/").data["updated_at"]
        ok = client.patch(
            f"/api/manage/workbook-layouts/{layout_id}/",
            {"name": "Applied cleanly", "expected_updated_at": current},
            format="json",
        )
        self.assertEqual(ok.status_code, 200, ok.content)

    def test_coordinator_user_cannot_create_for_other(self):
        client = APIClient()
        client.force_authenticate(self.coord_user)
        payload = self._create_payload()
        payload["coordinator_organization"] = self.other.id
        resp = client.post("/api/manage/workbook-layouts/", payload, format="json")
        self.assertEqual(resp.status_code, 403, resp.content)

    def test_sub_grantee_cannot_create(self):
        client = APIClient()
        client.force_authenticate(self.sub_user)
        resp = client.post("/api/manage/workbook-layouts/", self._create_payload(), format="json")
        self.assertEqual(resp.status_code, 403, resp.content)

    def test_sub_grantee_can_read(self):
        self._layout()
        client = APIClient()
        client.force_authenticate(self.sub_user)
        resp = client.get(f"/api/manage/workbook-layouts/?coordinator={self.coord.id}")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.data["results"] if "results" in resp.data else resp.data), 1)

    def test_duplicate_indicator_rejected(self):
        client = APIClient()
        client.force_authenticate(self.admin)
        payload = {
            "coordinator_organization": self.coord.id,
            "name": "L",
            "items": [
                {"indicator": self.i1.id, "order_index": 0},
                {"indicator": self.i1.id, "order_index": 1},
            ],
        }
        resp = client.post("/api/manage/workbook-layouts/", payload, format="json")
        self.assertEqual(resp.status_code, 400, resp.content)

    def test_second_active_layout_rejected(self):
        self._layout()
        client = APIClient()
        client.force_authenticate(self.admin)
        resp = client.post("/api/manage/workbook-layouts/", self._create_payload(), format="json")
        self.assertEqual(resp.status_code, 400, resp.content)


class OrderingTests(WorkbookLayoutSetup):
    def test_db_duplicate_indicator_constraint(self):
        layout = self._layout()
        WorkbookLayoutItem.objects.create(layout=layout, indicator=self.i1, order_index=0)
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                WorkbookLayoutItem.objects.create(layout=layout, indicator=self.i1, order_index=1)

    def test_order_follows_layout_with_sections(self):
        layout = self._layout()
        # Layout order: [HIV Testing] i2, [NCD] i1  (deliberately reversed vs name)
        WorkbookLayoutItem.objects.create(layout=layout, section_title="HIV Testing", order_index=0)
        WorkbookLayoutItem.objects.create(layout=layout, indicator=self.i2, order_index=1)
        WorkbookLayoutItem.objects.create(layout=layout, section_title="NCD", order_index=2)
        WorkbookLayoutItem.objects.create(layout=layout, indicator=self.i1, order_index=3)

        plans = [_plan(self.i1), _plan(self.i2)]  # default order i1, i2
        ordered = order_plans_by_layout(plans, layout)
        self.assertEqual([p.indicator.id for p in ordered], [self.i2.id, self.i1.id])
        self.assertEqual(ordered[0].section, "HIV Testing")
        self.assertEqual(ordered[1].section, "NCD")

    def test_non_applicable_indicator_skipped(self):
        layout = self._layout()
        WorkbookLayoutItem.objects.create(layout=layout, indicator=self.i1, order_index=0)
        WorkbookLayoutItem.objects.create(layout=layout, indicator=self.i2, order_index=1)
        # Only i1 is applicable to this org/project selection.
        ordered = order_plans_by_layout([_plan(self.i1)], layout)
        self.assertEqual([p.indicator.id for p in ordered], [self.i1.id])

    def test_new_indicator_appended_under_unordered(self):
        layout = self._layout()
        WorkbookLayoutItem.objects.create(layout=layout, indicator=self.i1, order_index=0)
        # i3 is applicable but not yet in the layout.
        ordered = order_plans_by_layout([_plan(self.i1), _plan(self.i3)], layout)
        self.assertEqual([p.indicator.id for p in ordered], [self.i1.id, self.i3.id])
        self.assertEqual(ordered[-1].section, UNORDERED_SECTION)

    def test_missing_layout_falls_back_to_default(self):
        plans = [_plan(self.i1), _plan(self.i2)]
        ordered = order_plans_by_layout(plans, None)
        self.assertEqual([p.indicator.id for p in ordered], [self.i1.id, self.i2.id])
        self.assertTrue(all(p.section == "" for p in ordered))

    def test_sub_org_inherits_coordinator_layout(self):
        layout = self._layout()
        # The sub has no layout of its own; it must resolve to the coordinator's.
        resolved = resolve_layout_for_org(self.project, self.sub, mode="live")
        self.assertEqual(resolved, layout)

    def test_resolve_returns_none_without_layout(self):
        self.assertIsNone(resolve_layout_for_org(self.project, self.sub, mode="live"))
