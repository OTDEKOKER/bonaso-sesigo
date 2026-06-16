"""Org-hierarchy permission isolation for aggregate review/approve (Phase 3).

These API-level contract tests exercise the "coordinator" and "sub-grantee"
*positions* in the organization hierarchy (which are not distinct roles) plus
the client gate:

  * A coordinator = a Manager whose organization is the PARENT of the reporting
    sub-grantees. Org scope (``get_user_organization_ids`` = org + descendants)
    must let them approve a descendant's data.
  * A sub-grantee Officer must NOT see or act on a SIBLING sub-grantee's data
    (cross-org isolation), and must never approve (officer = review tier only).
  * A Data Collector may submit but never review/approve.
  * A Client may never review or approve.

Users are intentionally left without project assignments so the rollout-safe
assignment gate is a no-op and pure organization scope governs (see
``projects.scope.filter_queryset_by_assigned_projects``).
"""
from datetime import date
from unittest.mock import patch

from rest_framework import status
from rest_framework.test import APITestCase

from aggregates.models import Aggregate
from audit.models import AuditEvent
from indicators.models import Indicator
from organizations.models import Organization
from projects.models import Project, ProjectIndicator
from users.models import User


class AggregateHierarchyPermissionTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        # Coordinator (parent) -> Sub 1, Sub 2 (sibling sub-grantees). Outside org
        # is unrelated. get_descendants() makes Sub1/Sub2 visible to the coordinator.
        cls.coord_org = Organization.objects.create(name="Coord", code="PERM_COORD", type="district")
        cls.sub1 = Organization.objects.create(name="Sub 1", code="PERM_SUB1", type="cso", parent=cls.coord_org)
        cls.sub2 = Organization.objects.create(name="Sub 2", code="PERM_SUB2", type="cso", parent=cls.coord_org)

        cls.admin = User.objects.create_user(
            username="perm_admin", email="perm_admin@example.com",
            password="TestPass123!", role="admin", organization=cls.coord_org,
        )
        cls.coordinator = User.objects.create_user(
            username="perm_coord", email="perm_coord@example.com",
            password="TestPass123!", role="manager", organization=cls.coord_org,
        )
        cls.sub1_officer = User.objects.create_user(
            username="perm_sub1_off", email="perm_sub1_off@example.com",
            password="TestPass123!", role="officer", organization=cls.sub1,
        )
        cls.sub1_collector = User.objects.create_user(
            username="perm_sub1_col", email="perm_sub1_col@example.com",
            password="TestPass123!", role="collector", organization=cls.sub1,
        )
        cls.sub1_client = User.objects.create_user(
            username="perm_sub1_cli", email="perm_sub1_cli@example.com",
            password="TestPass123!", role="client", organization=cls.sub1,
        )

        cls.project = Project.objects.create(
            name="Perm Project", code="PERM-1",
            start_date=date(2026, 1, 1), end_date=date(2026, 12, 31),
            created_by=cls.admin,
        )
        cls.project.organizations.add(cls.coord_org, cls.sub1, cls.sub2)

        cls.indicator = Indicator.objects.create(
            name="Reached", code="PERM_IND_1", type="number",
            category="hiv_prevention", created_by=cls.admin,
        )
        # Legacy fallback: a ProjectIndicator with no per-org assignments means
        # the indicator is reportable by every in-scope organization.
        ProjectIndicator.objects.create(project=cls.project, indicator=cls.indicator)

    def _aggregate(self, organization, status_value="reviewed"):
        return Aggregate.objects.create(
            indicator=self.indicator, project=self.project, organization=organization,
            period_start=date(2026, 1, 1), period_end=date(2026, 3, 31),
            value={"total": 5}, status=status_value, created_by=self.sub1_officer,
        )

    # --- Coordinator (parent-org manager) ----------------------------------

    def test_coordinator_can_approve_descendant_aggregate(self):
        aggregate = self._aggregate(self.sub1)
        self.client.force_authenticate(self.coordinator)
        response = self.client.post(f"/api/aggregates/{aggregate.id}/approve/", {}, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        aggregate.refresh_from_db()
        self.assertEqual(aggregate.status, "approved")
        self.assertEqual(aggregate.reviewed_by_id, self.coordinator.id)

    # --- Reviewer (officer) ------------------------------------------------

    def test_sub_officer_cannot_approve_even_own_org(self):
        aggregate = self._aggregate(self.sub1)
        self.client.force_authenticate(self.sub1_officer)
        response = self.client.post(f"/api/aggregates/{aggregate.id}/approve/", {}, format="json")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        aggregate.refresh_from_db()
        self.assertEqual(aggregate.status, "reviewed")

    def test_sub_officer_can_review_own_org(self):
        aggregate = self._aggregate(self.sub1, status_value="pending")
        self.client.force_authenticate(self.sub1_officer)
        response = self.client.post(f"/api/aggregates/{aggregate.id}/review/", {}, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    # --- Cross-org isolation (sibling sub-grantees) ------------------------

    def test_sub_officer_cannot_see_sibling_aggregate_in_list(self):
        own = self._aggregate(self.sub1)
        sibling = self._aggregate(self.sub2)
        self.client.force_authenticate(self.sub1_officer)
        response = self.client.get("/api/aggregates/?status=reviewed")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        body = response.json()
        results = body["results"] if isinstance(body, dict) and "results" in body else body
        returned_ids = {row["id"] for row in results}
        self.assertIn(own.id, returned_ids)
        self.assertNotIn(sibling.id, returned_ids)

    def test_sub_officer_cannot_act_on_sibling_aggregate(self):
        sibling = self._aggregate(self.sub2)
        self.client.force_authenticate(self.sub1_officer)
        response = self.client.post(f"/api/aggregates/{sibling.id}/review/", {}, format="json")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        sibling.refresh_from_db()
        self.assertEqual(sibling.status, "reviewed")

    # --- Data Collector ----------------------------------------------------

    def test_collector_can_submit_own_org_aggregate(self):
        self.client.force_authenticate(self.sub1_collector)
        response = self.client.post(
            "/api/aggregates/",
            {
                "indicator": self.indicator.id, "project": self.project.id,
                "organization": self.sub1.id, "period_start": "2026-01-01",
                "period_end": "2026-03-31", "value": {"total": 12},
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)

    def test_collector_cannot_review(self):
        aggregate = self._aggregate(self.sub1, status_value="pending")
        self.client.force_authenticate(self.sub1_collector)
        response = self.client.post(f"/api/aggregates/{aggregate.id}/review/", {}, format="json")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    # --- Client ------------------------------------------------------------

    def test_client_cannot_review_approve_reject_or_flag(self):
        aggregate = self._aggregate(self.sub1, status_value="pending")
        self.client.force_authenticate(self.sub1_client)
        review = self.client.post(f"/api/aggregates/{aggregate.id}/review/", {}, format="json")
        approve = self.client.post(f"/api/aggregates/{aggregate.id}/approve/", {}, format="json")
        reject = self.client.post(f"/api/aggregates/{aggregate.id}/reject/", {}, format="json")
        flag = self.client.post(f"/api/aggregates/{aggregate.id}/flag/", {}, format="json")
        self.assertEqual(review.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(approve.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(reject.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(flag.status_code, status.HTTP_403_FORBIDDEN)
        aggregate.refresh_from_db()
        self.assertEqual(aggregate.status, "pending")

    def test_client_cannot_create_aggregate(self):
        self.client.force_authenticate(self.sub1_client)
        response = self.client.post(
            "/api/aggregates/",
            {
                "indicator": self.indicator.id, "project": self.project.id,
                "organization": self.sub1.id, "period_start": "2026-01-01",
                "period_end": "2026-03-31", "value": {"total": 9},
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(Aggregate.objects.filter(value={"total": 9}).count(), 0)

    def test_client_cannot_update_aggregate(self):
        aggregate = self._aggregate(self.sub1, status_value="pending")
        self.client.force_authenticate(self.sub1_client)
        patch = self.client.patch(
            f"/api/aggregates/{aggregate.id}/",
            {"value": {"total": 999}},
            format="json",
        )
        put = self.client.put(
            f"/api/aggregates/{aggregate.id}/",
            {
                "indicator": self.indicator.id, "project": self.project.id,
                "organization": self.sub1.id, "period_start": "2026-01-01",
                "period_end": "2026-03-31", "value": {"total": 999},
            },
            format="json",
        )
        self.assertIn(patch.status_code, {status.HTTP_403_FORBIDDEN, status.HTTP_404_NOT_FOUND})
        self.assertIn(put.status_code, {status.HTTP_403_FORBIDDEN, status.HTTP_404_NOT_FOUND})
        aggregate.refresh_from_db()
        self.assertEqual(aggregate.value, {"total": 5})

    def test_admin_can_submit(self):
        self.client.force_authenticate(self.admin)
        response = self.client.post(
            "/api/aggregates/",
            {
                "indicator": self.indicator.id, "project": self.project.id,
                "organization": self.sub1.id, "period_start": "2026-04-01",
                "period_end": "2026-06-30", "value": {"total": 7},
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)

    # --- bulk_create scope (status-code correctness) -----------------------

    def test_bulk_create_cross_org_returns_403_and_writes_nothing(self):
        """A cross-org bulk_create must surface as 403 (PermissionDenied), not a
        flattened 400, and must not persist any row (atomic rollback)."""
        self.client.force_authenticate(self.sub1_officer)
        before = Aggregate.objects.count()
        response = self.client.post(
            "/api/aggregates/bulk_create/",
            {
                "project": self.project.id,
                "organization": self.sub2.id,  # sibling org, outside officer scope
                "period_start": "2026-01-01",
                "period_end": "2026-03-31",
                "data": [{"indicator": self.indicator.id, "value": {"total": 3}}],
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(Aggregate.objects.count(), before)

    def test_bulk_create_own_org_succeeds(self):
        self.client.force_authenticate(self.sub1_officer)
        response = self.client.post(
            "/api/aggregates/bulk_create/",
            {
                "project": self.project.id,
                "organization": self.sub1.id,
                "period_start": "2026-07-01",
                "period_end": "2026-09-30",
                "data": [{"indicator": self.indicator.id, "value": {"total": 4}}],
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)

    # --- bulk_delete safety ------------------------------------------------

    def test_bulk_delete_requires_approver(self):
        """A non-approver (officer) must never bulk-delete; rows survive."""
        agg = self._aggregate(self.sub1)
        self.client.force_authenticate(self.sub1_officer)
        response = self.client.post(
            "/api/aggregates/bulk_delete/", {"ids": [agg.id]}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertTrue(Aggregate.objects.filter(id=agg.id).exists())

    def test_bulk_delete_skips_out_of_scope_rows(self):
        """Approver can only delete within their org-scoped queryset; an id for an
        org outside scope is silently skipped, not deleted."""
        outside_org = Organization.objects.create(
            name="Outside", code="PERM_OUTSIDE", type="cso"
        )
        outside_agg = Aggregate.objects.create(
            indicator=self.indicator, project=self.project, organization=outside_org,
            period_start=date(2026, 1, 1), period_end=date(2026, 3, 31),
            value={"total": 5}, status="reviewed", created_by=self.admin,
        )
        in_scope = self._aggregate(self.sub1)
        self.client.force_authenticate(self.coordinator)
        response = self.client.post(
            "/api/aggregates/bulk_delete/",
            {"ids": [in_scope.id, outside_agg.id]},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["deleted"], 1)
        self.assertEqual(response.data["skipped"], 1)
        self.assertFalse(Aggregate.objects.filter(id=in_scope.id).exists())
        self.assertTrue(Aggregate.objects.filter(id=outside_agg.id).exists())

    def _aggregate_period(self, organization, status_value, period_start, period_end):
        return Aggregate.objects.create(
            indicator=self.indicator, project=self.project, organization=organization,
            period_start=period_start, period_end=period_end,
            value={"total": 5}, status=status_value, created_by=self.sub1_officer,
        )

    def test_bulk_delete_skips_flagged_rows(self):
        """Flagged rows are under review and must never be bulk-deleted."""
        flagged = self._aggregate_period(
            self.sub1, "flagged", date(2026, 1, 1), date(2026, 3, 31)
        )
        approved = self._aggregate_period(
            self.sub1, "approved", date(2026, 4, 1), date(2026, 6, 30)
        )
        self.client.force_authenticate(self.coordinator)
        response = self.client.post(
            "/api/aggregates/bulk_delete/",
            {"ids": [flagged.id, approved.id]},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["deleted"], 1)
        self.assertEqual(response.data["flagged_skipped"], 1)
        self.assertTrue(Aggregate.objects.filter(id=flagged.id).exists())
        self.assertFalse(Aggregate.objects.filter(id=approved.id).exists())

    def test_bulk_delete_resyncs_totals_only_for_approved(self):
        """Approved rows trigger project/indicator total re-sync; flagged rows are
        skipped entirely and never trigger a re-sync."""
        approved = self._aggregate_period(
            self.sub1, "approved", date(2026, 4, 1), date(2026, 6, 30)
        )
        flagged = self._aggregate_period(
            self.sub1, "flagged", date(2026, 1, 1), date(2026, 3, 31)
        )
        self.client.force_authenticate(self.coordinator)
        with patch("aggregates.views.sync_project_indicator_total") as mock_sync:
            response = self.client.post(
                "/api/aggregates/bulk_delete/",
                {"ids": [approved.id, flagged.id]},
                format="json",
            )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        mock_sync.assert_called_once_with(self.project.id, self.indicator.id)

    def test_bulk_delete_writes_audit_events(self):
        approved = self._aggregate(self.sub1, status_value="approved")
        self.client.force_authenticate(self.coordinator)
        self.client.post(
            "/api/aggregates/bulk_delete/", {"ids": [approved.id]}, format="json"
        )
        event = AuditEvent.objects.filter(
            action="delete", object_type="aggregate", object_id=str(approved.id)
        ).first()
        self.assertIsNotNone(event)
        self.assertTrue(event.metadata.get("bulk"))
