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

    def test_current_user_reports_enforced_only_when_configured(self):
        # Un-configured officer: full role experience, NOT enforced.
        self.client.force_authenticate(self.officer)
        body = self.client.get('/api/users/me/').json()
        self.assertFalse(body['module_permissions_enforced'])

        # Once an admin pins a custom row, the officer becomes enforced.
        UserModulePermission.objects.create(
            user=self.officer, module='aggregates', actions=['view'], is_enabled=True,
        )
        body = self.client.get('/api/users/me/').json()
        self.assertTrue(body['module_permissions_enforced'])
        self.assertEqual(body['module_permissions']['aggregates'], ['view'])

    def test_current_user_does_not_n_plus_one(self):
        # The dashboard shell blocks on this single request, so guard its query
        # budget. Give the officer relations (org, group, custom module row,
        # assigned project) so the prefetch path is exercised, then assert the
        # endpoint stays within a small, constant query budget regardless.
        from django.contrib.auth.models import Group
        from projects.models import Project

        self.officer.groups.add(Group.objects.create(name='mp-grp'))
        UserModulePermission.objects.create(
            user=self.officer, module='aggregates', actions=['view'], is_enabled=True,
        )
        project = Project.objects.create(
            name='MP Proj', status='active', start_date='2026-01-01', end_date='2026-12-31',
        )
        self.officer.assigned_projects.add(project)

        self.client.force_authenticate(self.officer)
        with self.assertNumQueries(self.CURRENT_USER_QUERY_BUDGET):
            response = self.client.get('/api/users/me/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    # Exact query count for GET /api/users/me/ — the request the whole dashboard
    # shell blocks on. Constant regardless of how many groups / projects / module
    # rows the user has; a bump here means an N+1 crept back in.
    #   1 user (select_related organization)
    #   2 module_permissions prefetch        5 groups values_list
    #   3 assigned_projects prefetch         6 assigned_projects ids (default proj)
    #   4 user_permissions values_list       7 default project lookup
    CURRENT_USER_QUERY_BUDGET = 7
