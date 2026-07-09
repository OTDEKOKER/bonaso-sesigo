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


class QuarterCompletionRuleTests(SimpleTestCase):
    """The quarter-completion rule SSoT: a period may only open the day after it
    fully elapses (Q1 Apr-Jun → 1 Jul, Q2 Jul-Sep → 1 Oct, …)."""

    def test_earliest_open_dates_match_spec(self):
        cases = {
            (date(2025, 4, 1), date(2025, 6, 30)): date(2025, 7, 1),    # Q1 → 1 Jul
            (date(2025, 7, 1), date(2025, 9, 30)): date(2025, 10, 1),   # Q2 → 1 Oct
            (date(2025, 10, 1), date(2025, 12, 31)): date(2026, 1, 1),  # Q3 → 1 Jan
            (date(2026, 1, 1), date(2026, 3, 31)): date(2026, 4, 1),    # Q4 → 1 Apr
        }
        for (start, end), expected_open in cases.items():
            self.assertEqual(rw.earliest_reporting_open_date(end), expected_open)
            self.assertEqual(rw.quarter_of_period(start, end)[0],
                             {4: 1, 7: 2, 10: 3, 1: 4}[start.month])

    def test_not_eligible_until_period_ends(self):
        end = date(2025, 9, 30)  # Q2
        self.assertFalse(rw.period_has_fully_elapsed(end, today=date(2025, 9, 30)))
        self.assertFalse(rw.period_has_fully_elapsed(end, today=date(2025, 9, 29)))
        self.assertTrue(rw.period_has_fully_elapsed(end, today=date(2025, 10, 1)))

    def test_q2_message_matches_spec(self):
        msg = rw.reporting_not_yet_eligible_message(date(2025, 7, 1), date(2025, 9, 30))
        self.assertEqual(
            msg,
            "Q2 reporting cannot be opened yet because the reporting quarter has "
            "not ended. Q2 may only open from 1 October 2025.",
        )

    def test_non_quarter_period_gets_generic_message(self):
        # A single month is not a canonical quarter → generic (still blocked) msg.
        self.assertIsNone(rw.quarter_of_period(date(2025, 8, 1), date(2025, 8, 31)))
        msg = rw.reporting_not_yet_eligible_message(date(2025, 8, 1), date(2025, 8, 31))
        self.assertIn("cannot be opened yet", msg)
        self.assertIn("1 September 2025", msg)

    def test_helpers_accept_iso_strings_and_datetimes(self):
        from datetime import datetime
        self.assertTrue(rw.period_has_fully_elapsed("2025-06-30", today="2025-08-01"))
        self.assertEqual(
            rw.earliest_reporting_open_date(datetime(2025, 6, 30, 12, 0)),
            date(2025, 7, 1),
        )
