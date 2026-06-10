from rest_framework import status
from rest_framework.test import APITestCase

from organizations.models import Organization
from users.models import User, UserModulePermission
from users.module_permissions import (
    get_role_defaults,
    resolve_user_module_permissions,
    user_has_module_permission,
)


class ModulePermissionResolutionTests(APITestCase):
    def setUp(self):
        self.org = Organization.objects.create(name='MP Org', code='MP_ORG', type='district')

    def _user(self, role):
        return User.objects.create_user(
            username=f'mp_{role}', email=f'mp_{role}@example.com',
            password='TestPass123!', role=role, organization=self.org,
        )

    def test_role_defaults_admin_is_everything(self):
        defaults = get_role_defaults('admin')
        self.assertIn('users', defaults)
        self.assertIn('settings', defaults)
        self.assertIn('approve', defaults['aggregates'])

    def test_officer_defaults_review_not_approve(self):
        officer = self._user('officer')
        effective = resolve_user_module_permissions(officer)
        self.assertIn('review', effective['aggregates'])
        self.assertNotIn('approve', effective['aggregates'])
        self.assertNotIn('users', effective)  # deny-by-default

    def test_collector_cannot_approve_by_default(self):
        collector = self._user('collector')
        self.assertTrue(user_has_module_permission(collector, 'aggregates', 'create'))
        self.assertFalse(user_has_module_permission(collector, 'aggregates', 'approve'))

    def test_client_has_no_data_entry_by_default(self):
        client = self._user('client')
        self.assertTrue(user_has_module_permission(client, 'reports', 'view'))
        self.assertFalse(user_has_module_permission(client, 'aggregates', 'create'))
        self.assertFalse(user_has_module_permission(client, 'aggregates', 'view'))

    def test_admin_overrides_everything(self):
        admin = self._user('admin')
        self.assertTrue(user_has_module_permission(admin, 'settings', 'manage'))
        self.assertTrue(user_has_module_permission(admin, 'users', 'reset_password'))

    def test_custom_row_overrides_role_default(self):
        officer = self._user('officer')
        UserModulePermission.objects.create(user=officer, module='aggregates', actions=['view'])
        effective = resolve_user_module_permissions(officer)
        self.assertEqual(effective['aggregates'], ['view'])
        self.assertFalse(user_has_module_permission(officer, 'aggregates', 'review'))

    def test_disabled_row_denies_module(self):
        officer = self._user('officer')
        UserModulePermission.objects.create(user=officer, module='aggregates', actions=['view'], is_enabled=False)
        effective = resolve_user_module_permissions(officer)
        self.assertNotIn('aggregates', effective)
        self.assertFalse(user_has_module_permission(officer, 'aggregates', 'view'))

    def test_invalid_actions_are_dropped_in_resolution(self):
        officer = self._user('officer')
        UserModulePermission.objects.create(user=officer, module='aggregates', actions=['view', 'nonsense'])
        effective = resolve_user_module_permissions(officer)
        self.assertEqual(effective['aggregates'], ['view'])


class ModulePermissionApiTests(APITestCase):
    def setUp(self):
        self.org = Organization.objects.create(name='MP API Org', code='MP_API', type='district')
        self.admin = User.objects.create_user(
            username='mp_admin', email='mp_admin@example.com',
            password='TestPass123!', role='admin', organization=self.org,
        )
        self.officer = User.objects.create_user(
            username='mp_officer2', email='mp_officer2@example.com',
            password='TestPass123!', role='officer', organization=self.org,
        )

    def test_defaults_endpoint(self):
        self.client.force_authenticate(self.admin)
        response = self.client.get('/api/users/module-permission-defaults/?role=manager')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn('aggregates', response.json()['defaults'])

    def test_non_admin_cannot_read_defaults(self):
        self.client.force_authenticate(self.officer)
        response = self.client.get('/api/users/module-permission-defaults/?role=manager')
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_get_user_module_permissions(self):
        self.client.force_authenticate(self.admin)
        response = self.client.get(f'/api/users/{self.officer.id}/module-permissions/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        body = response.json()
        self.assertIn('effective', body)
        self.assertIn('role_defaults', body)
        self.assertIn('review', body['effective']['aggregates'])

    def test_put_replaces_permissions_and_audits(self):
        from audit.models import AuditEvent
        self.client.force_authenticate(self.admin)
        response = self.client.put(
            f'/api/users/{self.officer.id}/module-permissions/',
            {'permissions': [{'module': 'aggregates', 'actions': ['view', 'export']}]},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.officer.refresh_from_db()
        effective = resolve_user_module_permissions(self.officer)
        self.assertEqual(effective['aggregates'], ['view', 'export'])
        self.assertTrue(AuditEvent.objects.filter(action='manage', object_type='user_module_permissions').exists())

    def test_put_rejects_unknown_module(self):
        self.client.force_authenticate(self.admin)
        response = self.client.put(
            f'/api/users/{self.officer.id}/module-permissions/',
            {'permissions': [{'module': 'nope', 'actions': ['view']}]},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_non_admin_cannot_set_permissions(self):
        self.client.force_authenticate(self.officer)
        response = self.client.put(
            f'/api/users/{self.admin.id}/module-permissions/',
            {'permissions': []},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_current_user_payload_includes_module_permissions(self):
        self.client.force_authenticate(self.officer)
        response = self.client.get('/api/users/me/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        body = response.json()
        self.assertIn('module_permissions', body)
        self.assertIn('aggregates', body['module_permissions'])
