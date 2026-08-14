"""Role-gate regression tests for the respondent record module (2026-08-14 audit).

The generic ``HasModulePermission`` is allow-when-no-explicit-row, so on its own
it does not stop an external ``client`` (read-only funder) reaching respondent
personal data within their org scope. ``IsDataEntryUser`` closes that: clients
(and unknown/None roles) are denied; the three data-handling roles keep access.
"""
from rest_framework import status
from rest_framework.test import APITestCase

from organizations.models import Organization
from respondents.models import Respondent
from users.models import User


class RespondentRoleGateTests(APITestCase):
    def setUp(self):
        self.org = Organization.objects.create(name='Org R', code='ORG_R_GATE', type='district')
        self.admin = User.objects.create_user(
            username='gate_admin', email='gate_admin@example.com',
            password='TestPass123!', role='admin', organization=self.org,
        )
        self.collector = User.objects.create_user(
            username='gate_collector', email='gate_collector@example.com',
            password='TestPass123!', role='collector', organization=self.org,
        )
        self.client_user = User.objects.create_user(
            username='gate_client', email='gate_client@example.com',
            password='TestPass123!', role='client', organization=self.org,
        )
        self.respondent = Respondent.objects.create(
            unique_id='GATE-1', first_name='Gee', last_name='Gee',
            organization=self.org, created_by=self.admin,
        )

    def test_client_denied_respondent_list(self):
        self.client.force_authenticate(self.client_user)
        self.assertEqual(
            self.client.get('/api/record/respondents/').status_code,
            status.HTTP_403_FORBIDDEN,
        )

    def test_client_denied_respondent_export(self):
        self.client.force_authenticate(self.client_user)
        self.assertEqual(
            self.client.get('/api/record/respondents/export/').status_code,
            status.HTTP_403_FORBIDDEN,
        )

    def test_client_denied_respondent_create(self):
        self.client.force_authenticate(self.client_user)
        resp = self.client.post(
            '/api/record/respondents/',
            {'unique_id': 'GATE-NEW', 'first_name': 'X', 'last_name': 'Y',
             'organization': self.org.id},
            format='json',
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_collector_allowed_respondent_list(self):
        self.client.force_authenticate(self.collector)
        self.assertEqual(
            self.client.get('/api/record/respondents/').status_code,
            status.HTTP_200_OK,
        )
