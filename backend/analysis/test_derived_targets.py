"""Tests for dynamic (derived) indicator targets — the enhancement must add the
new modes while leaving fixed targets byte-for-byte identical."""

from datetime import date

from django.test import TestCase
from rest_framework import serializers as drf_serializers

from aggregates.models import Aggregate
from analysis.coordinator_rollup import compute_target_actuals
from analysis.services.target_dependencies import assert_valid_target_source
from indicators.models import Indicator
from organizations.models import Organization
from projects.models import (
    Project, ProjectIndicator, ProjectIndicatorOrganizationTarget,
)
from users.models import User


class _StubTarget:
    def __init__(self, *, id, coordinator, project, indicator, year, quarter, target_value):
        self.id = id
        self.coordinator_id = coordinator.id
        self.project_id = project.id
        self.indicator = indicator
        self.indicator_id = indicator.id
        self.year = year
        self.quarter = quarter
        self.target_value = target_value


class DerivedTargetTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.coord = Organization.objects.create(name='Coord', code='DT_COORD', type='district')
        cls.child = Organization.objects.create(name='Child', code='DT_CHILD', type='cso', parent=cls.coord)
        cls.admin = User.objects.create_user(
            username='dt_admin', email='dt_admin@example.com', password='TestPass123!',
            role='admin', organization=cls.coord,
        )
        cls.project = Project.objects.create(
            name='Derived Project', code='DT-1',
            start_date=date(2026, 1, 1), end_date=date(2027, 12, 31), created_by=cls.admin,
        )
        cls.project.organizations.add(cls.coord, cls.child)
        cls.eligible = Indicator.objects.create(
            name='Eligible for PrEP', code='DT_ELIG', type='number',
            category='hiv_prevention', created_by=cls.admin)
        cls.referred = Indicator.objects.create(
            name='Referred for PrEP', code='DT_REF', type='number',
            category='hiv_prevention', created_by=cls.admin)

    def _agg(self, indicator, organization, total):
        return Aggregate.objects.create(
            indicator=indicator, project=self.project, organization=organization,
            period_start=date(2026, 4, 1), period_end=date(2026, 6, 30),
            value={'total': total}, status='approved', created_by=self.admin)

    def _target_for_referred(self, target_value=999):
        return _StubTarget(id=1, coordinator=self.coord, project=self.project,
                           indicator=self.referred, year=2026, quarter='Q1', target_value=target_value)

    def _pi(self, **kw):
        return ProjectIndicator.objects.create(project=self.project, indicator=self.referred, **kw)

    # --- fixed unchanged --------------------------------------------------
    def test_fixed_target_unchanged(self):
        self._agg(self.referred, self.coord, 60)
        res = compute_target_actuals([self._target_for_referred(target_value=200)])[1]
        self.assertEqual(res['target_value'], 200.0)
        self.assertEqual(res['actual_value'], 60.0)
        self.assertEqual(res['achievement_percent'], 30.0)
        self.assertEqual(res['performance_status'], 'behind')
        self.assertIsNone(res['target_source'])
        self.assertFalse(res['target_pending'])

    # --- derived = source achieved ---------------------------------------
    def test_derived_target_equals_source_achieved(self):
        self._agg(self.eligible, self.coord, 100)
        self._agg(self.eligible, self.child, 50)   # source achieved = 150
        self._agg(self.referred, self.coord, 60)   # this indicator achieved = 60
        self._pi(target_source_type='derived', target_source_indicator=self.eligible)
        res = compute_target_actuals([self._target_for_referred()])[1]
        self.assertEqual(res['target_value'], 150.0)
        self.assertEqual(res['actual_value'], 60.0)
        self.assertEqual(res['achievement_percent'], 40.0)
        self.assertEqual(res['target_source']['type'], 'derived')
        self.assertEqual(res['target_source']['source_indicator_id'], self.eligible.id)

    # --- percentage of source achieved -----------------------------------
    def test_percentage_target(self):
        self._agg(self.eligible, self.coord, 100)
        self._agg(self.eligible, self.child, 50)   # source achieved = 150
        self._agg(self.referred, self.coord, 60)
        self._pi(target_source_type='percentage', target_source_indicator=self.eligible,
                 target_source_percentage=95)
        res = compute_target_actuals([self._target_for_referred()])[1]
        self.assertEqual(res['target_value'], 142.5)   # 150 * 95%
        self.assertAlmostEqual(res['achievement_percent'], 60 / 142.5 * 100)

    # --- pending when source not reported --------------------------------
    def test_pending_when_source_unreported(self):
        self._agg(self.referred, self.coord, 60)   # source has no aggregates
        self._pi(target_source_type='derived', target_source_indicator=self.eligible)
        res = compute_target_actuals([self._target_for_referred()])[1]
        self.assertIsNone(res['target_value'])
        self.assertTrue(res['target_pending'])
        self.assertEqual(res['performance_status'], 'pending')
        self.assertIsNone(res['achievement_percent'])

    # --- reported 0 is NOT pending ---------------------------------------
    def test_reported_zero_source_is_not_pending(self):
        self._agg(self.eligible, self.coord, 0)    # source reported, value 0
        self._agg(self.referred, self.coord, 60)
        self._pi(target_source_type='derived', target_source_indicator=self.eligible)
        res = compute_target_actuals([self._target_for_referred()])[1]
        self.assertEqual(res['target_value'], 0.0)
        self.assertFalse(res['target_pending'])

    # --- per-coordinator POT override beats project default --------------
    def test_pot_override_precedence(self):
        self._agg(self.eligible, self.coord, 100)
        self._agg(self.referred, self.coord, 60)
        pi = self._pi(target_source_type='fixed')  # project default = fixed
        ProjectIndicatorOrganizationTarget.objects.create(
            project_indicator=pi, organization=self.coord,
            target_source_type='derived', target_source_indicator=self.eligible)
        res = compute_target_actuals([self._target_for_referred(target_value=777)])[1]
        self.assertEqual(res['target_value'], 100.0)  # override -> derived, not 777

    # --- cycle / self-loop validation ------------------------------------
    def test_self_loop_rejected(self):
        with self.assertRaises(drf_serializers.ValidationError):
            assert_valid_target_source(self.project.id, self.referred.id, self.referred.id, 'derived')

    def test_cycle_rejected(self):
        # Existing edge referred -> eligible; adding eligible -> referred closes A->B->A.
        self._pi(target_source_type='derived', target_source_indicator=self.eligible)
        with self.assertRaises(drf_serializers.ValidationError):
            assert_valid_target_source(self.project.id, self.eligible.id, self.referred.id, 'derived')

    def test_valid_source_accepted(self):
        assert_valid_target_source(self.project.id, self.referred.id, self.eligible.id, 'derived')

    # --- dashboard trend endpoint uses the Effective Target -----------------
    def test_bulk_trend_uses_effective_target(self):
        from rest_framework.test import APIClient
        self._agg(self.eligible, self.coord, 100)   # source achieved (Q1 2026) = 100
        self._agg(self.referred, self.coord, 60)     # this indicator achieved = 60
        self._pi(target_source_type='percentage', target_source_indicator=self.eligible,
                 target_source_percentage=95)
        client = APIClient()
        client.force_authenticate(self.admin)
        resp = client.get('/api/analysis/trends/', {
            'indicator_ids': str(self.referred.id),
            'project': str(self.project.id),
            'coordinator': str(self.coord.id),
            'date_from': '2026-04-01', 'date_to': '2026-06-30',
        })
        self.assertEqual(resp.status_code, 200)
        series = resp.json()['series'][0]
        # Effective target = 100 * 95% = 95, anchored on the quarter's first month.
        self.assertEqual(sum(d['target'] for d in series['data']), 95.0)
        self.assertEqual(sum(d['value'] for d in series['data']), 60.0)
