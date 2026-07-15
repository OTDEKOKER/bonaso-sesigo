"""Unit tests for the management-intelligence composition logic.

These cover the pure decision functions (no DB) so they run fast on the
memory-constrained host: pace bucketing, representative-indicator selection, the
zero-vs-not-reported data-state distinction, and prior-period delta.
"""
from django.test import SimpleTestCase

from analysis.services.management_intelligence import (
    pace_status,
    _pick_representative,
    _data_state,
    _delta_vs_prior,
)


class PaceStatusTests(SimpleTestCase):
    def test_buckets(self):
        self.assertEqual(pace_status(None), "pending")
        self.assertEqual(pace_status(120), "ahead")
        self.assertEqual(pace_status(100), "ahead")
        self.assertEqual(pace_status(85), "on_track")
        self.assertEqual(pace_status(60), "behind")
        self.assertEqual(pace_status(10), "at_risk")


class PickRepresentativeTests(SimpleTestCase):
    def test_prefers_most_off_track_measured(self):
        rows = [
            {"achievement_percent": 95, "target_value": 100, "_indicator_id": 1},
            {"achievement_percent": 40, "target_value": 100, "_indicator_id": 2},
            {"achievement_percent": None, "target_value": 100, "_indicator_id": 3},
        ]
        self.assertEqual(_pick_representative(rows)["_indicator_id"], 2)

    def test_falls_back_to_largest_target_when_none_measured(self):
        rows = [
            {"achievement_percent": None, "target_value": 10, "_indicator_id": 1},
            {"achievement_percent": None, "target_value": 500, "_indicator_id": 2},
        ]
        self.assertEqual(_pick_representative(rows)["_indicator_id"], 2)

    def test_empty(self):
        self.assertIsNone(_pick_representative([]))


class DataStateTests(SimpleTestCase):
    def test_not_reported_when_no_contributions(self):
        rep = {"child_contributions": [], "own_contribution": 0.0}
        self.assertEqual(_data_state(rep, 0.0, False), "not_reported")

    def test_zero_reported_distinct_from_not_reported(self):
        # an approved zero from a sub-grantee: has a contribution row but sums to 0
        rep = {"child_contributions": [{"organization_id": 9, "actual_value": 0.0}], "own_contribution": 0.0}
        self.assertEqual(_data_state(rep, 0.0, False), "zero_reported")

    def test_target_pending(self):
        rep = {"child_contributions": [{"actual_value": 5}], "own_contribution": 0.0}
        self.assertEqual(_data_state(rep, 5.0, True), "target_pending")

    def test_approved(self):
        rep = {"child_contributions": [{"actual_value": 5}], "own_contribution": 0.0}
        self.assertEqual(_data_state(rep, 5.0, False), "approved")


class DeltaVsPriorTests(SimpleTestCase):
    def test_none_when_single_point(self):
        self.assertIsNone(_delta_vs_prior([{"actual": 10}]))

    def test_none_when_prior_zero(self):
        self.assertIsNone(_delta_vs_prior([{"actual": 0}, {"actual": 10}]))

    def test_percentage_change(self):
        self.assertEqual(_delta_vs_prior([{"actual": 100}, {"actual": 150}]), 50.0)
