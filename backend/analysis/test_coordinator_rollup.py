from datetime import date

from django.test import TestCase

from aggregates.models import Aggregate
from analysis.coordinator_rollup import (
    aggregate_total,
    compute_target_actuals,
    fiscal_quarter_range,
    performance_status,
)
from indicators.models import Indicator
from organizations.models import Organization
from projects.models import Project
from users.models import User


class _StubTarget:
    """Duck-typed stand-in for the unmanaged CoordinatorTarget row (no DB table
    in tests). The rollup helper only reads attributes, never queries it."""

    def __init__(self, *, id, coordinator, project, indicator, year, quarter, target_value):
        self.id = id
        self.coordinator_id = coordinator.id
        self.project_id = project.id
        self.indicator = indicator
        self.indicator_id = indicator.id
        self.year = year
        self.quarter = quarter
        self.target_value = target_value


class FiscalAndTotalHelpersTests(TestCase):
    def test_fiscal_quarter_ranges(self):
        self.assertEqual(fiscal_quarter_range(2026, 'Q1'), (date(2026, 4, 1), date(2026, 6, 30)))
        self.assertEqual(fiscal_quarter_range(2026, 'Q2'), (date(2026, 7, 1), date(2026, 9, 30)))
        self.assertEqual(fiscal_quarter_range(2026, 'Q3'), (date(2026, 10, 1), date(2026, 12, 31)))
        self.assertEqual(fiscal_quarter_range(2026, 'Q4'), (date(2027, 1, 1), date(2027, 3, 31)))

    def test_aggregate_total_variants(self):
        self.assertEqual(aggregate_total(10), 10.0)
        self.assertEqual(aggregate_total({'total': 25}), 25.0)
        self.assertEqual(aggregate_total({'male': 3, 'female': 7}), 10.0)
        self.assertEqual(aggregate_total({'total': 0, 'male': 4, 'female': 6}), 10.0)
        self.assertEqual(aggregate_total({'disaggregates': {'All': {'Male': {'18-24': 5}}}}), 5.0)
        self.assertEqual(aggregate_total(True), 0.0)
        self.assertEqual(aggregate_total(None), 0.0)

    def test_performance_status_thresholds(self):
        self.assertEqual(performance_status(0, None), 'no_target')
        self.assertEqual(performance_status(100, None), 'no_target')
        self.assertEqual(performance_status(100, 100), 'met')
        self.assertEqual(performance_status(100, 80), 'on_track')
        self.assertEqual(performance_status(100, 79.9), 'behind')


class CoordinatorRollupTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.coord = Organization.objects.create(name='Coord', code='RU_COORD', type='district')
        cls.child = Organization.objects.create(name='Child', code='RU_CHILD', type='cso', parent=cls.coord)
        cls.unrelated = Organization.objects.create(name='Outside', code='RU_OUT', type='cso')
        cls.admin = User.objects.create_user(
            username='ru_admin', email='ru_admin@example.com',
            password='TestPass123!', role='admin', organization=cls.coord,
        )
        cls.project = Project.objects.create(
            name='Rollup Project', code='RU-1',
            start_date=date(2026, 1, 1), end_date=date(2027, 12, 31), created_by=cls.admin,
        )
        cls.project.organizations.add(cls.coord, cls.child)
        cls.indicator = Indicator.objects.create(
            name='Reached', code='RU_IND', type='number', category='hiv_prevention', created_by=cls.admin,
        )

    def _agg(self, organization, total, *, status='approved', start=date(2026, 4, 1), end=date(2026, 6, 30)):
        return Aggregate.objects.create(
            indicator=self.indicator, project=self.project, organization=organization,
            period_start=start, period_end=end, value={'total': total},
            status=status, created_by=self.admin,
        )

    def _target(self, target_value=200):
        return _StubTarget(
            id=1, coordinator=self.coord, project=self.project, indicator=self.indicator,
            year=2026, quarter='Q1', target_value=target_value,
        )

    def test_rollup_sums_own_and_child_over_subtree(self):
        self._agg(self.coord, 100)
        self._agg(self.child, 40)
        result = compute_target_actuals([self._target(target_value=200)])[1]
        self.assertEqual(result['actual_value'], 140.0)
        self.assertEqual(result['own_actual_value'], 100.0)
        self.assertAlmostEqual(result['achievement_percent'], 70.0)
        self.assertEqual(result['variance'], -60.0)
        self.assertEqual(result['performance_status'], 'behind')
        self.assertEqual(len(result['child_contributions']), 1)
        self.assertEqual(result['child_contributions'][0]['organization_id'], self.child.id)
        self.assertEqual(result['child_contributions'][0]['actual_value'], 40.0)
        self.assertAlmostEqual(result['child_contributions'][0]['share_percent'], 40 / 140 * 100)

    def test_excludes_non_approved(self):
        self._agg(self.coord, 100)
        self._agg(self.child, 40, status='pending')
        result = compute_target_actuals([self._target()])[1]
        self.assertEqual(result['actual_value'], 100.0)
        self.assertEqual(result['child_contributions'], [])

    def test_excludes_out_of_quarter(self):
        self._agg(self.coord, 100)
        # Q3 period — must not count toward a Q1 target.
        self._agg(self.coord, 999, start=date(2026, 10, 1), end=date(2026, 12, 31))
        result = compute_target_actuals([self._target()])[1]
        self.assertEqual(result['actual_value'], 100.0)

    def test_excludes_out_of_scope_org(self):
        self._agg(self.coord, 100)
        self._agg(self.unrelated, 500)
        result = compute_target_actuals([self._target()])[1]
        self.assertEqual(result['actual_value'], 100.0)

    def test_met_status(self):
        self._agg(self.coord, 150)
        self._agg(self.child, 60)
        result = compute_target_actuals([self._target(target_value=200)])[1]
        self.assertEqual(result['actual_value'], 210.0)
        self.assertEqual(result['performance_status'], 'met')
