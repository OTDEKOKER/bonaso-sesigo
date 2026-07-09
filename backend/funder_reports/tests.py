"""Tests for the Funder Report Builder — configuration, generation, permissions."""
from datetime import date

from rest_framework import status
from rest_framework.test import APITestCase

from aggregates.models import Aggregate, AggregateFact
from indicators.models import Indicator
from organizations.models import Organization
from projects.models import (
    Project, ProjectIndicator, ProjectIndicatorOrganizationTarget,
    ProjectIndicatorAssignment, ProjectOrganization,
)
from users.models import User

from io import StringIO
from django.core.management import call_command

from funder_reports.generation import generate_figure
from funder_reports.models import (
    ReportTemplate, ReportSection, ReportFigure, ReportFigureIndicatorMapping,
    ChartType, Dimension, TargetMode, CalculationMode, MappingRole,
)

# Elapsed quarter (Q1 FY2024 = Apr-Jun 2024).
PS, PE = date(2024, 4, 1), date(2024, 6, 30)


class ReportBase(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.org_a = Organization.objects.create(name="Alpha CSO", code="FR_A", type="cso")
        cls.org_b = Organization.objects.create(name="Beta CSO", code="FR_B", type="cso")
        cls.admin = User.objects.create_user(
            username="fr_admin", email="fra@example.com", password="TestPass123!",
            role="admin", organization=cls.org_a,
        )
        cls.officer = User.objects.create_user(
            username="fr_officer", email="fro@example.com", password="TestPass123!",
            role="officer", organization=cls.org_b,
        )
        cls.project = Project.objects.create(
            name="NAHPA SC", code="FR-1", status="active",
            start_date=date(2024, 1, 1), end_date=date(2027, 12, 31), created_by=cls.admin,
        )
        cls.project.organizations.add(cls.org_a, cls.org_b)
        cls.ind_reach = Indicator.objects.create(
            name="Number of people reached with HIV prevention messages", code="FR_REACH",
            type="number", category="hiv_prevention", created_by=cls.admin,
        )
        cls.pi = ProjectIndicator.objects.create(project=cls.project, indicator=cls.ind_reach)

        cls.template = ReportTemplate.objects.create(
            name="NAHPA Social Contracting", reporting_year="2024/25",
            funder="NAHPA", project=cls.project, created_by=cls.admin,
        )
        cls.section = ReportSection.objects.create(
            report_template=cls.template, title="Objective 1", display_order=0,
        )

    def _fact(self, org, value, *, secondary="All", primary="All", band="Total", statusv="approved"):
        # One Aggregate per (indicator, project, org, period) natural key; a call
        # for the same org just adds another controlled fact leaf (e.g. sex split).
        agg, created = Aggregate.objects.get_or_create(
            indicator=self.ind_reach, project=self.project, organization=org,
            period_start=PS, period_end=PE,
            defaults={"value": {"total": value}, "status": statusv, "created_by": self.admin},
        )
        # On creation the fact-sync signal builds facts from value; clear those
        # once so only our controlled leaves remain. Subsequent calls (same org)
        # just append another leaf without wiping earlier ones.
        if created:
            AggregateFact.objects.filter(aggregate=agg).delete()
        return AggregateFact.objects.create(
            aggregate=agg, indicator=self.ind_reach, canonical_indicator=self.ind_reach,
            project=self.project, organization=org, period_start=PS, period_end=PE,
            status=statusv, is_training=False, primary=primary, secondary=secondary,
            band=band, value=value,
        )

    def _figure(self, **kwargs):
        defaults = dict(
            report_section=self.section, figure_number="F1", title="Reach by CSO",
            chart_type=ChartType.GROUPED_BAR, grouping_dimension=Dimension.ORGANIZATION,
        )
        defaults.update(kwargs)
        fig = ReportFigure.objects.create(**defaults)
        ReportFigureIndicatorMapping.objects.create(
            report_figure=fig, indicator=self.ind_reach, role=MappingRole.ACHIEVED,
        )
        return fig


class GenerationTests(ReportBase):
    def test_group_by_organization(self):
        self._fact(self.org_a, 100)
        self._fact(self.org_b, 40)
        fig = self._figure()
        out = generate_figure(fig, project=self.project, period_start=PS, period_end=PE)
        self.assertEqual(out["chart_type"], ChartType.GROUPED_BAR)
        self.assertEqual(set(out["categories"]), {"Alpha CSO", "Beta CSO"})
        self.assertEqual(out["totals"]["total"], 140)

    def test_only_approved_data_counts(self):
        self._fact(self.org_a, 100, statusv="approved")
        self._fact(self.org_b, 999, statusv="pending")
        fig = self._figure()
        out = generate_figure(fig, project=self.project, period_start=PS, period_end=PE)
        self.assertEqual(out["totals"]["total"], 100)

    def test_achieved_vs_target_percentage(self):
        self._fact(self.org_a, 80)
        ProjectIndicatorOrganizationTarget.objects.create(
            project_indicator=self.pi, organization=self.org_a, q1_target=100,
        )
        fig = self._figure(chart_type=ChartType.ACHIEVED_VS_TARGET,
                           target_mode=TargetMode.ORG_QUARTER,
                           calculation_mode=CalculationMode.ACHIEVEMENT_PERCENT)
        out = generate_figure(fig, project=self.project, period_start=PS, period_end=PE)
        self.assertIn("target", out)
        self.assertEqual(out["totals"]["target"], 100)
        self.assertEqual(out["totals"]["achievement_percent"], 80.0)

    def test_missing_target_warns(self):
        self._fact(self.org_a, 80)
        fig = self._figure(target_mode=TargetMode.ORG_QUARTER)
        out = generate_figure(fig, project=self.project, period_start=PS, period_end=PE)
        self.assertTrue(any("Target required" in w for w in out["warnings"]))

    def test_no_mappings_warns(self):
        fig = ReportFigure.objects.create(
            report_section=self.section, figure_number="F0", title="Empty",
            grouping_dimension=Dimension.ORGANIZATION,
        )
        out = generate_figure(fig, project=self.project, period_start=PS, period_end=PE)
        self.assertTrue(any("no mapped indicators" in w for w in out["warnings"]))

    def test_group_by_sex_secondary(self):
        self._fact(self.org_a, 60, secondary="Female")
        self._fact(self.org_a, 40, secondary="Male")
        fig = self._figure(grouping_dimension=Dimension.SEX)
        out = generate_figure(fig, project=self.project, period_start=PS, period_end=PE)
        self.assertEqual(set(out["categories"]), {"Female", "Male"})
        self.assertEqual(out["totals"]["total"], 100)

    def test_completeness_flags_missing_org(self):
        # org_a and org_b both assigned+eligible; only org_a reports.
        for org in (self.org_a, self.org_b):
            ProjectOrganization.objects.create(project=self.project, organization=org, is_active=True)
            ProjectIndicatorAssignment.objects.create(
                project_indicator=self.pi, organization=org, is_active=True,
            )
        self._fact(self.org_a, 100)
        fig = self._figure()
        out = generate_figure(fig, project=self.project, period_start=PS, period_end=PE)
        self.assertEqual(out["completeness"]["expected"], 2)
        self.assertEqual(out["completeness"]["missing"], 1)


class ComplianceTests(ReportBase):
    def test_compliance_matrix_reflects_submissions(self):
        """Table 1 compliance is per-coordinator × quarter submission status from
        raw Aggregate submissions (not indicators). A quarter with a submission
        for the coordinator's org reads 'submitted'; an elapsed quarter without
        one reads 'not_submitted'; a future quarter reads 'not_opened'."""
        from projects.models import ProjectOrganizationHierarchy
        from datetime import date
        sub = Organization.objects.create(name="Sub C", code="FR_SC", type="cso")
        self.project.organizations.add(sub)
        ProjectOrganization.objects.create(project=self.project, organization=self.org_a, is_coordinator=True, role="coordinator")
        ProjectOrganization.objects.create(project=self.project, organization=sub, role="sub_grantee")
        ProjectOrganizationHierarchy.objects.create(project=self.project, parent_organization=self.org_a, child_organization=sub, is_active=True)
        # A Q1 (Apr-Jun) submission for the coordinator's sub in a past fiscal year.
        Aggregate.objects.create(indicator=self.ind_reach, project=self.project, organization=sub,
                                 period_start=date(2024, 4, 1), period_end=date(2024, 6, 30),
                                 value={"total": 5}, status="approved", created_by=self.admin)
        fig = self._figure(chart_type=ChartType.COMPLIANCE, grouping_dimension=Dimension.COORDINATOR)
        out = generate_figure(fig, project=self.project, period_start=date(2024, 4, 1), period_end=date(2024, 6, 30))
        self.assertEqual(out["chart_type"], ChartType.COMPLIANCE)
        row = next(r for r in out["compliance"]["rows"] if r["coordinator"] == "Alpha CSO")
        by_q = {c["quarter"]: c["status"] for c in row["cells"]}
        self.assertEqual(by_q["Q1"], "submitted")
        self.assertEqual(by_q["Q2"], "not_submitted")  # elapsed, nothing submitted


class CoordinatorGroupingTests(ReportBase):
    def test_group_by_coordinator_rolls_up_suborgs(self):
        """A sub-org's data rolls up to its coordinator (per the PROJECT
        hierarchy); orgs outside every coordinator subtree are excluded."""
        from projects.models import ProjectOrganizationHierarchy
        sub = Organization.objects.create(name="Sub One", code="FR_SUB", type="cso")
        self.project.organizations.add(sub)
        ProjectOrganization.objects.create(
            project=self.project, organization=self.org_a,
            is_coordinator=True, role="coordinator",
        )
        ProjectOrganization.objects.create(
            project=self.project, organization=sub, role="sub_grantee",
        )
        ProjectOrganizationHierarchy.objects.create(
            project=self.project, parent_organization=self.org_a,
            child_organization=sub, is_active=True,
        )
        self._fact(self.org_a, 100)  # coordinator's own contribution
        self._fact(sub, 40)          # rolled up under the coordinator
        self._fact(self.org_b, 999)  # no coordinator → dropped from the rollup
        fig = self._figure(grouping_dimension=Dimension.COORDINATOR)
        out = generate_figure(fig, project=self.project, period_start=PS, period_end=PE)
        self.assertEqual(out["categories"], ["Alpha CSO"])
        self.assertEqual(out["series"][0]["data"], [140.0])
        self.assertTrue(any("not mapped to a coordinator" in w for w in out["warnings"]))

    def test_coordinator_target_uses_coordinator_org_target(self):
        from projects.models import ProjectOrganizationHierarchy
        sub = Organization.objects.create(name="Sub Two", code="FR_SUB2", type="cso")
        self.project.organizations.add(sub)
        ProjectOrganization.objects.create(
            project=self.project, organization=self.org_a, is_coordinator=True, role="coordinator")
        ProjectOrganization.objects.create(
            project=self.project, organization=sub, role="sub_grantee")
        ProjectOrganizationHierarchy.objects.create(
            project=self.project, parent_organization=self.org_a, child_organization=sub, is_active=True)
        self._fact(sub, 80)
        ProjectIndicatorOrganizationTarget.objects.create(
            project_indicator=self.pi, organization=self.org_a, q1_target=100)
        fig = self._figure(grouping_dimension=Dimension.COORDINATOR,
                           chart_type=ChartType.ACHIEVED_VS_TARGET,
                           target_mode=TargetMode.ORG_QUARTER,
                           calculation_mode=CalculationMode.ACHIEVEMENT_PERCENT)
        out = generate_figure(fig, project=self.project, period_start=PS, period_end=PE)
        self.assertEqual(out["categories"], ["Alpha CSO"])
        self.assertEqual(out["totals"]["target"], 100)
        self.assertEqual(out["totals"]["achievement_percent"], 80.0)

    def test_indicator_grouping_keeps_mapping_order_for_cascade(self):
        """Cascade/funnel stages must stay in configured mapping order, never be
        reordered by value (a later, larger stage would otherwise jump ahead)."""
        stage2 = Indicator.objects.create(
            name="Number tested positive", code="FR_POS", type="number", created_by=self.admin)
        stage3 = Indicator.objects.create(
            name="Number initiated on ART", code="FR_ART", type="number", created_by=self.admin)
        # Stage 1 (reach) large, stage 2 small, stage 3 medium → value-sort would
        # scramble the sequence; mapping order must win.
        def _stage_fact(ind, value):
            agg, created = Aggregate.objects.get_or_create(
                indicator=ind, project=self.project, organization=self.org_a,
                period_start=PS, period_end=PE,
                defaults={"value": {"total": value}, "status": "approved", "created_by": self.admin})
            if created:
                AggregateFact.objects.filter(aggregate=agg).delete()
            AggregateFact.objects.create(
                aggregate=agg, indicator=ind, canonical_indicator=ind, project=self.project,
                organization=self.org_a, period_start=PS, period_end=PE, status="approved",
                is_training=False, primary="All", secondary="All", band="Total", value=value)

        self._fact(self.org_a, 1000)  # ind_reach = stage 1
        _stage_fact(stage2, 200)      # stage 2 (small)
        _stage_fact(stage3, 500)      # stage 3 (medium) — value-sort would misorder
        fig = ReportFigure.objects.create(
            report_section=self.section, figure_number="CAS", title="Cascade",
            chart_type=ChartType.CASCADE, grouping_dimension=Dimension.INDICATOR)
        for order, ind in enumerate((self.ind_reach, stage2, stage3)):
            ReportFigureIndicatorMapping.objects.create(
                report_figure=fig, indicator=ind, role=MappingRole.ACHIEVED, display_order=order)
        out = generate_figure(fig, project=self.project, period_start=PS, period_end=PE)
        self.assertEqual(
            out["categories"],
            ["Number of people reached with HIV prevention messages",
             "Number tested positive", "Number initiated on ART"])

    def test_coordinator_falls_back_to_org_when_none_defined(self):
        # No is_coordinator orgs on this project → grouping degrades gracefully
        # to per-organization so the figure still renders.
        self._fact(self.org_a, 100)
        self._fact(self.org_b, 40)
        fig = self._figure(grouping_dimension=Dimension.COORDINATOR)
        out = generate_figure(fig, project=self.project, period_start=PS, period_end=PE)
        self.assertEqual(set(out["categories"]), {"Alpha CSO", "Beta CSO"})
        self.assertEqual(out["totals"]["total"], 140)


class ApiTests(ReportBase):
    def test_officer_cannot_edit_system_template(self):
        # Self-service lets anyone create their OWN template, but a system template
        # (owner is None, e.g. the seeded NAHPA report) is admin-only to edit.
        self.client.force_authenticate(self.officer)
        resp = self.client.patch(f"/api/reports/templates/{self.template.id}/",
                                 {"name": "hijack"}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_admin_creates_template_audited(self):
        from audit.models import AuditEvent
        self.client.force_authenticate(self.admin)
        resp = self.client.post("/api/reports/templates/", {
            "name": "Y", "project": self.project.id, "reporting_year": "2025/26",
        }, format="json")
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        self.assertTrue(AuditEvent.objects.filter(object_type="report_template").exists())

    def test_officer_can_preview(self):
        self._fact(self.org_b, 50)
        fig = self._figure()
        self.client.force_authenticate(self.officer)
        resp = self.client.post(f"/api/reports/figures/{fig.id}/preview/", {
            "project": self.project.id, "quarter": 1, "fiscal_year": 2024,
        }, format="json")
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        # officer is scoped to org_b — sees the 50 it reported.
        self.assertEqual(resp.data["totals"]["total"], 50)

    def test_generate_full_dashboard(self):
        self._fact(self.org_a, 100)
        self._figure()
        self.client.force_authenticate(self.admin)
        resp = self.client.post(f"/api/reports/templates/{self.template.id}/generate/", {
            "project": self.project.id, "quarter": 1, "fiscal_year": 2024,
        }, format="json")
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.assertEqual(len(resp.data["sections"]), 1)
        self.assertEqual(resp.data["period_label"], "Q1 2024/25")


class SelfServiceAndSharingTests(ReportBase):
    def _make_client_user(self):
        return User.objects.create_user(username="fr_funder", email="f@example.com",
                                        password="TestPass123!", role="client", organization=self.org_b)

    def test_officer_creates_own_personal_template_and_figure(self):
        self.client.force_authenticate(self.officer)
        t = self.client.post("/api/reports/templates/", {
            "name": "My view", "project": self.project.id, "reporting_year": "2024/25",
            "visibility": "private",
        }, format="json")
        self.assertEqual(t.status_code, status.HTTP_201_CREATED, t.data)
        self.assertEqual(t.data["owner"], self.officer.id)
        # Owner can add a section + figure to their own template.
        s = self.client.post("/api/reports/sections/", {"report_template": t.data["id"], "title": "S"}, format="json")
        self.assertEqual(s.status_code, status.HTTP_201_CREATED, s.data)
        f = self.client.post("/api/reports/figures/", {
            "report_section": s.data["id"], "title": "F", "grouping_dimension": "organization",
        }, format="json")
        self.assertEqual(f.status_code, status.HTTP_201_CREATED, f.data)

    def test_user_cannot_add_figure_to_others_template(self):
        # officer2 tries to add a section to officer's private template.
        self.client.force_authenticate(self.officer)
        t = self.client.post("/api/reports/templates/", {
            "name": "Mine", "project": self.project.id, "reporting_year": "2024/25",
        }, format="json").data
        other = User.objects.create_user(username="fr_o2", email="o2@example.com",
                                         password="TestPass123!", role="officer", organization=self.org_a)
        self.client.force_authenticate(other)
        resp = self.client.post("/api/reports/sections/",
                                {"report_template": t["id"], "title": "X"}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_funder_can_create_and_generate_but_only_approved(self):
        funder = self._make_client_user()
        self._fact(self.org_b, 40, statusv="approved")
        self._fact(self.org_b, 60, statusv="pending")
        self.client.force_authenticate(funder)
        # Funder self-service create.
        t = self.client.post("/api/reports/templates/", {
            "name": "Funder view", "project": self.project.id, "reporting_year": "2024/25",
        }, format="json")
        self.assertEqual(t.status_code, status.HTTP_201_CREATED, t.data)
        # Funder previews a figure — approved only, even asking for pending.
        fig = self._figure()
        resp = self.client.post(f"/api/reports/figures/{fig.id}/preview/", {
            "project": self.project.id, "quarter": 1, "fiscal_year": 2024, "include_unapproved": True,
        }, format="json")
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.assertEqual(resp.data["totals"]["total"], 40)  # pending 60 excluded

    def test_shared_template_visible_to_shared_user_only(self):
        owner = User.objects.create_user(username="fr_owner", email="ow@example.com",
                                         password="TestPass123!", role="officer", organization=self.org_a)
        self.client.force_authenticate(owner)
        t = self.client.post("/api/reports/templates/", {
            "name": "Shared", "project": self.project.id, "reporting_year": "2024/25", "visibility": "private",
        }, format="json").data
        self.client.patch(f"/api/reports/templates/{t['id']}/",
                          {"shared_with_users": [self.officer.id]}, format="json")
        # Shared-with user sees it.
        self.client.force_authenticate(self.officer)
        ids = [r["id"] for r in self.client.get("/api/reports/templates/").data.get("results", self.client.get("/api/reports/templates/").data)]
        self.assertIn(t["id"], ids)
        # Unrelated user does not.
        stranger = User.objects.create_user(username="fr_x", email="x@example.com",
                                            password="TestPass123!", role="officer", organization=self.org_b)
        self.client.force_authenticate(stranger)
        data = self.client.get("/api/reports/templates/").data
        ids2 = [r["id"] for r in data.get("results", data)]
        self.assertNotIn(t["id"], ids2)


class WordExportTests(ReportBase):
    def test_full_report_word_export(self):
        self._fact(self.org_a, 100)
        self._figure()
        self.client.force_authenticate(self.admin)
        resp = self.client.post(f"/api/reports/templates/{self.template.id}/export-word/", {
            "project": self.project.id, "quarter": 1, "fiscal_year": 2024,
        }, format="json")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp["Content-Type"],
                         "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
        self.assertGreater(len(resp.content), 0)


class NahpaSeedTests(ReportBase):
    def test_seed_is_idempotent_and_reconciles(self):
        out = StringIO()
        call_command("seed_nahpa_report", "--project", str(self.project.id), stdout=out)
        first = ReportTemplate.objects.get(name="NAHPA Social Contracting", reporting_year="2025/26")
        n_sections = first.sections.count()
        n_figures = ReportFigure.objects.filter(report_section__report_template=first).count()
        self.assertGreaterEqual(n_figures, 30)  # full report, not partial
        # Re-run: same counts, no duplication.
        call_command("seed_nahpa_report", "--project", str(self.project.id), stdout=StringIO())
        self.assertEqual(ReportTemplate.objects.filter(name="NAHPA Social Contracting", reporting_year="2025/26").count(), 1)
        self.assertEqual(first.sections.count(), n_sections)
        self.assertEqual(ReportFigure.objects.filter(report_section__report_template=first).count(), n_figures)

    def test_dry_run_writes_nothing(self):
        call_command("seed_nahpa_report", "--project", str(self.project.id), "--dry-run", stdout=StringIO())
        self.assertFalse(ReportTemplate.objects.filter(name="NAHPA Social Contracting", reporting_year="2025/26").exists())


class EditabilityTests(ReportBase):
    def test_admin_can_edit_chart_type_persisted(self):
        fig = self._figure()
        self.client.force_authenticate(self.admin)
        resp = self.client.patch(f"/api/reports/figures/{fig.id}/",
                                 {"chart_type": "horizontal_bar"}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        fig.refresh_from_db()
        self.assertEqual(fig.chart_type, "horizontal_bar")

    def test_officer_cannot_edit_mappings(self):
        fig = self._figure()
        self.client.force_authenticate(self.officer)
        resp = self.client.post(f"/api/reports/figures/{fig.id}/mappings/",
                                {"indicator": self.ind_reach.id, "role": "achieved"}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_manager_can_edit_mappings(self):
        mgr = User.objects.create_user(username="fr_mgr", email="m@example.com",
                                       password="TestPass123!", role="manager", organization=self.org_a)
        fig = ReportFigure.objects.create(report_section=self.section, figure_number="Fm",
                                          title="m", grouping_dimension=Dimension.ORGANIZATION)
        self.client.force_authenticate(mgr)
        resp = self.client.post(f"/api/reports/figures/{fig.id}/mappings/",
                                {"indicator": self.ind_reach.id, "role": "achieved"}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)

    def test_editing_mapping_changes_preview_output(self):
        # Figure with NO mapping → 0 total; add a mapping → preview reflects data.
        self._fact(self.org_a, 100)
        fig = ReportFigure.objects.create(report_section=self.section, figure_number="Fe",
                                          title="e", grouping_dimension=Dimension.ORGANIZATION)
        self.client.force_authenticate(self.admin)
        before = self.client.post(f"/api/reports/figures/{fig.id}/preview/",
                                  {"project": self.project.id, "quarter": 1, "fiscal_year": 2024}, format="json")
        self.assertEqual(before.data["totals"]["total"], 0)
        self.client.post(f"/api/reports/figures/{fig.id}/mappings/",
                         {"indicator": self.ind_reach.id, "role": "achieved"}, format="json")
        after = self.client.post(f"/api/reports/figures/{fig.id}/preview/",
                                 {"project": self.project.id, "quarter": 1, "fiscal_year": 2024}, format="json")
        self.assertEqual(after.data["totals"]["total"], 100)

    def test_duplicate_and_disable_figure(self):
        fig = self._figure()
        self.client.force_authenticate(self.admin)
        dup = self.client.post(f"/api/reports/figures/{fig.id}/duplicate/", {}, format="json")
        self.assertEqual(dup.status_code, status.HTTP_201_CREATED)
        self.assertEqual(dup.data["mappings"][0]["indicator"], self.ind_reach.id)
        off = self.client.post(f"/api/reports/figures/{fig.id}/set-active/",
                               {"is_active": False}, format="json")
        self.assertFalse(off.data["is_active"])


class FilterAndScopeTests(ReportBase):
    def test_preview_respects_sex_filter(self):
        self._fact(self.org_a, 60, secondary="Female")
        self._fact(self.org_a, 40, secondary="Male")
        fig = self._figure(grouping_dimension=Dimension.SEX)
        self.client.force_authenticate(self.admin)
        resp = self.client.post(f"/api/reports/figures/{fig.id}/preview/", {
            "project": self.project.id, "quarter": 1, "fiscal_year": 2024, "sex": ["Female"],
        }, format="json")
        self.assertEqual(resp.data["totals"]["total"], 60)
        self.assertEqual(resp.data["applied_filters"].get("sex"), ["Female"])

    def test_preview_respects_organization_filter(self):
        self._fact(self.org_a, 100)
        self._fact(self.org_b, 25)
        fig = self._figure()
        self.client.force_authenticate(self.admin)
        resp = self.client.post(f"/api/reports/figures/{fig.id}/preview/", {
            "project": self.project.id, "quarter": 1, "fiscal_year": 2024,
            "organization": [self.org_b.id],
        }, format="json")
        self.assertEqual(resp.data["totals"]["total"], 25)

    def test_coordinator_cannot_escape_scope_via_org_param(self):
        # Officer scoped to org_b tries to pull org_a's data by param — must not.
        self._fact(self.org_a, 500)
        self._fact(self.org_b, 10)
        fig = self._figure()
        self.client.force_authenticate(self.officer)  # org_b only
        resp = self.client.post(f"/api/reports/figures/{fig.id}/preview/", {
            "project": self.project.id, "quarter": 1, "fiscal_year": 2024,
            "organization": [self.org_a.id],
        }, format="json")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        # Intersection of requested {org_a} with allowed {org_b} = empty → 0.
        self.assertEqual(resp.data["totals"]["total"], 0)

    def test_officer_cannot_include_unapproved(self):
        self._fact(self.org_b, 30, statusv="approved")
        self._fact(self.org_b, 70, statusv="pending")
        fig = self._figure()
        self.client.force_authenticate(self.officer)
        resp = self.client.post(f"/api/reports/figures/{fig.id}/preview/", {
            "project": self.project.id, "quarter": 1, "fiscal_year": 2024,
            "include_unapproved": True,
        }, format="json")
        # Officer may not view pending → only the 30 approved.
        self.assertEqual(resp.data["totals"]["total"], 30)

    def test_no_data_for_filter_warns(self):
        self._fact(self.org_a, 100, secondary="Female")
        fig = self._figure(grouping_dimension=Dimension.SEX)
        self.client.force_authenticate(self.admin)
        resp = self.client.post(f"/api/reports/figures/{fig.id}/preview/", {
            "project": self.project.id, "quarter": 1, "fiscal_year": 2024, "sex": ["Male"],
        }, format="json")
        self.assertTrue(any("No data" in w for w in resp.data["warnings"]))


class SnapshotAndExportTests(ReportBase):
    def test_snapshot_stores_filter_and_scope_context(self):
        self._fact(self.org_a, 100, secondary="Female")
        fig = self._figure(grouping_dimension=Dimension.SEX)
        self.client.force_authenticate(self.admin)
        resp = self.client.post(f"/api/reports/figures/{fig.id}/save-snapshot/", {
            "project": self.project.id, "quarter": 1, "fiscal_year": 2024, "sex": ["Female"],
        }, format="json")
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        self.assertEqual(resp.data["filters_json"].get("sex"), ["Female"])
        self.assertEqual(resp.data["period_mode"], "quarter")
        self.assertIn("mappings", resp.data["chart_config_json"])
        self.assertIn("approved_only", resp.data["scope_json"])

    def test_export_uses_same_filters_as_preview(self):
        self._fact(self.org_a, 60, secondary="Female")
        self._fact(self.org_a, 40, secondary="Male")
        fig = self._figure(grouping_dimension=Dimension.SEX)
        self.client.force_authenticate(self.admin)
        resp = self.client.post(f"/api/reports/figures/{fig.id}/export/", {
            "project": self.project.id, "quarter": 1, "fiscal_year": 2024, "sex": ["Female"],
        }, format="json")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp["Content-Type"],
                         "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        self.assertGreater(len(resp.content), 0)

    def test_published_snapshot_stable_after_figure_change(self):
        self._fact(self.org_a, 100)
        fig = self._figure()
        self.client.force_authenticate(self.admin)
        snap = self.client.post(f"/api/reports/figures/{fig.id}/save-snapshot/", {
            "project": self.project.id, "quarter": 1, "fiscal_year": 2024,
        }, format="json")
        snap_id = snap.data["id"]
        pub = self.client.post(f"/api/reports/snapshots/{snap_id}/publish/", {}, format="json")
        self.assertEqual(pub.data["status"], "published")
        # Later edit the figure; the published snapshot's frozen data is unchanged.
        self.client.patch(f"/api/reports/figures/{fig.id}/", {"title": "Changed"}, format="json")
        got = self.client.get(f"/api/reports/snapshots/{snap_id}/")
        self.assertEqual(got.data["data_json"]["totals"]["total"], 100)
        self.assertEqual(got.data["chart_config_json"]["title"], "Reach by CSO")
