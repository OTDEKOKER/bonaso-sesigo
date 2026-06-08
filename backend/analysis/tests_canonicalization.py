"""AN-1 / DI-1 regression tests: analytics rolls duplicates up to canonical."""
from datetime import date

from django.core.management import call_command
from rest_framework.test import APITestCase

from aggregates.models import Aggregate
from indicators.canonical import canonical_id_map, plan_canonicalization
from indicators.models import Indicator
from organizations.models import Organization
from projects.models import Project
from users.models import User


class CanonicalizationTests(APITestCase):
    def setUp(self):
        self.org = Organization.objects.create(name='Org C', code='ORG_CAN', type='district')
        self.admin = User.objects.create_user(
            username='canon_admin', email='canon@example.com',
            password='TestPass123!', role='admin', organization=self.org,
        )
        self.project = Project.objects.create(
            name='Canon Project', code='CANON-1',
            start_date=date(2026, 1, 1), end_date=date(2026, 12, 31),
            created_by=self.admin,
        )
        self.project.organizations.add(self.org)
        # Same metric, two code schemes (NAHPA canonical + AUTO_ duplicate).
        self.canonical = Indicator.objects.create(
            name='Number of people referred for PEP.',
            code='NAHPA2025-26-7-PEP', type='number', category='hiv_prevention',
        )
        self.duplicate = Indicator.objects.create(
            name='Number of people referred for PEP.',
            code='AUTO_NUMBER_OF_PEOPLE_REFERRED_FOR_PEP', type='number',
            category='hiv_prevention',
        )

    def _agg(self, indicator, total, month=1):
        return Aggregate.objects.create(
            indicator=indicator, organization=self.org, project=self.project,
            period_start=date(2026, month, 1), period_end=date(2026, month, 28),
            value={'total': total}, status='approved', created_by=self.admin,
        )

    def test_command_links_duplicate_to_canonical_and_is_idempotent(self):
        self._agg(self.canonical, 10, month=1)
        self._agg(self.duplicate, 5, month=2)
        self._agg(self.duplicate, 7, month=3)  # AUTO_ has more aggregates but must NOT win

        call_command('canonicalize_indicators', '--apply', verbosity=0)
        self.canonical.refresh_from_db()
        self.duplicate.refresh_from_db()

        self.assertFalse(self.canonical.is_deprecated)
        self.assertIsNone(self.canonical.canonical_indicator_id)
        self.assertTrue(self.duplicate.is_deprecated)
        self.assertEqual(self.duplicate.canonical_indicator_id, self.canonical.id)

        # Re-run is a no-op.
        before = Indicator.objects.filter(is_deprecated=True).count()
        call_command('canonicalize_indicators', '--apply', verbosity=0)
        self.assertEqual(Indicator.objects.filter(is_deprecated=True).count(), before)

    def test_canonical_id_map_folds_duplicates(self):
        self.duplicate.canonical_indicator = self.canonical
        self.duplicate.is_deprecated = True
        self.duplicate.save()
        id_map = canonical_id_map()
        self.assertEqual(id_map[self.duplicate.id], self.canonical.id)
        self.assertEqual(id_map[self.canonical.id], self.canonical.id)

    def test_bulk_trends_folds_duplicate_data_into_canonical(self):
        # Link the duplicate, then request the canonical id only.
        self.duplicate.canonical_indicator = self.canonical
        self.duplicate.is_deprecated = True
        self.duplicate.save()
        self._agg(self.canonical, 10, month=1)
        self._agg(self.duplicate, 5, month=2)  # stranded on the deprecated variant

        self.client.force_authenticate(self.admin)
        resp = self.client.get(
            f'/api/analysis/trends/?indicator_ids={self.canonical.id}'
            f'&date_from=2026-01-01&date_to=2026-03-31'
        )
        self.assertEqual(resp.status_code, 200)
        series = resp.data['series']
        self.assertEqual(len(series), 1)
        # 10 (canonical) + 5 (folded-in duplicate) = 15
        total = sum(point['value'] for point in series[0]['data'])
        self.assertEqual(total, 15)

    def test_choose_canonical_prefers_non_auto_code(self):
        plan = plan_canonicalization()
        cluster = next(p for p in plan if 'pep' in p['normalized_name'])
        self.assertEqual(cluster['canonical'].id, self.canonical.id)
