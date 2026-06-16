"""Regression tests for the monthly-payload-parity comparator.

Guards the 2026-06-17 fix in ``scripts/verify_monthly_payload_parity.py``:
count-by-category indicators (e.g. 366, "Number of target specific demand
creation activities conducted") are not age-disaggregated. The importer stores
their breakdown under a generic ``"Value"`` leaf, while the parity verifier
reconstructs the identical count under the org's single age band (``"18-24"``).
That cosmetic leaf-key difference used to raise a false ``payload_mismatch``
that turned the System Status board red (APSA Q3/Q4). ``normalize_for_compare``
now collapses a *singleton* innermost age-band leaf so the two representations
compare equal, while real (multi-band) age disaggregation still surfaces.
"""
import importlib
import os
import sys

from django.conf import settings
from django.test import SimpleTestCase

_SCRIPTS_DIR = os.path.join(settings.BASE_DIR, "scripts")
if _SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, _SCRIPTS_DIR)

parity = importlib.import_module("verify_monthly_payload_parity")
norm = parity.normalize_for_compare


class ParityNormalizeTests(SimpleTestCase):
    def test_value_sentinel_equals_single_age_band(self):
        # The core fix: a non-age count stored under "Value" equals the same
        # count reconstructed under one age band.
        self.assertEqual(norm({"All": {"Value": 5}}), norm({"All": {"18-24": 5}}))

    def test_full_count_by_category_payload_matches_across_leaf_naming(self):
        db = {"male": 0, "female": 0, "total": 45, "disaggregates": {
            "Marathons": {"All": {"Value": 1}},
            "Health Talks": {"All": {"Value": 8}},
            "Mall Activations": {"All": {"Value": 13}},
            "Street Interactions": {"All": {"Value": 14}},
            "Commemorations": {"All": {"Value": 5}},
            "Door to door": {"All": {"Value": 4}},
        }}
        workbook = {"male": 0, "female": 0, "total": 45, "disaggregates": {
            "Marathons": {"All": {"18-24": 1}},
            "Health Talks": {"All": {"18-24": 8}},
            "Mall Activations": {"All": {"18-24": 13}},
            "Street Interactions": {"All": {"18-24": 14}},
            "Commemorations": {"All": {"18-24": 5}},
            "Door to door": {"All": {"18-24": 4}},
        }}
        self.assertEqual(norm(db), norm(workbook))

    def test_multi_band_age_disaggregation_still_surfaces(self):
        # A genuine age split must NOT be collapsed — a real mismatch stays a
        # mismatch (5+3 spread across two bands vs a single 8 are different).
        self.assertNotEqual(
            norm({"All": {"18-24": 5, "25-49": 3}}),
            norm({"All": {"18-24": 8}}),
        )

    def test_singleton_sex_or_category_leaf_not_collapsed(self):
        # Only innermost *age-band* leaves collapse; sex buckets and service
        # categories (no digit, not the "Value" sentinel) keep their keys.
        self.assertNotEqual(norm({"Male": 5}), norm({"Female": 5}))
        self.assertEqual(norm({"Male": 5}), {"Male": 5})

    def test_is_age_band_leaf_key_classification(self):
        self.assertTrue(parity._is_age_band_leaf_key("Value"))
        self.assertTrue(parity._is_age_band_leaf_key("18-24"))
        self.assertTrue(parity._is_age_band_leaf_key("50+"))
        self.assertFalse(parity._is_age_band_leaf_key("Male"))
        self.assertFalse(parity._is_age_band_leaf_key("Mall Activations"))
