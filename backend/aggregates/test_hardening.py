"""Regression tests for the production-hardening changes (certification audit).

Covers, all backward-compatible and workbook-neutral:
  * C1/H4  reporting-history delete protection (project / indicator / organisation)
  * M6     archived/completed projects reject new submissions
  * C2     mixed-cadence overlapping-period reports are rejected on write
Lifecycle escape hatches (archive / retire) are exercised too.
"""
from datetime import date

from rest_framework import status
from rest_framework.test import APITestCase

from aggregates.models import Aggregate
from indicators.models import Indicator
from organizations.models import Organization
from projects.models import Project, ProjectIndicator
from users.models import User


class HardeningTestBase(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.org = Organization.objects.create(name="Org", code="HARD_ORG", type="cso")
        cls.admin = User.objects.create_user(
            username="hard_admin", email="hard_admin@example.com",
            password="TestPass123!", role="admin", organization=cls.org,
        )
        cls.project = Project.objects.create(
            name="Hard Project", code="HARD-1", status="active",
            start_date=date(2026, 1, 1), end_date=date(2026, 12, 31),
            created_by=cls.admin,
        )
        cls.project.organizations.add(cls.org)
        cls.indicator = Indicator.objects.create(
            name="Reached", code="HARD_IND", type="number",
            category="hiv_prevention", created_by=cls.admin,
        )
        ProjectIndicator.objects.create(project=cls.project, indicator=cls.indicator)

    def _existing_aggregate(self, period_start, period_end, status_value="approved"):
        """Insert an aggregate directly (bypassing the API write guards) to stand
        in for reporting history / a prior submission."""
        return Aggregate.objects.create(
            indicator=self.indicator, project=self.project, organization=self.org,
            period_start=period_start, period_end=period_end,
            value={"total": 5}, status=status_value, created_by=self.admin,
        )


class DeleteProtectionTests(HardeningTestBase):
    def test_project_with_history_cannot_be_deleted(self):
        self._existing_aggregate(date(2026, 4, 1), date(2026, 6, 30))
        self.client.force_authenticate(self.admin)
        resp = self.client.delete(f"/api/manage/projects/{self.project.id}/")
        self.assertEqual(resp.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(resp.data.get("code"), "reporting_history_exists")
        self.assertTrue(Project.objects.filter(id=self.project.id).exists())

    def test_empty_project_is_not_blocked(self):
        # NOTE: a full API DELETE cannot be asserted here because Project deletion
        # cascades to the unmanaged ``analysis_coordinatortarget`` table, which is
        # not created in the test DB. We assert the guard *permits* deletion (no
        # block reason) for a project with no reporting history; the 409 path is
        # covered by the history tests above.
        from core.lifecycle import project_delete_block_reason
        empty = Project.objects.create(
            name="Empty", code="HARD-EMPTY", status="draft",
            start_date=date(2026, 1, 1), end_date=date(2026, 12, 31),
            created_by=self.admin,
        )
        self.assertIsNone(project_delete_block_reason(empty))

    def test_indicator_with_history_cannot_be_deleted(self):
        self._existing_aggregate(date(2026, 4, 1), date(2026, 6, 30))
        self.client.force_authenticate(self.admin)
        resp = self.client.delete(f"/api/indicators/{self.indicator.id}/")
        self.assertEqual(resp.status_code, status.HTTP_409_CONFLICT)
        self.assertTrue(Indicator.objects.filter(id=self.indicator.id).exists())

    def test_organization_with_history_cannot_be_deleted(self):
        self._existing_aggregate(date(2026, 4, 1), date(2026, 6, 30))
        self.client.force_authenticate(self.admin)
        resp = self.client.delete(f"/api/organizations/{self.org.id}/")
        self.assertEqual(resp.status_code, status.HTTP_409_CONFLICT)
        self.assertTrue(Organization.objects.filter(id=self.org.id).exists())

    def test_retire_indicator_hides_but_preserves(self):
        self._existing_aggregate(date(2026, 4, 1), date(2026, 6, 30))
        self.client.force_authenticate(self.admin)
        resp = self.client.post(f"/api/indicators/{self.indicator.id}/retire/", {}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.indicator.refresh_from_db()
        self.assertFalse(self.indicator.is_active)
        # History untouched.
        self.assertTrue(Aggregate.objects.filter(indicator=self.indicator).exists())


class ProjectStatusWriteGateTests(HardeningTestBase):
    def _submit(self, period_start, period_end):
        return self.client.post("/api/aggregates/", {
            "indicator": self.indicator.id, "project": self.project.id,
            "organization": self.org.id,
            "period_start": str(period_start), "period_end": str(period_end),
            "value": {"total": 7},
        }, format="json")

    def test_active_project_accepts_submission(self):
        self.client.force_authenticate(self.admin)
        resp = self._submit(date(2026, 4, 1), date(2026, 6, 30))
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)

    def test_archived_project_rejects_submission(self):
        self.project.status = "archived"
        self.project.save(update_fields=["status"])
        self.client.force_authenticate(self.admin)
        resp = self._submit(date(2026, 4, 1), date(2026, 6, 30))
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_completed_project_rejects_submission(self):
        self.project.status = "completed"
        self.project.save(update_fields=["status"])
        self.client.force_authenticate(self.admin)
        resp = self._submit(date(2026, 4, 1), date(2026, 6, 30))
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_archive_action_sets_status(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.post(f"/api/manage/projects/{self.project.id}/archive/", {}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.project.refresh_from_db()
        self.assertEqual(self.project.status, "archived")


class CoordinatorSubOrgScopeTests(HardeningTestBase):
    """M7: the coordinator workbook's sub-org set must come from THIS project's
    hierarchy, never the global org tree (which could pull in an org that sits
    under the coordinator globally but belongs to a different project)."""

    def test_project_child_included_cross_project_child_excluded(self):
        from aggregates.views import AggregateViewSet
        from projects.models import ProjectOrganizationHierarchy

        coord = Organization.objects.create(name="Coord", code="M7_COORD", type="district")
        # Both are GLOBAL descendants of the coordinator (parent FK)...
        in_proj = Organization.objects.create(name="In Project", code="M7_IN", type="cso", parent=coord)
        other = Organization.objects.create(name="Other Project Only", code="M7_OUT", type="cso", parent=coord)

        # ...but only `in_proj` is under the coordinator in THIS project's hierarchy.
        self.project.organizations.add(coord, in_proj)
        ProjectOrganizationHierarchy.objects.create(
            project=self.project, parent_organization=coord, child_organization=in_proj,
        )

        result_ids = {o.id for o in AggregateViewSet._coordinator_sub_orgs(self.project, coord)}
        self.assertIn(coord.id, result_ids)
        self.assertIn(in_proj.id, result_ids)
        self.assertNotIn(other.id, result_ids)  # global-tree child from another project excluded

    def test_flat_project_falls_back_to_members_only(self):
        from aggregates.views import AggregateViewSet

        coord = Organization.objects.create(name="Coord2", code="M7_COORD2", type="district")
        member = Organization.objects.create(name="Member", code="M7_MEM", type="cso", parent=coord)
        nonmember = Organization.objects.create(name="Nonmember", code="M7_NON", type="cso", parent=coord)
        # No ProjectOrganizationHierarchy edges → fallback path. Only project members
        # (via global descendants ∩ membership) may appear; nonmember must not.
        self.project.organizations.add(coord, member)  # nonmember NOT added

        result_ids = {o.id for o in AggregateViewSet._coordinator_sub_orgs(self.project, coord)}
        self.assertIn(coord.id, result_ids)
        self.assertIn(member.id, result_ids)
        self.assertNotIn(nonmember.id, result_ids)


class PeriodOverlapGuardTests(HardeningTestBase):
    def _submit(self, period_start, period_end, value=9):
        return self.client.post("/api/aggregates/", {
            "indicator": self.indicator.id, "project": self.project.id,
            "organization": self.org.id,
            "period_start": str(period_start), "period_end": str(period_end),
            "value": {"total": value},
        }, format="json")

    def test_overlapping_monthly_rejected_when_quarter_exists(self):
        # Existing Q1 quarterly report (Apr-Jun).
        self._existing_aggregate(date(2026, 4, 1), date(2026, 6, 30), status_value="pending")
        self.client.force_authenticate(self.admin)
        # A monthly report for May overlaps the quarter → double-count risk.
        resp = self._submit(date(2026, 5, 1), date(2026, 5, 31))
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_non_overlapping_month_allowed(self):
        # Existing April monthly report.
        self._existing_aggregate(date(2026, 4, 1), date(2026, 4, 30), status_value="pending")
        self.client.force_authenticate(self.admin)
        # A May monthly report does NOT overlap April → allowed.
        resp = self._submit(date(2026, 5, 1), date(2026, 5, 31))
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)

    def test_identical_period_is_upsert_not_conflict(self):
        self._existing_aggregate(date(2026, 4, 1), date(2026, 6, 30), status_value="pending")
        self.client.force_authenticate(self.admin)
        # Re-submitting the same period is the normal upsert, not an overlap.
        resp = self._submit(date(2026, 4, 1), date(2026, 6, 30))
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
