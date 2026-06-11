"""Tests for single-year → five-year age-group folding (rollup/analysis)."""
from django.test import SimpleTestCase

from analysis.services.age_bands import (
    fold_single_ages_into_age_groups,
    is_single_age_label,
    single_age_group_label,
)


class SingleAgeGroupLabelTests(SimpleTestCase):
    def test_single_year_maps_to_five_year_group(self):
        self.assertEqual(single_age_group_label("10"), "10-14")
        self.assertEqual(single_age_group_label("12"), "10-14")
        self.assertEqual(single_age_group_label("14"), "10-14")
        self.assertEqual(single_age_group_label("15"), "15-19")
        self.assertEqual(single_age_group_label("17"), "15-19")
        self.assertEqual(single_age_group_label("64"), "60-64")

    def test_sixty_five_plus_is_open_band(self):
        self.assertEqual(single_age_group_label("65"), "65+")
        self.assertEqual(single_age_group_label("70"), "65+")

    def test_group_and_open_labels_are_not_single_ages(self):
        self.assertIsNone(single_age_group_label("10-14"))
        self.assertIsNone(single_age_group_label("65+"))
        self.assertIsNone(single_age_group_label("GENERAL POP."))
        self.assertFalse(is_single_age_label("10-14"))
        self.assertTrue(is_single_age_label("12"))


class FoldSingleAgesTests(SimpleTestCase):
    def test_single_years_sum_into_existing_group(self):
        node = {"10": 1, "11": 2, "12": 3, "13": 0, "14": 4, "10-14": 5}
        # 1+2+3+0+4 folded into the existing 10-14 (=5) -> 15.
        self.assertEqual(fold_single_ages_into_age_groups(node), {"10-14": 15})

    def test_single_years_create_group_when_absent(self):
        node = {"15": 2, "17": 3, "19": 5}
        self.assertEqual(fold_single_ages_into_age_groups(node), {"15-19": 10})

    def test_folds_inside_nested_disaggregates(self):
        value = {
            "disaggregates": {
                "GENERAL POP.": {
                    "Male": {"10": 1, "12": 2, "10-14": 0, "15-19": 4},
                    "Female": {"15": 3, "16": 1},
                },
            },
            "total": 11,
        }
        folded = fold_single_ages_into_age_groups(value)
        self.assertEqual(
            folded["disaggregates"]["GENERAL POP."]["Male"], {"10-14": 3, "15-19": 4}
        )
        self.assertEqual(folded["disaggregates"]["GENERAL POP."]["Female"], {"15-19": 4})
        # Non-age structure (total, key-population, sex keys) is preserved.
        self.assertEqual(folded["total"], 11)

    def test_input_is_not_mutated(self):
        node = {"10": 1, "10-14": 1}
        snapshot = {"10": 1, "10-14": 1}
        fold_single_ages_into_age_groups(node)
        self.assertEqual(node, snapshot)

    def test_groups_only_passthrough(self):
        node = {"10-14": 5, "15-19": 6, "65+": 2}
        self.assertEqual(fold_single_ages_into_age_groups(node), node)
