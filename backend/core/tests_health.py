"""Health endpoint (audit WS3): unauthenticated, returns 200 + DB flag, and does
not leak infrastructure detail."""
from rest_framework import status
from rest_framework.test import APITestCase


class HealthEndpointTests(APITestCase):
    def test_health_is_public_and_ok(self):
        resp = self.client.get('/api/health/')
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data['status'], 'ok')
        self.assertTrue(resp.data['database'])

    def test_health_body_has_no_sensitive_keys(self):
        resp = self.client.get('/api/health/')
        # Only a status string and a boolean — no version/host/settings/secret.
        self.assertEqual(set(resp.data.keys()), {'status', 'database'})
