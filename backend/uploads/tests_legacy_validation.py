"""Regression: legacy import paths must validate every value before writing.

Both legacy importers (the production subprocess
``frontend/scripts/import_selected_q3_workbook.py`` and the
``import_reporting_workbook_overwrite`` management command) write aggregates
directly, bypassing the DRF serializer. They now call
``validate_aggregate_value`` before each write so an invalid value can never be
persisted. These tests lock in (a) the rejection contract the guards rely on and
(b) that the guard call stays wired into both files.
"""
from pathlib import Path

from django.conf import settings
from django.test import SimpleTestCase
from rest_framework import serializers

from aggregates.validation import MAX_AGGREGATE_VALUE, validate_aggregate_value


class _Pct:
    type = "percentage"


class ValidatorContractTests(SimpleTestCase):
    def test_rejects_negative(self):
        with self.assertRaises(serializers.ValidationError):
            validate_aggregate_value({"total": -5})

    def test_percentage_resolves_as_value_not_capped(self):
        # Percentage indicators now store disaggregated COUNTS (% computed
        # downstream), so count values > 100 are accepted, not rejected.
        self.assertEqual(validate_aggregate_value({"total": 150}, indicator=_Pct()), {"total": 150})

    def test_rejects_overflow(self):
        with self.assertRaises(serializers.ValidationError):
            validate_aggregate_value(MAX_AGGREGATE_VALUE + 1)

    def test_rejects_non_numeric(self):
        with self.assertRaises(serializers.ValidationError):
            validate_aggregate_value({"total": "abc"})

    def test_accepts_valid(self):
        self.assertEqual(validate_aggregate_value({"total": 10}), {"total": 10})


class GuardWiringTests(SimpleTestCase):
    """The validation call must remain present in both legacy write paths."""

    def _read(self, rel_from_backend):
        return Path(settings.BASE_DIR).joinpath(rel_from_backend).read_text(encoding="utf-8", errors="ignore")

    def test_overwrite_command_validates(self):
        src = self._read("uploads/management/commands/import_reporting_workbook_overwrite.py")
        self.assertIn("from aggregates.validation import validate_aggregate_value", src)
        self.assertGreaterEqual(src.count("validate_aggregate_value("), 2)  # both write points

    def test_subprocess_importer_validates(self):
        # Lives in frontend/scripts (sibling of the backend BASE_DIR).
        src = Path(settings.BASE_DIR).parent.joinpath(
            "frontend/scripts/import_selected_q3_workbook.py"
        ).read_text(encoding="utf-8", errors="ignore")
        self.assertIn("from aggregates.validation import validate_aggregate_value", src)
        self.assertIn("validate_aggregate_value(item[\"value\"]", src)
