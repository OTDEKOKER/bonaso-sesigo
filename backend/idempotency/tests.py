"""OFF-1 regression tests: replayed mutations create a single record.

Simulates the offline failure mode: the server commits a write, the ACK is lost
on the network, and the client replays the same request (same X-Idempotency-Key).
The expectation is exactly one database row and the original response returned on
replay.
"""
from datetime import date

from rest_framework import status
from rest_framework.test import APITestCase

from idempotency.models import IdempotencyKey
from indicators.models import Indicator
from organizations.models import Organization
from respondents.models import Respondent
from users.models import User


class RespondentIdempotencyTests(APITestCase):
    URL = '/api/record/respondents/'

    def setUp(self):
        self.org = Organization.objects.create(name='Org I', code='ORG_IDEM', type='district')
        self.officer = User.objects.create_user(
            username='idem_officer', email='idem@example.com',
            password='TestPass123!', role='officer', organization=self.org,
        )
        self.client.force_authenticate(self.officer)
        self.payload = {
            'unique_id': 'IDEM-1', 'first_name': 'Ida', 'last_name': 'Idem',
            'organization': self.org.id,
        }
        self.key = 'idem-key-respondent-001'

    def test_replayed_post_creates_single_record(self):
        first = self.client.post(self.URL, self.payload, format='json',
                                 HTTP_X_IDEMPOTENCY_KEY=self.key)
        self.assertEqual(first.status_code, status.HTTP_201_CREATED)
        created_id = first.data['id']

        # The ACK was "lost" -> client replays the identical request.
        second = self.client.post(self.URL, self.payload, format='json',
                                  HTTP_X_IDEMPOTENCY_KEY=self.key)
        self.assertEqual(second.status_code, status.HTTP_201_CREATED)
        self.assertEqual(second.data['id'], created_id)

        # Exactly one row, despite two POSTs.
        self.assertEqual(Respondent.objects.filter(unique_id='IDEM-1').count(), 1)
        self.assertEqual(IdempotencyKey.objects.filter(key=self.key).count(), 1)

    def test_no_key_still_allows_creation(self):
        resp = self.client.post(self.URL, self.payload, format='json')
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertEqual(IdempotencyKey.objects.count(), 0)

    def test_same_key_different_payload_is_rejected(self):
        self.client.post(self.URL, self.payload, format='json',
                         HTTP_X_IDEMPOTENCY_KEY=self.key)
        tampered = dict(self.payload, first_name='Different')
        resp = self.client.post(self.URL, tampered, format='json',
                                HTTP_X_IDEMPOTENCY_KEY=self.key)
        self.assertEqual(resp.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertEqual(Respondent.objects.count(), 1)

    def test_failed_write_does_not_persist_key(self):
        # Missing required field -> 400; the key must remain replayable afterwards.
        bad = {'first_name': 'NoOrg'}
        resp = self.client.post(self.URL, bad, format='json',
                                HTTP_X_IDEMPOTENCY_KEY='retry-after-fail')
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(IdempotencyKey.objects.filter(key='retry-after-fail', completed=True).exists())
        # Now a corrected retry with the same key succeeds and creates the row.
        good = dict(self.payload, unique_id='IDEM-RETRY')
        resp2 = self.client.post(self.URL, good, format='json',
                                 HTTP_X_IDEMPOTENCY_KEY='retry-after-fail')
        self.assertEqual(resp2.status_code, status.HTTP_201_CREATED)
        self.assertEqual(Respondent.objects.filter(unique_id='IDEM-RETRY').count(), 1)

    def test_key_is_scoped_per_user(self):
        # Same key value from a different user must not collide / leak responses.
        self.client.post(self.URL, self.payload, format='json',
                         HTTP_X_IDEMPOTENCY_KEY=self.key)
        other = User.objects.create_user(
            username='idem_other', email='idem_other@example.com',
            password='TestPass123!', role='officer', organization=self.org,
        )
        self.client.force_authenticate(other)
        resp = self.client.post(
            self.URL, dict(self.payload, unique_id='IDEM-2'),
            format='json', HTTP_X_IDEMPOTENCY_KEY=self.key,
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertEqual(IdempotencyKey.objects.filter(key=self.key).count(), 2)
