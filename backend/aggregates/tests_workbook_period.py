"""Tests for workbook period types (quarter / year / month)."""
from datetime import date

from django.test import SimpleTestCase

from aggregates import reporting_workbook as rw


class PeriodResolutionTests(SimpleTestCase):
    def test_year_period(self):
        s, e, label = rw.resolve_period("year", fiscal_start_year=2026)
        self.assertEqual((s, e), (date(2026, 4, 1), date(2027, 3, 31)))
        self.assertEqual(label, "FY 2026/27")

    def test_month_period(self):
        s, e, label = rw.resolve_period("month", month=4, calendar_year=2026)
        self.assertEqual((s, e), (date(2026, 4, 1), date(2026, 4, 30)))
        self.assertEqual(label, "April 2026")
        # February leap-year end
        s2, e2, _ = rw.resolve_period("month", month=2, calendar_year=2028)
        self.assertEqual(e2, date(2028, 2, 29))

    def test_quarter_period_default(self):
        s, e, label = rw.resolve_period("quarter", quarter=3, fiscal_start_year=2025)
        self.assertEqual((s, e), (date(2025, 10, 1), date(2025, 12, 31)))
        self.assertEqual(label, "Q3 2025/26")

    def test_fiscal_year_of_month(self):
        self.assertEqual(rw.fiscal_year_of_month(4, 2026), 2026)   # Apr → FY 2026
        self.assertEqual(rw.fiscal_year_of_month(3, 2026), 2025)   # Mar → FY 2025
        self.assertEqual(rw.fiscal_year_of_month(1, 2026), 2025)   # Jan → FY 2025

    def test_invalid_month_rejected(self):
        with self.assertRaises(ValueError):
            rw.month_period_range(13, 2026)
