"""Regression tests for the workbook architecture remediation (P1-P5).

Covers the eight guarantees from the fix brief:

  1. Coordinator workbook sub-sheet scope == analytics rollup scope.
  2. WorkbookLayout controls indicator order.
  3. Assigned-but-unplaced indicators are surfaced as warnings.
  4. Deprecated assigned indicators redirect to canonical (never silently vanish).
  5. Historical layout snapshots preserve a past period's structure.
  6. SESIGO workbook import maps by indicator_id, not row position.
  7. Fuzzy/legacy import refuses to write without a dry-run confirmation.
  8. Live and Training workbook layouts stay isolated.
"""
from datetime import date

from django.test import TestCase

from aggregates import reporting_workbook as rw
from aggregates.views import AggregateViewSet
from indicators.models import Indicator
from organizations.models import Organization
from projects.hierarchy import (
    resolve_organization_scope_with_project_hierarchy,
    resolve_workbook_scope_organizations,
)
from projects.models import (
    Project,
    ProjectIndicator,
    ProjectIndicatorAssignment,
    ProjectOrganization,
    ProjectOrganizationHierarchy,
    WorkbookLayout,
    WorkbookLayoutItem,
)
from projects.workbook_layout import UNORDERED_SECTION, get_active_layout, order_plans_by_layout
from projects.workbook_snapshot import get_or_create_snapshot, order_plans_by_snapshot
from uploads.models import ImportJob, Upload
from uploads.views import fuzzy_import_needs_confirmation
from users.models import User


def _plan(indicator):
    return rw.IndicatorPlan(
        indicator=indicator, config=rw.resolve_matrix_config(indicator),
        target=None, existing_cells={},
    )


class WorkbookArchitectureTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.coord = Organization.objects.create(name='Coord Org', code='WA_COORD', type='district')
        cls.child = Organization.objects.create(name='Child Org', code='WA_CHILD', type='cso', parent=cls.coord)
        cls.outside = Organization.objects.create(name='Outside Org', code='WA_OUT', type='cso')
        cls.admin = User.objects.create_user(
            username='wa_admin', email='wa_admin@example.com', password='TestPass123!',
            role='admin', organization=cls.coord,
        )
        cls.project = Project.objects.create(
            name='WA Project', code='WA-1', start_date=date(2026, 1, 1),
            end_date=date(2027, 12, 31), created_by=cls.admin,
        )
        # Project scope + project-specific hierarchy (coord -> child). ``outside``
        # is a GLOBAL nothing here but deliberately NOT in the project hierarchy.
        for org in (cls.coord, cls.child):
            ProjectOrganization.objects.create(project=cls.project, organization=org, is_active=True)
        ProjectOrganizationHierarchy.objects.create(
            project=cls.project, parent_organization=cls.coord, child_organization=cls.child,
        )
        cls.i1 = Indicator.objects.create(name='Alpha Reached', code='WA_I1', type='number', created_by=cls.admin)
        cls.i2 = Indicator.objects.create(name='Beta Screened', code='WA_I2', type='number', created_by=cls.admin)
        cls.i3 = Indicator.objects.create(name='Gamma Linked', code='WA_I3', type='number', created_by=cls.admin)

    # -- helpers ------------------------------------------------------------
    def _assign(self, indicator, organization, sort_order=None):
        pi, _ = ProjectIndicator.objects.get_or_create(project=self.project, indicator=indicator)
        meta = {'sort_order': sort_order} if sort_order is not None else {}
        ProjectIndicatorAssignment.objects.create(
            project_indicator=pi, organization=organization, is_active=True,
            assignment_metadata=meta,
        )
        return pi

    def _layout(self, *items, mode='live', name='L'):
        layout = WorkbookLayout.objects.create(
            coordinator_organization=self.coord, name=name, mode=mode, is_active=True,
            created_by=self.admin,
        )
        for idx, item in enumerate(items):
            if isinstance(item, str):
                WorkbookLayoutItem.objects.create(layout=layout, section_title=item, order_index=idx)
            else:
                WorkbookLayoutItem.objects.create(layout=layout, indicator=item, order_index=idx)
        return layout

    # -- 1: scope parity ----------------------------------------------------
    def test_coordinator_workbook_scope_equals_rollup_scope(self):
        rollup_scope = resolve_organization_scope_with_project_hierarchy(
            self.coord.id, project=self.project,
        )
        workbook_orgs = resolve_workbook_scope_organizations(self.coord, self.project)
        workbook_ids = {o.id for o in workbook_orgs}
        self.assertEqual(workbook_ids, set(rollup_scope))
        # The project hierarchy includes coord+child, never the global-only org.
        self.assertIn(self.coord.id, workbook_ids)
        self.assertIn(self.child.id, workbook_ids)
        self.assertNotIn(self.outside.id, workbook_ids)
        # Coordinator org sorts first.
        self.assertEqual(workbook_orgs[0].id, self.coord.id)

    # -- 2: layout controls order ------------------------------------------
    def test_layout_controls_indicator_order(self):
        layout = self._layout(self.i3, self.i1, self.i2)  # deliberate non-alpha order
        plans = [_plan(self.i1), _plan(self.i2), _plan(self.i3)]
        ordered = order_plans_by_layout(plans, layout)
        self.assertEqual([p.indicator.id for p in ordered], [self.i3.id, self.i1.id, self.i2.id])

    def test_layout_sections_applied(self):
        layout = self._layout('Testing', self.i1, 'Screening', self.i2)
        ordered = order_plans_by_layout([_plan(self.i1), _plan(self.i2)], layout)
        self.assertEqual(ordered[0].section, 'Testing')
        self.assertEqual(ordered[1].section, 'Screening')

    # -- 3: unplaced indicators warned -------------------------------------
    def test_unplaced_indicator_surfaces_warning(self):
        layout = self._layout(self.i1)  # i2 assigned but NOT in layout
        warnings = []
        ordered = order_plans_by_layout([_plan(self.i1), _plan(self.i2)], layout, warnings=warnings)
        leftover = [p for p in ordered if p.indicator.id == self.i2.id][0]
        self.assertEqual(leftover.section, UNORDERED_SECTION)
        self.assertTrue(any('Beta Screened' in w for w in warnings))

    # -- 4: deprecated redirect to canonical -------------------------------
    def test_deprecated_indicator_redirects_to_canonical_with_warning(self):
        dup = Indicator.objects.create(
            name='Alpha Reached (dup)', code='WA_I1_DUP', type='number',
            canonical_indicator=self.i1, is_deprecated=True, created_by=self.admin,
        )
        self._assign(dup, self.child)  # only the deprecated one is assigned
        warnings = []
        plans = AggregateViewSet()._build_indicator_plans(
            project=self.project, organization=self.child, quarter=1, warnings=warnings,
        )
        ids = [p.indicator.id for p in plans]
        self.assertIn(self.i1.id, ids)         # redirected to canonical
        self.assertNotIn(dup.id, ids)          # deprecated row not used
        self.assertTrue(any('deprecated' in w.lower() for w in warnings))

    def test_canonical_and_deprecated_both_assigned_dedupe(self):
        dup = Indicator.objects.create(
            name='Alpha Reached (dup)', code='WA_I1_DUP2', type='number',
            canonical_indicator=self.i1, is_deprecated=True, created_by=self.admin,
        )
        self._assign(self.i1, self.child)
        self._assign(dup, self.child)
        plans = AggregateViewSet()._build_indicator_plans(
            project=self.project, organization=self.child, quarter=1,
        )
        ids = [p.indicator.id for p in plans]
        self.assertEqual(ids.count(self.i1.id), 1)  # not duplicated

    # -- 5: snapshot preserves historical structure ------------------------
    def test_snapshot_preserves_past_period_structure(self):
        ps, pe = date(2026, 4, 1), date(2026, 6, 30)
        original = [_plan(self.i1), _plan(self.i2)]  # frozen order A, B
        snapshot, created = get_or_create_snapshot(
            project=self.project, organization=self.coord, kind='org', mode='live',
            period_start=ps, period_end=pe, period_label='Q1 2026/27',
            plans=original, layout=None, user=self.admin,
        )
        self.assertTrue(created)
        # A later layout edit reorders the live plans (B, A)…
        relaid = [_plan(self.i2), _plan(self.i1)]
        replayed = order_plans_by_snapshot(relaid, snapshot)
        # …but the snapshot restores the historical order A, B.
        self.assertEqual([p.indicator.id for p in replayed], [self.i1.id, self.i2.id])

    def test_snapshot_appends_new_indicator_with_warning(self):
        ps, pe = date(2026, 7, 1), date(2026, 9, 30)
        snapshot, _ = get_or_create_snapshot(
            project=self.project, organization=self.coord, kind='org', mode='live',
            period_start=ps, period_end=pe, period_label='Q2 2026/27',
            plans=[_plan(self.i1)], layout=None,
        )
        warnings = []
        replayed = order_plans_by_snapshot([_plan(self.i1), _plan(self.i3)], snapshot, warnings=warnings)
        self.assertEqual(replayed[0].indicator.id, self.i1.id)
        self.assertEqual(replayed[1].section, UNORDERED_SECTION)
        self.assertTrue(warnings)

    # -- 6: SESIGO import maps by indicator_id -----------------------------
    def test_sesigo_import_maps_by_indicator_id(self):
        plans = [_plan(self.i1), _plan(self.i2)]
        plans[0].existing_cells = {(rw.ALL_PRIMARY, rw.ALL_PRIMARY, rw.NO_BAND): 5}
        plans[1].existing_cells = {(rw.ALL_PRIMARY, rw.ALL_PRIMARY, rw.NO_BAND): 9}
        buf = rw.generate_workbook(
            project=self.project, organization=self.coord, quarter=1,
            fiscal_start_year=2026, indicator_plans=plans, with_data=True,
        )
        parsed = rw.parse_workbook(buf)
        by_id = {p.indicator_id: rw._to_number(p.value.get('total')) for p in parsed.indicators}
        self.assertEqual(by_id.get(self.i1.id), 5)
        self.assertEqual(by_id.get(self.i2.id), 9)

    # -- 7: fuzzy import refuses without confirmation -----------------------
    def test_fuzzy_import_requires_dry_run_confirmation(self):
        upload = Upload.objects.create(name='legacy.xlsx', created_by=self.admin)
        # Real write, no confirm, no prior dry-run → blocked.
        self.assertTrue(fuzzy_import_needs_confirmation(
            upload=upload, dry_run=False, confirm=False,
        ))
        # Explicit confirmation unblocks.
        self.assertFalse(fuzzy_import_needs_confirmation(
            upload=upload, dry_run=False, confirm=True,
        ))
        # A dry-run is never blocked.
        self.assertFalse(fuzzy_import_needs_confirmation(
            upload=upload, dry_run=True, confirm=False,
        ))
        # A prior validated dry-run unblocks a subsequent write.
        ImportJob.objects.create(
            upload=upload, job_type='aggregate_review_import', status='validated',
            parameters={'dry_run': True},
        )
        self.assertFalse(fuzzy_import_needs_confirmation(
            upload=upload, dry_run=False, confirm=False,
        ))

    # -- 8: live/training layout isolation ---------------------------------
    def test_live_and_training_layouts_isolated(self):
        self._layout(self.i1, self.i2, mode='live', name='Live L')
        self._layout(self.i2, self.i1, mode='training', name='Training L')
        live = get_active_layout(self.coord.id, mode='live')
        training = get_active_layout(self.coord.id, mode='training')
        self.assertEqual(live.mode, 'live')
        self.assertEqual(training.mode, 'training')
        self.assertNotEqual(live.id, training.id)
        self.assertEqual(
            [it.indicator_id for it in live.items.order_by('order_index')],
            [self.i1.id, self.i2.id],
        )
        self.assertEqual(
            [it.indicator_id for it in training.items.order_by('order_index')],
            [self.i2.id, self.i1.id],
        )
