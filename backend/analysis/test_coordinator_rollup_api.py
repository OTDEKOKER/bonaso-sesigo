"""End-to-end certification tests for the coordinator rollup (readiness R3).

Covers the full server-side path the frontend now depends on:
  * the certified service engine (hierarchy, nested hierarchy, project override),
  * the list/retrieve API returning fully computed records,
  * export <-> dashboard value consistency (same engine),
  * audit coverage for create / update / delete / bulk-assign / export,
  * regression: project scoping, organization permissions, training isolation,
  * a query-count guard proving there is no N+1 as targets grow.

CoordinatorTarget is an unmanaged model (its table is owned by an external
migration), so the table is materialised once per test database via the schema
editor before these tests run.
"""
from __future__ import annotations

import csv
import io
from datetime import date

from django.db import connection
from django.test import TestCase
from rest_framework.test import APIClient

from aggregates.models import Aggregate
from audit.models import AuditEvent
from analysis.models import CoordinatorTarget
from analysis.services.coordinator_rollups import (
    compute_target_actuals,
    get_coordinator_actuals,
    get_coordinator_performance,
    get_coordinator_targets,
)
from indicators.models import Indicator
from organizations.models import Organization
from projects.models import Project
from users.models import User


class CoordinatorTargetTableMixin:
    """Materialise the unmanaged ``analysis_coordinatortarget`` table once."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        if CoordinatorTarget._meta.db_table not in connection.introspection.table_names():
            with connection.schema_editor() as schema_editor:
                schema_editor.create_model(CoordinatorTarget)


class CoordinatorRollupServiceTests(CoordinatorTargetTableMixin, TestCase):
    """Engine-level certification (hierarchy + status + named API)."""

    @classmethod
    def setUpTestData(cls):
        cls.admin = User.objects.create_user(
            username='svc_admin', email='svc_admin@example.com',
            password='TestPass123!', role='admin',
        )
        cls.coord = Organization.objects.create(name='Coord', code='SV_COORD', type='coordinator')
        cls.child = Organization.objects.create(name='Child', code='SV_CHILD', type='subgrantee', parent=cls.coord)
        cls.grandchild = Organization.objects.create(name='Grandchild', code='SV_GC', type='subgrantee', parent=cls.child)
        cls.outside = Organization.objects.create(name='Outside', code='SV_OUT', type='subgrantee')

        cls.project = Project.objects.create(
            name='Svc Project', code='SV-1',
            start_date=date(2026, 1, 1), end_date=date(2027, 12, 31), created_by=cls.admin,
        )
        cls.project.organizations.add(cls.coord, cls.child, cls.grandchild)

        cls.indicator = Indicator.objects.create(
            name='Reached', code='SV_IND', type='number', category='hiv_prevention', created_by=cls.admin,
        )

    def _agg(self, organization, total, *, start=date(2026, 4, 1), end=date(2026, 6, 30), status='approved'):
        return Aggregate.objects.create(
            indicator=self.indicator, project=self.project, organization=organization,
            period_start=start, period_end=end, value={'total': total},
            status=status, created_by=self.admin,
        )

    def _target(self, *, coordinator=None, target_value=200, quarter='Q1', year=2026):
        return CoordinatorTarget.objects.create(
            project=self.project, coordinator=coordinator or self.coord, indicator=self.indicator,
            year=year, quarter=quarter, target_value=target_value,
        )

    def test_nested_hierarchy_rolls_up_own_child_grandchild(self):
        self._agg(self.coord, 100)
        self._agg(self.child, 40)
        self._agg(self.grandchild, 10)
        self._agg(self.outside, 999)  # out of scope
        target = self._target(target_value=200)

        payload = get_coordinator_performance([target])[target.id]
        self.assertEqual(payload['actual_value'], 150.0)
        self.assertEqual(payload['own_contribution'], 100.0)
        self.assertEqual(payload['subgrantee_contribution'], 50.0)
        self.assertEqual(payload['own_contribution'] + payload['subgrantee_contribution'], payload['actual_value'])
        self.assertAlmostEqual(payload['achievement_percent'], 75.0)
        self.assertEqual({c['organization_id'] for c in payload['child_contributions']},
                         {self.child.id, self.grandchild.id})

    def test_project_override_hierarchy(self):
        # ``extra`` is NOT a global descendant of coord; only the project override
        # links it. The engine must honour the project hierarchy.
        extra = Organization.objects.create(name='Extra', code='SV_EXTRA', type='subgrantee')
        self.project.organizations.add(extra)
        self.project.hierarchy_overrides = {str(self.coord.id): [str(extra.id)]}
        self.project.save(update_fields=['hierarchy_overrides'])

        self._agg(self.coord, 100)
        self._agg(extra, 25)
        target = self._target(target_value=200)

        payload = get_coordinator_performance([target])[target.id]
        self.assertEqual(payload['actual_value'], 125.0)
        self.assertEqual(payload['subgrantee_contribution'], 25.0)

    def test_status_thresholds(self):
        cases = [
            (100, 'met'),     # >=100%
            (85, 'on_track'),  # >=80%
            (50, 'behind'),    # <80%
        ]
        for total, expected in cases:
            with self.subTest(expected=expected):
                Aggregate.objects.all().delete()
                self._agg(self.coord, total)
                target = self._target(target_value=100, quarter='Q1')
                payload = get_coordinator_performance([target])[target.id]
                self.assertEqual(payload['performance_status'], expected)
                target.delete()

    def test_no_target_status(self):
        self._agg(self.coord, 50)
        target = self._target(target_value=0)
        payload = get_coordinator_performance([target])[target.id]
        self.assertEqual(payload['performance_status'], 'no_target')
        self.assertIsNone(payload['achievement_percent'])

    def test_named_api_wrappers(self):
        self._agg(self.coord, 120)
        target = self._target(target_value=100)
        self.assertEqual(get_coordinator_actuals([target])[target.id], {'actual': 120.0})
        self.assertEqual(get_coordinator_targets([target])[target.id], {'target': 100.0})
        self.assertEqual(compute_target_actuals([target])[target.id]['actual_value'], 120.0)


class CoordinatorTargetApiTests(CoordinatorTargetTableMixin, TestCase):
    """API + export + audit + permission/training regression."""

    @classmethod
    def setUpTestData(cls):
        cls.admin = User.objects.create_user(
            username='api_admin', email='api_admin@example.com',
            password='TestPass123!', role='admin',
        )
        cls.coord = Organization.objects.create(name='Coord', code='API_COORD', type='coordinator')
        cls.child = Organization.objects.create(name='Child', code='API_CHILD', type='subgrantee', parent=cls.coord)
        cls.other_coord = Organization.objects.create(name='OtherCoord', code='API_OTHER', type='coordinator')

        cls.coord_user = User.objects.create_user(
            username='api_coord_user', email='api_coord@example.com',
            password='TestPass123!', role='meofficer', organization=cls.coord,
        )

        cls.project = Project.objects.create(
            name='API Project', code='API-1',
            start_date=date(2026, 1, 1), end_date=date(2027, 12, 31), created_by=cls.admin,
        )
        cls.project.organizations.add(cls.coord, cls.child, cls.other_coord)

        cls.training_project = Project.objects.create(
            name='Training Project', code='API-TR', is_training=True,
            start_date=date(2026, 1, 1), end_date=date(2027, 12, 31), created_by=cls.admin,
        )
        cls.training_project.organizations.add(cls.coord)

        cls.indicator = Indicator.objects.create(
            name='Reached', code='API_IND', type='number', category='hiv_prevention', created_by=cls.admin,
        )

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    def _agg(self, organization, total, *, project=None, status='approved',
             start=date(2026, 4, 1), end=date(2026, 6, 30)):
        return Aggregate.objects.create(
            indicator=self.indicator, project=project or self.project, organization=organization,
            period_start=start, period_end=end, value={'total': total},
            status=status, created_by=self.admin,
        )

    def _target(self, *, coordinator=None, project=None, target_value=200, quarter='Q1', year=2026):
        return CoordinatorTarget.objects.create(
            project=project or self.project, coordinator=coordinator or self.coord, indicator=self.indicator,
            year=year, quarter=quarter, target_value=target_value,
        )

    def test_list_returns_server_computed_values(self):
        self._agg(self.coord, 100)
        self._agg(self.child, 40)
        target = self._target(target_value=200)

        resp = self.client.get('/api/analysis/coordinator-targets/')
        self.assertEqual(resp.status_code, 200)
        row = next(r for r in resp.data['results'] if r['id'] == target.id)
        self.assertEqual(row['actual_value'], 140.0)
        self.assertEqual(row['own_contribution'], 100.0)
        self.assertEqual(row['subgrantee_contribution'], 40.0)
        self.assertAlmostEqual(row['achievement_percent'], 70.0)
        self.assertEqual(row['performance_status'], 'behind')

    def test_export_matches_list_values(self):
        self._agg(self.coord, 150)
        self._agg(self.child, 60)
        target = self._target(target_value=200)

        list_resp = self.client.get('/api/analysis/coordinator-targets/')
        list_row = next(r for r in list_resp.data['results'] if r['id'] == target.id)

        export_resp = self.client.get('/api/analysis/coordinator-targets/export/')
        self.assertEqual(export_resp.status_code, 200)
        self.assertEqual(export_resp['Content-Type'], 'text/csv')
        rows = list(csv.DictReader(io.StringIO(export_resp.content.decode('utf-8'))))
        export_row = next(r for r in rows if r['coordinator'] == self.coord.name)

        # The exported file and the dashboard payload come from the same engine.
        self.assertEqual(float(export_row['actual_value']), list_row['actual_value'])
        self.assertEqual(float(export_row['own_contribution']), list_row['own_contribution'])
        self.assertEqual(float(export_row['subgrantee_contribution']), list_row['subgrantee_contribution'])
        self.assertEqual(float(export_row['achievement_percent']), round(list_row['achievement_percent'], 2))
        self.assertEqual(export_row['performance_status'], list_row['performance_status'])

    def test_audit_on_create_update_delete(self):
        payload = {
            'project_id': self.project.id, 'coordinator_id': self.coord.id,
            'indicator_id': self.indicator.id, 'year': 2026, 'quarter': 'Q2', 'target_value': 500,
        }
        create_resp = self.client.post('/api/analysis/coordinator-targets/', payload, format='json')
        self.assertEqual(create_resp.status_code, 201)
        target_id = create_resp.data['id']
        self.assertTrue(AuditEvent.objects.filter(
            action='create', object_type='coordinator_target', object_id=str(target_id)).exists())

        self.client.patch(f'/api/analysis/coordinator-targets/{target_id}/', {'target_value': 600}, format='json')
        self.assertTrue(AuditEvent.objects.filter(
            action='update', object_type='coordinator_target', object_id=str(target_id)).exists())

        self.client.delete(f'/api/analysis/coordinator-targets/{target_id}/')
        self.assertTrue(AuditEvent.objects.filter(
            action='delete', object_type='coordinator_target', object_id=str(target_id)).exists())

    def test_audit_on_bulk_assign_and_export(self):
        self.client.post('/api/analysis/coordinator-targets/bulk-assign/', {
            'project_id': self.project.id, 'coordinator_ids': [self.coord.id],
            'indicator_ids': [self.indicator.id], 'year': 2026, 'quarter': 'Q3', 'target_value': 10,
        }, format='json')
        self.assertTrue(AuditEvent.objects.filter(action='assign', object_type='coordinator_target').exists())

        self._target()
        self.client.get('/api/analysis/coordinator-targets/export/')
        self.assertTrue(AuditEvent.objects.filter(action='export', object_type='coordinator_target').exists())

    def test_training_isolation(self):
        live_target = self._target(project=self.project, quarter='Q1')
        training_target = self._target(project=self.training_project, quarter='Q2')

        live_resp = self.client.get('/api/analysis/coordinator-targets/')
        ids = {r['id'] for r in live_resp.data['results']}
        self.assertIn(live_target.id, ids)
        self.assertNotIn(training_target.id, ids)

        training_resp = self.client.get('/api/analysis/coordinator-targets/', {'mode': 'training'})
        training_ids = {r['id'] for r in training_resp.data['results']}
        self.assertIn(training_target.id, training_ids)

    def test_org_permissions_scope_non_admin(self):
        # A non-admin sees targets within projects their org participates in
        # (incl. project-mate coordinators), but NOT targets in projects their
        # org is not part of.
        own = self._target(coordinator=self.coord)
        other_project = Project.objects.create(
            name='Other Project', code='API-2',
            start_date=date(2026, 1, 1), end_date=date(2027, 12, 31), created_by=self.admin,
        )
        other_project.organizations.add(self.other_coord)
        foreign = self._target(coordinator=self.other_coord, project=other_project)

        self.client.force_authenticate(self.coord_user)
        resp = self.client.get('/api/analysis/coordinator-targets/')
        ids = {r['id'] for r in resp.data['results']}
        self.assertIn(own.id, ids)
        self.assertNotIn(foreign.id, ids)

    def test_write_permission_denied_for_foreign_coordinator(self):
        # Write scoping is the hard org boundary: a coordinator-org user cannot
        # create targets for a coordinator outside their org.
        self.client.force_authenticate(self.coord_user)
        resp = self.client.post('/api/analysis/coordinator-targets/', {
            'project_id': self.project.id, 'coordinator_id': self.other_coord.id,
            'indicator_id': self.indicator.id, 'year': 2026, 'quarter': 'Q1', 'target_value': 100,
        }, format='json')
        self.assertEqual(resp.status_code, 403)

    def test_no_n_plus_one_as_targets_grow(self):
        # The query count must be bounded by the number of distinct
        # (coordinator, project) scopes — NOT by the number of targets. We prove
        # this by doubling the target count for the *same* scopes and asserting
        # the query count is unchanged.
        from django.test.utils import CaptureQueriesContext

        self._agg(self.coord, 100)
        self._agg(self.child, 50)

        def query_count_for(quarters):
            CoordinatorTarget.objects.all().delete()
            for quarter in quarters:
                self._target(coordinator=self.coord, quarter=quarter)
                self._target(coordinator=self.other_coord, quarter=quarter)
            targets = list(
                CoordinatorTarget.objects.select_related('project', 'coordinator', 'indicator').all()
            )
            with CaptureQueriesContext(connection) as ctx:
                get_coordinator_performance(targets)
            return len(ctx.captured_queries)

        small = query_count_for(('Q1', 'Q2'))          # 4 targets, 2 scopes
        large = query_count_for(('Q1', 'Q2', 'Q3', 'Q4'))  # 8 targets, 2 scopes
        self.assertEqual(small, large)
