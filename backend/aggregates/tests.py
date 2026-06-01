from datetime import date

from rest_framework import status
from rest_framework.test import APITestCase

from aggregates.models import Aggregate
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

    def test_non_admin_cannot_approve_aggregate(self):
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

        self.client.force_authenticate(self.officer)
        response = self.client.post(f'/api/aggregates/{aggregate.id}/approve/', {}, format='json')
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

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
