"""SEC-1 regression tests: authentication endpoints are rate limited.

These exercise the REAL configured throttle rates (settings.py defaults:
login=10/min). DRF binds ``SimpleRateThrottle.THROTTLE_RATES`` and ``.cache`` at
import time, so overriding them via ``@override_settings`` does not propagate;
instead we drive the genuinely-configured limit and clear the shared throttle
cache around each test to keep them isolated.
"""

from rest_framework import status
from rest_framework.test import APITestCase
from rest_framework.throttling import SimpleRateThrottle

from organizations.models import Organization
from users.models import User


def _clear_throttle_cache():
    SimpleRateThrottle.cache.clear()


class LoginThrottleTests(APITestCase):
    LOGIN_URL = '/api/users/request-token/'

    def setUp(self):
        _clear_throttle_cache()
        self.org = Organization.objects.create(name='Org T', code='ORG_THR', type='district')
        self.user = User.objects.create_user(
            username='throttle_user', email='throttle@example.com',
            password='TestPass123!', role='officer', organization=self.org,
        )

    def tearDown(self):
        _clear_throttle_cache()

    def test_repeated_failed_logins_eventually_return_429(self):
        # Configured login rate is 10/min; the 11th request from one IP is blocked.
        statuses = []
        for _ in range(12):
            resp = self.client.post(
                self.LOGIN_URL,
                {'username': 'throttle_user', 'password': 'wrong'},
                format='json', HTTP_X_FORWARDED_FOR='203.0.113.10',
            )
            statuses.append(resp.status_code)
        self.assertIn(status.HTTP_401_UNAUTHORIZED, statuses)
        self.assertIn(status.HTTP_429_TOO_MANY_REQUESTS, statuses)
        # Once blocked it stays blocked within the window.
        self.assertEqual(statuses[-1], status.HTTP_429_TOO_MANY_REQUESTS)

    def test_successful_login_within_limit_is_unaffected(self):
        resp = self.client.post(
            self.LOGIN_URL,
            {'username': 'throttle_user', 'password': 'TestPass123!'},
            format='json', HTTP_X_FORWARDED_FOR='203.0.113.30',
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertIn('access', resp.data)

    def test_throttle_bucket_is_per_client_ip(self):
        # Exhaust IP .10's bucket with bad logins.
        last = None
        for _ in range(12):
            last = self.client.post(
                self.LOGIN_URL,
                {'username': 'throttle_user', 'password': 'wrong'},
                format='json', HTTP_X_FORWARDED_FOR='203.0.113.10',
            )
        self.assertEqual(last.status_code, status.HTTP_429_TOO_MANY_REQUESTS)
        # A different client IP still succeeds — buckets are keyed per IP.
        other = self.client.post(
            self.LOGIN_URL,
            {'username': 'throttle_user', 'password': 'TestPass123!'},
            format='json', HTTP_X_FORWARDED_FOR='203.0.113.40',
        )
        self.assertEqual(other.status_code, status.HTTP_200_OK)
