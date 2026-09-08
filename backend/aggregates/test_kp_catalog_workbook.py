"""KP catalog: canonical key-population order + valid sexes in the workbook.

Verifies (render-level, no file generation) that:
  * KP values render in the canonical order (MSM … GENERAL POP. last), regardless
    of the order stored in the indicator's config;
  * the meaningless MSM-Female and FSW-Male combinations are dropped;
  * every other KP keeps both sexes;
  * a non-KP primary axis is completely unaffected.
None of this changes stored (primary, secondary, band) keys.
"""
from __future__ import annotations

from django.test import TestCase

from indicators.models import Indicator
from indicators.disaggregation import STANDARD_KP_VALUES, kp_order_index, kp_valid_sexes
from aggregates import reporting_workbook as rw


def _kp_indicator():
    return Indicator.objects.create(
        code="KP-CAT-1", name="People reached (KP)",
        aggregate_disaggregation_config={
            "enabled": True,
            "dimensions": [
                # Stored in a deliberately non-canonical order (GENERAL POP. first).
                {"key": "key_population", "label": "Key Population",
                 "values": ["GENERAL POP.", "FSW", "MSM", "PWID", "PWUD", "PWD", "LGBTQI+"]},
                {"key": "sex", "label": "Sex", "values": ["Male", "Female"]},
                {"key": "age_band", "label": "Age Range", "values": ["10-14", "15-19"]},
            ],
        },
    )


class KpCatalogTest(TestCase):
    def test_catalog_constants(self):
        self.assertEqual(STANDARD_KP_VALUES,
                         ["MSM", "FSW", "PWD", "PWID", "PWUD", "LGBTQI+", "GENERAL POP."])
        self.assertEqual(kp_valid_sexes("MSM", ["Male", "Female"]), ["Male"])
        self.assertEqual(kp_valid_sexes("FSW", ["Male", "Female"]), ["Female"])
        self.assertEqual(kp_valid_sexes("PWID", ["Male", "Female"]), ["Male", "Female"])
        # Unknown KP / alias handling: canonicalises before lookup.
        self.assertEqual(kp_valid_sexes("General Population", ["Male", "Female"]), ["Male", "Female"])

    def test_kp_reordered_to_canonical(self):
        cfg = rw.resolve_matrix_config(_kp_indicator())
        self.assertTrue(cfg.primary_is_kp)
        self.assertTrue(cfg.secondary_is_sex)
        self.assertEqual(
            cfg.primary_values,
            ["MSM", "FSW", "PWD", "PWID", "PWUD", "LGBTQI+", "GENERAL POP."],
        )

    def test_msm_male_only_fsw_female_only(self):
        cfg = rw.resolve_matrix_config(_kp_indicator())
        self.assertEqual(cfg.secondaries_for("MSM"), ["Male"])
        self.assertEqual(cfg.secondaries_for("FSW"), ["Female"])
        self.assertEqual(cfg.secondaries_for("PWID"), ["Male", "Female"])
        self.assertEqual(cfg.secondaries_for("GENERAL POP."), ["Male", "Female"])

    def test_iter_cells_excludes_invalid_combos(self):
        cfg = rw.resolve_matrix_config(_kp_indicator())
        combos = {(p, s) for p, s, _b in rw.iter_cells(cfg)}
        self.assertNotIn(("MSM", "Female"), combos)   # dropped
        self.assertNotIn(("FSW", "Male"), combos)     # dropped
        self.assertIn(("MSM", "Male"), combos)        # kept
        self.assertIn(("FSW", "Female"), combos)      # kept
        self.assertIn(("PWID", "Male"), combos)
        self.assertIn(("PWID", "Female"), combos)

    def test_non_kp_primary_unaffected(self):
        ind = Indicator.objects.create(
            code="SVC-1", name="By service type",
            aggregate_disaggregation_config={
                "enabled": True,
                "dimensions": [
                    {"key": "service_type", "label": "Service Type", "values": ["HTS", "PrEP"]},
                    {"key": "sex", "label": "Sex", "values": ["Male", "Female"]},
                ],
            },
        )
        cfg = rw.resolve_matrix_config(ind)
        self.assertFalse(cfg.primary_is_kp)
        # No restriction: both sexes for every non-KP primary.
        self.assertEqual(cfg.secondaries_for("HTS"), ["Male", "Female"])
        self.assertEqual(cfg.secondaries_for("PrEP"), ["Male", "Female"])
