"""Regression tests for age-band label normalization in the reporting workbook.

Partner data stored the same age band under inconsistent spellings ("0 - 4" vs
"0-4", "5- 10" vs "5-10", "30 -39" vs "30-39"), which rendered one band as two
near-identical columns. The generator now collapses whitespace around the hyphen
so those spellings map to a single band — without changing band ranges, so
intentionally different ranges (e.g. social-media age ranges) are untouched.
"""
from types import SimpleNamespace

from django.test import SimpleTestCase

from aggregates import reporting_workbook as rw


class NormalizeBandLabelTests(SimpleTestCase):
    def test_whitespace_variants_collapse(self):
        self.assertEqual(rw.normalize_band_label("0 - 4"), "0-4")
        self.assertEqual(rw.normalize_band_label("5- 10"), "5-10")
        self.assertEqual(rw.normalize_band_label("30 -39"), "30-39")
        self.assertEqual(rw.normalize_band_label("60 - 69"), "60-69")

    def test_ranges_and_open_bands_unchanged(self):
        # Boundaries/labels themselves must not change — only whitespace.
        for label in ("0-4", "18-24", "65+", "90+", "Value"):
            self.assertEqual(rw.normalize_band_label(label), label)

    def _indicator(self, age_values):
        return SimpleNamespace(
            type="number",
            aggregate_disaggregation_config={
                "enabled": True,
                "dimensions": [{"label": "Age", "values": age_values}],
            },
        )

    def test_resolve_matrix_config_dedupes_normalized_bands(self):
        cfg = rw.resolve_matrix_config(
            self._indicator(["0 - 4", "0-4", "5- 10", "5-10", "30 -39"])
        )
        self.assertEqual(cfg.band_values, ["0-4", "5-10", "30-39"])

    def test_extract_cells_merges_duplicate_band_spellings(self):
        cfg = rw.resolve_matrix_config(self._indicator(["0-4", "5-10"]))
        primary = cfg.primary_values[0]
        secondary = cfg.secondary_values[0]
        value = {
            "disaggregates": {
                primary: {secondary: {"0 - 4": 3, "0-4": 5, "5-10": 2}},
            },
            "total": 10,
        }
        cells = rw.extract_cells_from_value(value, cfg)
        # "0 - 4" (3) + "0-4" (5) merge into one "0-4" cell = 8; total preserved.
        self.assertEqual(cells[(primary, secondary, "0-4")], 8)
        self.assertEqual(cells[(primary, secondary, "5-10")], 2)
        self.assertEqual(sum(cells.values()), 10)
