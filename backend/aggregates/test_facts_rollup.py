"""Tests for the AggregateFact server-side aggregation substrate."""
from datetime import date
from decimal import Decimal

from django.core.management import call_command
from django.test import SimpleTestCase, TestCase
from rest_framework import status
from rest_framework.test import APITestCase

from aggregates.facts import flatten_value, sync_facts_for_aggregate
from aggregates.models import Aggregate, AggregateFact
from indicators.models import Indicator
from organizations.models import Organization
from projects.models import Project, ProjectIndicator
from users.models import User

ROLLUP_URL = "/api/aggregates/rollup/"
P = (date(2025, 10, 1), date(2025, 12, 31))

SEX_AGE_CFG = {
    "enabled": True,
    "dimensions": [
        {"key": "sex", "label": "Sex", "values": ["Male", "Female"]},
        {"key": "age_band", "label": "Age", "values": ["10", "12", "15-19"]},
    ],
}


class FlattenValueTests(SimpleTestCase):
    def test_scalar_and_total(self):
        self.assertEqual(flatten_value(10), [("All", "All", "Total", Decimal("10"))])
        self.assertEqual(flatten_value({"total": 7}), [("All", "All", "Total", Decimal("7"))])

    def test_legacy_male_female(self):
        leaves = flatten_value({"male": 3, "female": 4, "total": 99})
        # male+female preferred over the (incoherent) top-level total; no double count.
        self.assertEqual(sorted(leaves), [
            ("All", "Female", "Total", Decimal("4")),
            ("All", "Male", "Total", Decimal("3")),
        ])

    def test_nested_disaggregates(self):
        value = {"disaggregates": {"All": {"Male": {"10": 1, "12": 2}, "Female": {"10": 5}}}, "total": 8}
        leaves = flatten_value(value)
        self.assertEqual(sum(v for *_x, v in leaves), Decimal("8"))
        self.assertIn(("All", "Male", "10", Decimal("1")), leaves)
        self.assertIn(("All", "Female", "10", Decimal("5")), leaves)


class _Base(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.org = Organization.objects.create(name="Org A", code="FA_A", type="cso")
        cls.other_org = Organization.objects.create(name="Org B", code="FA_B", type="cso")
        cls.admin = User.objects.create_user(username="fa_admin", email="a@x.com", password="P!1", role="admin", organization=cls.org)
        cls.officer = User.objects.create_user(username="fa_off", email="o@x.com", password="P!1", role="officer", organization=cls.org)
        cls.other_officer = User.objects.create_user(username="fa_off2", email="o2@x.com", password="P!1", role="officer", organization=cls.other_org)

        cls.project = Project.objects.create(name="P", code="FA-P", start_date=date(2025, 4, 1), end_date=date(2026, 3, 31), created_by=cls.admin)
        cls.project.organizations.add(cls.org, cls.other_org)
        cls.ind = Indicator.objects.create(name="People reached", code="FA_IND", type="number", aggregate_disaggregation_config=SEX_AGE_CFG, created_by=cls.admin)
        ProjectIndicator.objects.create(project=cls.project, indicator=cls.ind)

        # Approved (org A): single-year ages 10,12 + group 15-19.
        cls.a1 = Aggregate.objects.create(
            indicator=cls.ind, project=cls.project, organization=cls.org,
            period_start=P[0], period_end=P[1], status="approved", created_by=cls.admin,
            value={"disaggregates": {"All": {"Male": {"10": 1, "12": 2, "15-19": 3}, "Female": {"10": 4}}}, "total": 10},
        )
        # Pending (org A): must be excluded from default rollup.
        cls.a_pending = Aggregate.objects.create(
            indicator=cls.ind, project=cls.project, organization=cls.org,
            period_start=date(2025, 7, 1), period_end=date(2025, 9, 30), status="pending", created_by=cls.admin,
            value={"disaggregates": {"All": {"Male": {"10": 100}}}},
        )
        # Approved (org B): must be invisible to org A's officer (scope).
        cls.b1 = Aggregate.objects.create(
            indicator=cls.ind, project=cls.project, organization=cls.other_org,
            period_start=P[0], period_end=P[1], status="approved", created_by=cls.admin,
            value={"disaggregates": {"All": {"Female": {"20-24": 50}}}},
        )

    def setUp(self):
        # setUpTestData runs in a transaction so post_save on_commit fact sync
        # doesn't fire; rebuild facts deterministically from the aggregates.
        call_command("backfill_aggregate_facts")


class FactSyncTests(_Base):
    def test_backfill_builds_facts_summing_to_total(self):
        facts = AggregateFact.objects.filter(aggregate=self.a1)
        self.assertEqual(facts.count(), 4)  # 1+2+3 (male) + 4 (female)
        self.assertEqual(sum(f.value for f in facts), Decimal("10"))
        # denormalised + alias-safe canonical id
        self.assertTrue(all(f.canonical_indicator_id == self.ind.id and not f.is_training for f in facts))

    def test_signal_syncs_on_commit(self):
        with self.captureOnCommitCallbacks(execute=True):
            agg = Aggregate.objects.create(
                indicator=self.ind, project=self.project, organization=self.org,
                period_start=date(2026, 1, 1), period_end=date(2026, 3, 31),
                status="approved", created_by=self.admin, value={"total": 42},
            )
        self.assertEqual(AggregateFact.objects.filter(aggregate=agg).count(), 1)
        self.assertEqual(AggregateFact.objects.get(aggregate=agg).value, Decimal("42"))


class RollupEndpointTests(_Base):
    def test_indicator_rollup_approved_only(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.get(ROLLUP_URL, {"group_by": "indicator", "project": self.project.id})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        # Admin sees both orgs' approved (10 + 50 = 60); pending (100) excluded.
        total = sum(r["value"] for r in resp.data["results"])
        self.assertEqual(total, 60)
        self.assertEqual(resp.data["results"][0]["indicator_code"], "FA_IND")

    def test_age_folding_in_rollup(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.get(ROLLUP_URL, {"group_by": "age", "organization": self.org.id, "fold_ages": "true"})
        bands = {r["band"]: r["value"] for r in resp.data["results"]}
        # 10 + 12 single-years fold into 10-14 (1+2+4=7); 15-19 stays (3).
        self.assertEqual(bands.get("10-14"), 7)
        self.assertEqual(bands.get("15-19"), 3)
        self.assertNotIn("10", bands)

    def test_org_scope_isolation(self):
        # Org A officer must not see org B's approved facts.
        self.client.force_authenticate(self.officer)
        resp = self.client.get(ROLLUP_URL, {"group_by": "indicator"})
        total = sum(r["value"] for r in resp.data["results"])
        self.assertEqual(total, 10)  # only org A approved

    def test_requires_auth(self):
        resp = self.client.get(ROLLUP_URL)
        self.assertEqual(resp.status_code, status.HTTP_401_UNAUTHORIZED)
