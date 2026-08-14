"""Canonical performance-status SSoT — band + delegation regression tests.

Locks the one vocabulary/threshold set (met/on-track/at-risk/off-track/
untargeted at 100/75/50) that the dashboard, executive view, funder reports and
management intelligence all share. In particular it pins the previously-divergent
case: management_intelligence.pace_status used to call 78% "behind" while the
dashboard called it "on-track" — now both agree on "on-track".
"""
from django.test import SimpleTestCase

from analysis.services.performance_status import (
    classify_performance,
    needs_attention,
    performance_label,
)
from analysis.services.management_intelligence import pace_status


class PerformanceStatusBandsTests(SimpleTestCase):
    def test_bands(self):
        cases = {
            140: "met", 100: "met",
            99.9: "on-track", 80: "on-track", 75: "on-track",
            74.9: "at-risk", 50: "at-risk",
            49.9: "off-track", 0: "off-track",
        }
        for pct, expected in cases.items():
            self.assertEqual(classify_performance(pct), expected, f"{pct}%")

    def test_untargeted_cases(self):
        self.assertEqual(classify_performance(None), "untargeted")
        self.assertEqual(classify_performance(90, targeted=False), "untargeted")
        self.assertEqual(classify_performance(float("nan")), "untargeted")
        self.assertEqual(classify_performance("not-a-number"), "untargeted")

    def test_labels(self):
        self.assertEqual(performance_label("on-track"), "On track")
        self.assertEqual(performance_label("off-track"), "Off track")
        self.assertEqual(performance_label("untargeted"), "No target")

    def test_needs_attention(self):
        self.assertFalse(needs_attention(100))
        self.assertFalse(needs_attention(75))   # on-track is NOT attention
        self.assertTrue(needs_attention(74))    # at-risk
        self.assertTrue(needs_attention(10))    # off-track
        self.assertFalse(needs_attention(None))


class PaceStatusDelegationTests(SimpleTestCase):
    def test_pace_status_uses_canonical_vocabulary(self):
        self.assertEqual(pace_status(120), "met")
        self.assertEqual(pace_status(90), "on-track")
        self.assertEqual(pace_status(60), "at-risk")
        self.assertEqual(pace_status(10), "off-track")
        self.assertEqual(pace_status(None), "untargeted")

    def test_previously_divergent_78_percent_now_on_track(self):
        # Regression: old pace_status returned "behind" (>=50, <80); dashboard
        # said "on-track" (>=75). SSoT unifies both to "on-track".
        self.assertEqual(pace_status(78), "on-track")
        self.assertEqual(classify_performance(78), "on-track")
