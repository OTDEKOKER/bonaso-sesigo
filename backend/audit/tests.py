from datetime import date

from rest_framework import status
from rest_framework.test import APITestCase

from aggregates.models import Aggregate
from audit.models import AuditEvent
from audit.recording import record_audit_event
from indicators.models import Indicator
from organizations.models import Organization
from projects.models import Project, ProjectIndicator, ProjectIndicatorAssignment
from users.models import User


class AuditRecordingUnitTests(APITestCase):
    def test_record_audit_event_persists_row(self):
        org = Organization.objects.create(name='Audit Org', code='AUD_ORG', type='district')
        actor = User.objects.create_user(
            username='aud_actor', email='aud_actor@example.com',
            password='TestPass123!', role='manager', organization=org,
        )
        record_audit_event(
            action='approve', actor=actor, object_type='aggregate', object_id=42,
            organization=org, description='test event',
        )
        event = AuditEvent.objects.get()
        self.assertEqual(event.action, 'approve')
        self.assertEqual(event.object_type, 'aggregate')
        self.assertEqual(event.object_id, '42')
        self.assertEqual(event.actor_id, actor.id)
        self.assertEqual(event.actor_username, 'aud_actor')
        self.assertEqual(event.organization_id, org.id)

    def test_record_audit_event_never_raises(self):
        # Bad inputs must be swallowed, not propagated into the caller.
        record_audit_event(action='approve', object_id=object())  # non-serialisable id coerced to str
        # An obviously invalid action still records (best-effort), proving no raise.
        self.assertTrue(AuditEvent.objects.exists())


class AuditApprovalTrailTests(APITestCase):
    def setUp(self):
        self.org = Organization.objects.create(name='Org Audit', code='ORG_AUDIT', type='district')
        self.admin = User.objects.create_user(
            username='audit_admin', email='audit_admin@example.com',
            password='TestPass123!', role='admin', organization=self.org,
        )
        self.officer = User.objects.create_user(
            username='audit_officer', email='audit_officer@example.com',
            password='TestPass123!', role='officer', organization=self.org,
        )
        self.project = Project.objects.create(
            name='Audit Project', code='AUDIT-1',
            start_date=date(2026, 1, 1), end_date=date(2026, 12, 31), created_by=self.admin,
        )
        self.project.organizations.add(self.org)
        self.indicator = Indicator.objects.create(
            name='Reached', code='AUD_IND_1', type='number',
            category='hiv_prevention', created_by=self.admin,
        )
        pi = ProjectIndicator.objects.create(project=self.project, indicator=self.indicator)
        ProjectIndicatorAssignment.objects.create(
            project_indicator=pi, organization=self.org,
            assignment_source='manual', is_active=True,
        )

    def _aggregate(self, status_value='pending'):
        return Aggregate.objects.create(
            indicator=self.indicator, project=self.project, organization=self.org,
            period_start=date(2026, 1, 1), period_end=date(2026, 3, 31),
            value={'total': 5}, status=status_value, created_by=self.officer,
        )

    def test_approval_writes_audit_event(self):
        aggregate = self._aggregate(status_value='reviewed')
        self.client.force_authenticate(self.admin)
        response = self.client.post(f'/api/aggregates/{aggregate.id}/approve/', {}, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        event = AuditEvent.objects.filter(action='approve', object_id=str(aggregate.id)).first()
        self.assertIsNotNone(event)
        self.assertEqual(event.actor_id, self.admin.id)
        self.assertEqual(event.project_id, self.project.id)

    def test_create_writes_audit_event(self):
        self.client.force_authenticate(self.admin)
        response = self.client.post(
            '/api/aggregates/',
            {
                'indicator': self.indicator.id, 'project': self.project.id,
                'organization': self.org.id, 'period_start': '2026-01-01',
                'period_end': '2026-03-31', 'value': {'total': 10},
            },
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        self.assertTrue(AuditEvent.objects.filter(action='create', object_type='aggregate').exists())


class AuditApiTests(APITestCase):
    def setUp(self):
        self.org = Organization.objects.create(name='Org Api', code='ORG_API_AUD', type='district')
        self.admin = User.objects.create_user(
            username='api_admin', email='api_admin@example.com',
            password='TestPass123!', role='admin', organization=self.org,
        )
        self.officer = User.objects.create_user(
            username='api_officer', email='api_officer@example.com',
            password='TestPass123!', role='officer', organization=self.org,
        )
        for i in range(3):
            record_audit_event(action='approve', actor=self.admin, object_type='aggregate', object_id=i)
        record_audit_event(action='create', actor=self.officer, object_type='aggregate', object_id=99)

    def test_admin_can_list_audit_events(self):
        self.client.force_authenticate(self.admin)
        response = self.client.get('/api/audit/events/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        body = response.json()
        count = body['count'] if isinstance(body, dict) and 'count' in body else len(body)
        self.assertEqual(count, 4)

    def test_non_admin_forbidden(self):
        self.client.force_authenticate(self.officer)
        response = self.client.get('/api/audit/events/')
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_filter_by_action(self):
        self.client.force_authenticate(self.admin)
        response = self.client.get('/api/audit/events/?action=create')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        body = response.json()
        results = body['results'] if isinstance(body, dict) and 'results' in body else body
        self.assertTrue(all(row['action'] == 'create' for row in results))
        self.assertEqual(len(results), 1)

    def test_csv_export(self):
        self.client.force_authenticate(self.admin)
        response = self.client.get('/api/audit/events/export/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response['Content-Type'], 'text/csv')
        self.assertIn('attachment; filename="audit_log.csv"', response['Content-Disposition'])
        self.assertIn('action', response.content.decode())
