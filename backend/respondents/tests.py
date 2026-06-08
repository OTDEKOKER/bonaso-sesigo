from datetime import date

from rest_framework import status
from rest_framework.test import APITestCase

from indicators.models import Indicator
from organizations.models import Organization
from respondents.models import Respondent, Interaction, Response
from users.models import User


class ResponseWriteSecurityTests(APITestCase):
    """SEC-2 regression tests: responses cannot be written across org boundaries."""

    def setUp(self):
        self.org_a = Organization.objects.create(name='Org A', code='ORG_A_RESP', type='district')
        self.org_b = Organization.objects.create(name='Org B', code='ORG_B_RESP', type='district')

        self.admin = User.objects.create_user(
            username='resp_admin', email='resp_admin@example.com',
            password='TestPass123!', role='admin', organization=self.org_a,
        )
        self.officer_a = User.objects.create_user(
            username='resp_officer_a', email='resp_officer_a@example.com',
            password='TestPass123!', role='officer', organization=self.org_a,
        )

        self.indicator = Indicator.objects.create(
            name='Reached', code='IND_RESP_1', type='number', category='hiv_prevention',
            created_by=self.admin,
        )

        # Respondent + interaction belonging to ORG B (foreign to officer_a).
        self.respondent_b = Respondent.objects.create(
            unique_id='RESP-B-1', first_name='Bee', last_name='Bee',
            organization=self.org_b, created_by=self.admin,
        )
        self.interaction_b = Interaction.objects.create(
            respondent=self.respondent_b, date=date(2026, 1, 10), created_by=self.admin,
        )

        # Respondent + interaction belonging to ORG A (officer_a's own org).
        self.respondent_a = Respondent.objects.create(
            unique_id='RESP-A-1', first_name='Ay', last_name='Ay',
            organization=self.org_a, created_by=self.officer_a,
        )
        self.interaction_a = Interaction.objects.create(
            respondent=self.respondent_a, date=date(2026, 1, 11), created_by=self.officer_a,
        )

    def test_officer_cannot_create_response_for_foreign_org_interaction(self):
        self.client.force_authenticate(self.officer_a)
        payload = {
            'interaction': self.interaction_b.id,
            'indicator': self.indicator.id,
            'value': {'total': 1},
        }
        response = self.client.post('/api/record/responses/', payload, format='json')
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(Response.objects.count(), 0)

    def test_officer_can_create_response_for_own_org_interaction(self):
        self.client.force_authenticate(self.officer_a)
        payload = {
            'interaction': self.interaction_a.id,
            'indicator': self.indicator.id,
            'value': {'total': 1},
        }
        response = self.client.post('/api/record/responses/', payload, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(Response.objects.count(), 1)

    def test_admin_can_create_response_for_any_interaction(self):
        self.client.force_authenticate(self.admin)
        payload = {
            'interaction': self.interaction_b.id,
            'indicator': self.indicator.id,
            'value': {'total': 2},
        }
        response = self.client.post('/api/record/responses/', payload, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(Response.objects.count(), 1)
