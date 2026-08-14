"""Access-control + Live/Training isolation tests for respondent profiles.

Profiles hold special-category personal data (health_status, disabilities,
income). These lock in two fixes from the 2026-08-14 data-flow audit:

  * role gate — external ``client`` stakeholders (and unknown/None roles) must
    never reach individual profile data, even within their org scope;
  * Live/Training isolation — a live session must not see a profile whose
    respondent exists only under a training project, and vice versa.
"""
from datetime import date

from rest_framework import status
from rest_framework.test import APITestCase

from organizations.models import Organization
from projects.models import Project
from respondents.models import Respondent, Interaction
from profiles.models import Profile
from users.models import User


class ProfileRoleGateTests(APITestCase):
    def setUp(self):
        self.org = Organization.objects.create(name='Org P', code='ORG_P_PROF', type='district')
        self.admin = User.objects.create_user(
            username='prof_admin', email='prof_admin@example.com',
            password='TestPass123!', role='admin', organization=self.org,
        )
        self.officer = User.objects.create_user(
            username='prof_officer', email='prof_officer@example.com',
            password='TestPass123!', role='officer', organization=self.org,
        )
        self.collector = User.objects.create_user(
            username='prof_collector', email='prof_collector@example.com',
            password='TestPass123!', role='collector', organization=self.org,
        )
        self.client_user = User.objects.create_user(
            username='prof_client', email='prof_client@example.com',
            password='TestPass123!', role='client', organization=self.org,
        )
        self.respondent = Respondent.objects.create(
            unique_id='PROF-1', first_name='Pea', last_name='Pea',
            organization=self.org, created_by=self.admin,
        )
        self.profile = Profile.objects.create(
            respondent=self.respondent, health_status='hypertension',
            disabilities='none', income_level='low',
        )

    def test_client_role_denied_profiles(self):
        self.client.force_authenticate(self.client_user)
        resp = self.client.get('/api/profiles/')
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_client_role_denied_profile_write(self):
        self.client.force_authenticate(self.client_user)
        resp = self.client.patch(
            f'/api/profiles/{self.profile.id}/',
            {'health_status': 'tampered'}, format='json',
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)
        self.profile.refresh_from_db()
        self.assertEqual(self.profile.health_status, 'hypertension')

    def test_officer_allowed_profiles(self):
        self.client.force_authenticate(self.officer)
        resp = self.client.get('/api/profiles/')
        self.assertEqual(resp.status_code, status.HTTP_200_OK)

    def test_collector_allowed_profiles(self):
        self.client.force_authenticate(self.collector)
        resp = self.client.get('/api/profiles/')
        self.assertEqual(resp.status_code, status.HTTP_200_OK)


class ProfileTrainingIsolationTests(APITestCase):
    def setUp(self):
        self.org = Organization.objects.create(name='Org T', code='ORG_T_PROF', type='district')
        self.admin = User.objects.create_user(
            username='prof_iso_admin', email='prof_iso_admin@example.com',
            password='TestPass123!', role='admin', organization=self.org,
        )
        self.officer = User.objects.create_user(
            username='prof_iso_officer', email='prof_iso_officer@example.com',
            password='TestPass123!', role='officer', organization=self.org,
        )
        self.live_project = Project.objects.create(
            name='Live P', code='LIVE_PROF', start_date=date(2026, 1, 1),
            end_date=date(2026, 12, 31), is_training=False,
        )
        self.training_project = Project.objects.create(
            name='Training P', code='TRAIN_PROF', start_date=date(2026, 1, 1),
            end_date=date(2026, 12, 31), is_training=True,
        )

        # Respondent seen only through a TRAINING project interaction.
        self.training_resp = Respondent.objects.create(
            unique_id='PROF-TRN', first_name='Tr', last_name='Tr',
            organization=self.org, created_by=self.admin,
        )
        Interaction.objects.create(
            respondent=self.training_resp, project=self.training_project,
            date=date(2026, 1, 5), created_by=self.admin,
        )
        self.training_profile = Profile.objects.create(
            respondent=self.training_resp, health_status='training-only',
        )

        # Respondent seen through a LIVE project interaction.
        self.live_resp = Respondent.objects.create(
            unique_id='PROF-LIV', first_name='Lv', last_name='Lv',
            organization=self.org, created_by=self.admin,
        )
        Interaction.objects.create(
            respondent=self.live_resp, project=self.live_project,
            date=date(2026, 1, 6), created_by=self.admin,
        )
        self.live_profile = Profile.objects.create(
            respondent=self.live_resp, health_status='live-only',
        )

    def _ids(self, resp):
        body = resp.json()
        rows = body['results'] if isinstance(body, dict) and 'results' in body else body
        return {r['id'] for r in rows}

    def test_live_session_excludes_training_only_profile(self):
        # A default (live) session — no signed training claim — must return the
        # live respondent's profile and exclude the profile whose respondent
        # exists only under a training project.
        self.client.force_authenticate(self.officer)
        resp = self.client.get('/api/profiles/')
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        ids = self._ids(resp)
        self.assertIn(self.live_profile.id, ids)
        self.assertNotIn(self.training_profile.id, ids)
