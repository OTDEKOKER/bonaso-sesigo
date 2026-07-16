"""Durable KP-label canonicalisation: variants can never persist or be recovered
into a config (so the matrix + workbook download can't re-grow duplicate rows)."""
from datetime import date

from django.test import SimpleTestCase, TestCase

from aggregates.models import Aggregate, AggregateFact
from indicators.disaggregation import (
    canonical_disaggregate_label,
    canonicalize_value_disaggregate_labels,
    config_from_aggregate_data,
)
from indicators.models import Indicator
from organizations.models import Organization
from projects.models import Project
from users.models import User


class CanonicalLabelUnitTests(SimpleTestCase):
    def test_variants_map_to_canonical(self):
        for variant in ["General population", "general population", "Gen Pop",
                        "Gen. Population", "General Poluation", "PWIDs"]:
            self.assertIn(canonical_disaggregate_label(variant), ("GENERAL POP.", "PWID"))
        self.assertEqual(canonical_disaggregate_label("General population"), "GENERAL POP.")
        self.assertEqual(canonical_disaggregate_label("PWIDs"), "PWID")

    def test_canonical_and_distinct_labels_untouched(self):
        for keep in ["GENERAL POP.", "PWID", "PWUD", "FSW", "MSM", "LGBTQI+", "Some Service Area"]:
            self.assertEqual(canonical_disaggregate_label(keep), keep)

    def test_value_canonicalisation_is_sum_preserving_and_merges(self):
        value = {
            "disaggregates": {
                "GENERAL POP.": {"Male": {"20-24": 2}},
                "General population": {"Male": {"20-24": 3}, "Female": {"25-29": 1}},
                "PWIDs": {"Female": {"30-34": 4}},
            },
            "total": 10,
        }
        canonicalize_value_disaggregate_labels(value)
        dis = value["disaggregates"]
        self.assertEqual(set(dis.keys()), {"GENERAL POP.", "PWID"})
        # 2 + 3 merged for Male 20-24; Female 25-29 carried over.
        self.assertEqual(dis["GENERAL POP."]["Male"]["20-24"], 5)
        self.assertEqual(dis["GENERAL POP."]["Female"]["25-29"], 1)
        self.assertEqual(dis["PWID"]["Female"]["30-34"], 4)

    def test_config_recovery_collapses_variants(self):
        samples = [
            {"General population": {"Male": {"20-24": 1}}},
            {"GENERAL POP.": {"Male": {"20-24": 1}}, "PWIDs": {"Male": {"20-24": 1}}},
        ]
        cfg = config_from_aggregate_data(samples, sub_labels=["Key Population", "Sex", "Age Range"])
        kp = cfg["dimensions"][0]["values"]
        self.assertIn("GENERAL POP.", kp)
        self.assertIn("PWID", kp)
        self.assertNotIn("General population", kp)
        self.assertNotIn("PWIDs", kp)


class CanonicalLabelWritePathTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.org = Organization.objects.create(name="Org", code="CL_ORG", type="cso")
        cls.admin = User.objects.create_user(username="cl_admin", email="cl@x.com", password="P!1", role="admin", organization=cls.org)
        cls.project = Project.objects.create(name="P", code="CL-P", start_date=date(2025, 4, 1), end_date=date(2026, 3, 31), created_by=cls.admin)
        cls.indicator = Indicator.objects.create(code="CL1", name="KP indicator")

    def test_saving_variant_persists_canonical_and_facts(self):
        # Fact sync runs on transaction.on_commit; capture it so the derived
        # facts are built inside this test's transaction.
        with self.captureOnCommitCallbacks(execute=True):
            agg = Aggregate.objects.create(
                indicator=self.indicator, project=self.project, organization=self.org,
                period_start=date(2025, 4, 1), period_end=date(2025, 6, 30),
                value={"disaggregates": {"General population": {"Male": {"20-24": 3}},
                                         "PWIDs": {"Female": {"30-34": 2}}}, "total": 5},
            )
        agg.refresh_from_db()
        self.assertEqual(set(agg.value["disaggregates"].keys()), {"GENERAL POP.", "PWID"})
        primaries = set(AggregateFact.objects.filter(aggregate=agg).values_list("primary", flat=True))
        self.assertEqual(primaries, {"GENERAL POP.", "PWID"})
