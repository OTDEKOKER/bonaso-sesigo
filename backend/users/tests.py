from rest_framework import status
from rest_framework.test import APITestCase

from organizations.models import Organization
from users.models import User


class UserSecurityTests(APITestCase):
    def setUp(self):
        self.org = Organization.objects.create(name='Org A', code='ORG_A', type='district')
        self.admin = User.objects.create_user(
            username='admin_user',
            email='admin@example.com',
            password='TestPass123!',
            role='admin',
            organization=self.org,
        )
        self.officer = User.objects.create_user(
            username='officer_user',
            email='officer@example.com',
            password='TestPass123!',
            role='officer',
            organization=self.org,
        )

    def test_create_user_requires_portal_admin(self):
        payload = {
            'username': 'new_user',
            'email': 'new_user@example.com',
            'role': 'officer',
            'organization': self.org.id,
            'password': 'StrongPass123!',
            'password_confirm': 'StrongPass123!',
        }

        self.client.force_authenticate(self.officer)
        response = self.client.post('/api/users/create-user/', payload, format='json')
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

        self.client.force_authenticate(self.admin)
        response = self.client.post('/api/users/create-user/', payload, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

    def test_non_admin_cannot_escalate_self_role_or_permissions(self):
        self.client.force_authenticate(self.officer)

        restricted_response = self.client.patch(
            f'/api/users/{self.officer.id}/',
            {'role': 'admin'},
            format='json',
        )
        self.assertEqual(restricted_response.status_code, status.HTTP_403_FORBIDDEN)

        allowed_response = self.client.patch(
            f'/api/users/{self.officer.id}/',
            {'first_name': 'Updated'},
            format='json',
        )
        self.assertEqual(allowed_response.status_code, status.HTTP_200_OK)
        self.officer.refresh_from_db()
        self.assertEqual(self.officer.first_name, 'Updated')
