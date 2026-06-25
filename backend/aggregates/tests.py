from datetime import date

from django.test import SimpleTestCase
from rest_framework import serializers
from rest_framework import status
from rest_framework.test import APITestCase

from aggregates.models import Aggregate
from aggregates.validation import MAX_AGGREGATE_VALUE, validate_aggregate_value
from indicators.models import Indicator
from organizations.models import Organization
from projects.models import Project, ProjectIndicator, ProjectIndicatorAssignment
from users.models import User


class AggregateSecurityTests(APITestCase):
    def setUp(self):
        self.org_a = Organization.objects.create(name='Org A', code='ORG_A_AGG', type='district')
        self.org_b = Organization.objects.create(name='Org B', code='ORG_B_AGG', type='district')

        self.admin = User.objects.create_user(
            username='agg_admin',
            email='agg_admin@example.com',
            password='TestPass123!',
            role='admin',
            organization=self.org_a,
        )
        self.officer = User.objects.create_user(
            username='agg_officer',
            email='agg_officer@example.com',
            password='TestPass123!',
            role='officer',
            organization=self.org_a,
        )
        self.manager = User.objects.create_user(
            username='agg_manager',
            email='agg_manager@example.com',
            password='TestPass123!',
            role='manager',
            organization=self.org_a,
        )

        self.project = Project.objects.create(
            name='Scope Project',
            code='SCOPE-1',
            start_date=date(2026, 1, 1),
            end_date=date(2026, 12, 31),
            created_by=self.admin,
        )
        self.project.organizations.add(self.org_a)

        self.indicator = Indicator.objects.create(
            name='People reached',
            code='IND_SCOPE_1',
            type='number',
            category='hiv_prevention',
            created_by=self.admin,
        )

    def test_non_admin_cannot_create_aggregate_for_out_of_scope_organization(self):
        self.client.force_authenticate(self.officer)
        payload = {
            'indicator': self.indicator.id,
            'project': self.project.id,
            'organization': self.org_b.id,
            'period_start': '2026-01-01',
            'period_end': '2026-03-31',
            'value': {'total': 10},
            'notes': 'Out of scope attempt',
        }
        response = self.client.post('/api/aggregates/', payload, format='json')
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(Aggregate.objects.count(), 0)

    def _make_pending_aggregate(self, organization=None, **overrides):
        defaults = dict(
            indicator=self.indicator,
            project=self.project,
            organization=organization or self.org_a,
            period_start=date(2026, 1, 1),
            period_end=date(2026, 3, 31),
            value={'total': 5},
            status='pending',
            created_by=self.officer,
        )
        defaults.update(overrides)
        return Aggregate.objects.create(**defaults)

    def test_officer_cannot_approve_aggregate(self):
        aggregate = self._make_pending_aggregate(status='reviewed')

        self.client.force_authenticate(self.officer)
        response = self.client.post(f'/api/aggregates/{aggregate.id}/approve/', {}, format='json')
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        aggregate.refresh_from_db()
        self.assertEqual(aggregate.status, 'reviewed')

    def test_officer_can_mark_aggregate_reviewed_in_scope(self):
        aggregate = self._make_pending_aggregate()

        self.client.force_authenticate(self.officer)
        response = self.client.post(f'/api/aggregates/{aggregate.id}/review/', {}, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        aggregate.refresh_from_db()
        self.assertEqual(aggregate.status, 'reviewed')

    def test_officer_can_flag_aggregate_in_scope(self):
        aggregate = self._make_pending_aggregate()

        self.client.force_authenticate(self.officer)
        response = self.client.post(
            f'/api/aggregates/{aggregate.id}/flag/',
            {'reason': 'incorrect_data', 'description': 'looks off', 'severity': 'medium'},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        aggregate.refresh_from_db()
        self.assertEqual(aggregate.status, 'flagged')

    def test_officer_can_reject_aggregate_in_scope(self):
        aggregate = self._make_pending_aggregate(status='reviewed')

        self.client.force_authenticate(self.officer)
        response = self.client.post(f'/api/aggregates/{aggregate.id}/reject/', {}, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        aggregate.refresh_from_db()
        self.assertEqual(aggregate.status, 'rejected')

    def test_officer_cannot_unflag_to_approved(self):
        aggregate = self._make_pending_aggregate(status='flagged')

        self.client.force_authenticate(self.officer)
        response = self.client.post(f'/api/aggregates/{aggregate.id}/unflag/', {}, format='json')
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        aggregate.refresh_from_db()
        self.assertEqual(aggregate.status, 'flagged')

    def test_collector_cannot_mark_aggregate_reviewed(self):
        collector = User.objects.create_user(
            username='agg_collector',
            email='agg_collector@example.com',
            password='TestPass123!',
            role='collector',
            organization=self.org_a,
        )
        aggregate = self._make_pending_aggregate()

        self.client.force_authenticate(collector)
        response = self.client.post(f'/api/aggregates/{aggregate.id}/review/', {}, format='json')
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        aggregate.refresh_from_db()
        self.assertEqual(aggregate.status, 'pending')

    def test_manager_can_approve_aggregate_in_scope(self):
        aggregate = Aggregate.objects.create(
            indicator=self.indicator,
            project=self.project,
            organization=self.org_a,
            period_start=date(2026, 1, 1),
            period_end=date(2026, 3, 31),
            value={'total': 5},
            status='pending',
            created_by=self.officer,
        )

        self.client.force_authenticate(self.manager)
        response = self.client.post(f'/api/aggregates/{aggregate.id}/approve/', {}, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        aggregate.refresh_from_db()
        self.assertEqual(aggregate.status, 'approved')
        self.assertEqual(aggregate.reviewed_by_id, self.manager.id)

    def test_manager_cannot_approve_out_of_scope_aggregate(self):
        # org_b is not the manager's org nor a descendant of it.
        self.project.organizations.add(self.org_b)
        aggregate = Aggregate.objects.create(
            indicator=self.indicator,
            project=self.project,
            organization=self.org_b,
            period_start=date(2026, 1, 1),
            period_end=date(2026, 3, 31),
            value={'total': 5},
            status='pending',
            created_by=self.officer,
        )

        self.client.force_authenticate(self.manager)
        response = self.client.post(f'/api/aggregates/{aggregate.id}/approve/', {}, format='json')
        self.assertNotEqual(response.status_code, status.HTTP_200_OK)
        aggregate.refresh_from_db()
        self.assertEqual(aggregate.status, 'pending')

    def test_templates_project_plus_organization_returns_only_assigned_indicators(self):
        indicator_two = Indicator.objects.create(
            name='Second indicator',
            code='IND_SCOPE_2',
            type='number',
            category='hiv_prevention',
            created_by=self.admin,
        )
        project_indicator_one = ProjectIndicator.objects.create(
            project=self.project,
            indicator=self.indicator,
        )
        project_indicator_two = ProjectIndicator.objects.create(
            project=self.project,
            indicator=indicator_two,
        )
        self.project.organizations.add(self.org_b)

        ProjectIndicatorAssignment.objects.create(
            project_indicator=project_indicator_one,
            organization=self.org_a,
            assignment_source='manual',
            is_active=True,
        )
        ProjectIndicatorAssignment.objects.create(
            project_indicator=project_indicator_two,
            organization=self.org_b,
            assignment_source='manual',
            is_active=True,
        )

        self.client.force_authenticate(self.admin)
        response = self.client.get(
            f'/api/aggregates/templates/?project={self.project.id}&organization={self.org_a.id}'
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        payload = response.json()
        self.assertEqual(len(payload), 1)
        indicator_ids = {row['id'] for row in payload[0]['indicators']}
        self.assertEqual(indicator_ids, {self.indicator.id})

    def test_create_aggregate_rejects_indicator_not_assigned_to_project_org(self):
        indicator_two = Indicator.objects.create(
            name='Second indicator',
            code='IND_SCOPE_3',
            type='number',
            category='hiv_prevention',
            created_by=self.admin,
        )
        project_indicator_one = ProjectIndicator.objects.create(
            project=self.project,
            indicator=self.indicator,
        )
        project_indicator_two = ProjectIndicator.objects.create(
            project=self.project,
            indicator=indicator_two,
        )

        ProjectIndicatorAssignment.objects.create(
            project_indicator=project_indicator_one,
            organization=self.org_a,
            assignment_source='manual',
            is_active=True,
        )
        # indicator_two is not assigned to org_a on purpose.
        ProjectIndicatorAssignment.objects.create(
            project_indicator=project_indicator_two,
            organization=self.org_b,
            assignment_source='manual',
            is_active=True,
        )

        self.client.force_authenticate(self.admin)
        response = self.client.post(
            '/api/aggregates/',
            {
                'indicator': indicator_two.id,
                'project': self.project.id,
                'organization': self.org_a.id,
                'period_start': '2026-01-01',
                'period_end': '2026-03-31',
                'value': {'total': 10},
            },
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)


class _FakeIndicator:
    """Lightweight stand-in so value validation can be unit-tested off the DB."""

    def __init__(self, type='number'):
        self.type = type


class AggregateValueValidationUnitTests(SimpleTestCase):
    """Pure-unit coverage of the aggregate value validator (blocker C4 / R1)."""

    def test_accepts_bare_number(self):
        self.assertEqual(validate_aggregate_value(10), 10)

    def test_normalises_whole_float_to_int(self):
        self.assertEqual(validate_aggregate_value(10.0), 10)

    def test_parses_numeric_string(self):
        self.assertEqual(validate_aggregate_value('1,234'), 1234)

    def test_accepts_breakdown_mapping(self):
        value = {'total': 10, 'male': 3, 'female': 7}
        self.assertEqual(validate_aggregate_value(value), value)

    def test_accepts_nested_disaggregates(self):
        value = {'disaggregates': {'All': {'Male': {'18-24': 3}, 'Female': {'18-24': 7}}}}
        self.assertEqual(validate_aggregate_value(value), value)

    def test_accepts_zero(self):
        self.assertEqual(validate_aggregate_value({'total': 0}), {'total': 0})

    def test_rejects_none(self):
        with self.assertRaises(serializers.ValidationError):
            validate_aggregate_value(None)

    def test_rejects_empty_mapping(self):
        with self.assertRaises(serializers.ValidationError):
            validate_aggregate_value({})

    def test_rejects_negative(self):
        with self.assertRaises(serializers.ValidationError):
            validate_aggregate_value({'total': -5})

    def test_rejects_negative_nested_leaf(self):
        with self.assertRaises(serializers.ValidationError):
            validate_aggregate_value({'disaggregates': {'All': {'Male': {'18-24': -1}}}})

    def test_rejects_non_numeric_string(self):
        with self.assertRaises(serializers.ValidationError):
            validate_aggregate_value({'total': 'abc'})

    def test_rejects_boolean(self):
        with self.assertRaises(serializers.ValidationError):
            validate_aggregate_value(True)

    def test_rejects_list(self):
        with self.assertRaises(serializers.ValidationError):
            validate_aggregate_value([1, 2, 3])

    def test_rejects_overflow(self):
        with self.assertRaises(serializers.ValidationError):
            validate_aggregate_value(MAX_AGGREGATE_VALUE + 1)

    def test_percentage_indicator_resolves_as_value_not_capped_at_100(self):
        # Percentage indicators store disaggregated COUNTS (the numerator); the %
        # is computed downstream. So count values > 100 are now accepted.
        value = {'total': 150}
        self.assertEqual(
            validate_aggregate_value(value, indicator=_FakeIndicator('percentage')),
            value,
        )

    def test_percentage_indicator_accepts_within_range(self):
        value = {'total': 87}
        self.assertEqual(
            validate_aggregate_value(value, indicator=_FakeIndicator('percentage')),
            value,
        )


class AggregateValueValidationApiTests(APITestCase):
    """End-to-end: malformed values are rejected at the API boundary."""

    def setUp(self):
        self.org = Organization.objects.create(name='Val Org', code='ORG_VAL', type='district')
        self.admin = User.objects.create_user(
            username='val_admin',
            email='val_admin@example.com',
            password='TestPass123!',
            role='admin',
            organization=self.org,
        )
        self.project = Project.objects.create(
            name='Val Project',
            code='VAL-1',
            start_date=date(2026, 1, 1),
            end_date=date(2026, 12, 31),
            created_by=self.admin,
        )
        self.project.organizations.add(self.org)
        self.indicator = Indicator.objects.create(
            name='Reached',
            code='IND_VAL_1',
            type='number',
            category='hiv_prevention',
            created_by=self.admin,
        )
        self.project_indicator = ProjectIndicator.objects.create(
            project=self.project,
            indicator=self.indicator,
        )
        ProjectIndicatorAssignment.objects.create(
            project_indicator=self.project_indicator,
            organization=self.org,
            assignment_source='manual',
            is_active=True,
        )
        self.client.force_authenticate(self.admin)

    def _payload(self, **overrides):
        payload = {
            'indicator': self.indicator.id,
            'project': self.project.id,
            'organization': self.org.id,
            'period_start': '2026-01-01',
            'period_end': '2026-03-31',
            'value': {'total': 10},
        }
        payload.update(overrides)
        return payload

    def test_valid_aggregate_is_created(self):
        response = self.client.post('/api/aggregates/', self._payload(), format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        self.assertEqual(Aggregate.objects.count(), 1)

    def test_negative_value_rejected(self):
        response = self.client.post(
            '/api/aggregates/', self._payload(value={'total': -5}), format='json'
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(Aggregate.objects.count(), 0)

    def test_non_numeric_value_rejected(self):
        response = self.client.post(
            '/api/aggregates/', self._payload(value={'total': 'lots'}), format='json'
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(Aggregate.objects.count(), 0)

    def test_reversed_reporting_period_rejected(self):
        response = self.client.post(
            '/api/aggregates/',
            self._payload(period_start='2026-03-31', period_end='2026-01-01'),
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(Aggregate.objects.count(), 0)
