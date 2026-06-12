"""Cross-org READ isolation regression tests for the record module.

The existing SEC-2 suite (``respondents/tests.py``) covers cross-org *write*
rejection on responses. This module closes the complementary read-side
boundary: a non-admin must never be able to LIST or directly RETRIEVE another
organisation's respondent / interaction (read IDOR), the org-scoped custom
actions (export) must not leak foreign rows, cross-org interaction *creation*
must be refused, and unauthenticated callers must get 401 — not data.
"""
from datetime import date

from rest_framework import status
from rest_framework.test import APITestCase

from organizations.models import Organization
from respondents.models import Respondent, Interaction
from users.models import User


class CrossOrgReadIsolationTests(APITestCase):
    def setUp(self):
        self.org_a = Organization.objects.create(name='Org A', code='ORG_A_XREAD', type='district')
        self.org_b = Organization.objects.create(name='Org B', code='ORG_B_XREAD', type='district')

        self.admin = User.objects.create_user(
            username='xread_admin', email='xread_admin@example.com',
            password='TestPass123!', role='admin', organization=self.org_a,
        )
        self.officer_a = User.objects.create_user(
            username='xread_officer_a', email='xread_officer_a@example.com',
            password='TestPass123!', role='officer', organization=self.org_a,
        )

        # Foreign (Org B) respondent + interaction — officer_a must never see these.
        self.respondent_b = Respondent.objects.create(
            unique_id='XREAD-B-1', first_name='Bee', last_name='Bee',
            organization=self.org_b, created_by=self.admin,
        )
        self.interaction_b = Interaction.objects.create(
            respondent=self.respondent_b, date=date(2026, 1, 10), created_by=self.admin,
        )
        # Own (Org A) respondent — officer_a may see this.
        self.respondent_a = Respondent.objects.create(
            unique_id='XREAD-A-1', first_name='Ay', last_name='Ay',
            organization=self.org_a, created_by=self.officer_a,
        )

    # --- list isolation ---------------------------------------------------
    def test_officer_list_excludes_foreign_org_respondent(self):
        self.client.force_authenticate(self.officer_a)
        resp = self.client.get('/api/record/respondents/')
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        body = resp.json()
        rows = body['results'] if isinstance(body, dict) and 'results' in body else body
        ids = {r['id'] for r in rows}
        self.assertIn(self.respondent_a.id, ids)
        self.assertNotIn(self.respondent_b.id, ids)

    # --- direct retrieve IDOR --------------------------------------------
    def test_officer_cannot_retrieve_foreign_respondent(self):
        self.client.force_authenticate(self.officer_a)
        resp = self.client.get(f'/api/record/respondents/{self.respondent_b.id}/')
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)

    def test_officer_cannot_retrieve_foreign_interaction(self):
        self.client.force_authenticate(self.officer_a)
        resp = self.client.get(f'/api/record/interactions/{self.interaction_b.id}/')
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)

    # --- custom action leak ----------------------------------------------
    def test_officer_export_excludes_foreign_respondent(self):
        self.client.force_authenticate(self.officer_a)
        resp = self.client.get('/api/record/respondents/export/')
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        content = resp.content.decode('utf-8')
        self.assertIn('XREAD-A-1', content)
        self.assertNotIn('XREAD-B-1', content)

    # --- cross-org interaction create ------------------------------------
    def test_officer_cannot_create_interaction_for_foreign_respondent(self):
        self.client.force_authenticate(self.officer_a)
        payload = {'respondent': self.respondent_b.id, 'date': '2026-02-01'}
        resp = self.client.post('/api/record/interactions/', payload, format='json')
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    # --- admin sees everything -------------------------------------------
    def test_admin_can_retrieve_foreign_respondent(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.get(f'/api/record/respondents/{self.respondent_b.id}/')
        self.assertEqual(resp.status_code, status.HTTP_200_OK)

    # --- unauthenticated --------------------------------------------------
    def test_unauthenticated_cannot_list_respondents(self):
        resp = self.client.get('/api/record/respondents/')
        self.assertEqual(resp.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_unauthenticated_cannot_list_interactions(self):
        resp = self.client.get('/api/record/interactions/')
        self.assertEqual(resp.status_code, status.HTTP_401_UNAUTHORIZED)
