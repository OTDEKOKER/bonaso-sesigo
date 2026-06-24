"""Tests for the Data Quality engine (coherence, anomaly, scoring, signatures)."""
from django.test import SimpleTestCase

from aggregates import data_quality as dq


class CoherenceTests(SimpleTestCase):
    def test_coherent_nested_disaggregates(self):
        value = {"total": 90, "disaggregates": {"All": {"Male": {"18-24": 50}, "Female": {"18-24": 40}}}}
        r = dq.coherence_report(value)
        self.assertTrue(r["is_coherent"])
        self.assertTrue(r["checked"])
        self.assertEqual(r["calculated_total"], 90.0)

    def test_mismatch_flagged_with_severity(self):
        # leaves sum to 90 but total claims 100
        value = {"total": 100, "disaggregates": {"All": {"Male": {"18-24": 70}, "Female": {"18-24": 20}}}}
        r = dq.coherence_report(value)
        self.assertFalse(r["is_coherent"])
        self.assertEqual(r["reported_total"], 100.0)
        self.assertEqual(r["calculated_total"], 90.0)
        self.assertEqual(r["difference"], 10.0)
        self.assertIn(r["severity"], (dq.SEVERITY_MEDIUM, dq.SEVERITY_HIGH))

    def test_legacy_male_female_shape(self):
        value = {"total": 10, "male": 7, "female": 2}  # sums to 9, total 10
        r = dq.coherence_report(value)
        self.assertTrue(r["checked"])
        self.assertFalse(r["is_coherent"])
        self.assertEqual(r["calculated_total"], 9.0)

    def test_plain_total_not_checked(self):
        # No disaggregates → nothing to reconcile → coherent, not checked.
        r = dq.coherence_report({"total": 100})
        self.assertTrue(r["is_coherent"])
        self.assertFalse(r["checked"])

    def test_scalar_value_not_checked(self):
        r = dq.coherence_report(42)
        self.assertFalse(r["checked"])


class AnomalyTests(SimpleTestCase):
    def test_sudden_growth(self):
        a = dq.detect_series_anomalies([("Q1", 100), ("Q2", 5000)])
        self.assertEqual(len(a), 1)
        self.assertEqual(a[0].type, "spike")

    def test_sudden_decline(self):
        a = dq.detect_series_anomalies([("Q1", 1000), ("Q2", 5)])
        self.assertEqual(a[0].type, "decline")

    def test_zero_after_activity(self):
        a = dq.detect_series_anomalies([("Q1", 400), ("Q2", 420), ("Q3", 0)])
        types = [x.type for x in a]
        self.assertIn("zero_after_activity", types)

    def test_small_baseline_ignored(self):
        # Below ANOMALY_MIN_BASE → noise, no anomaly.
        self.assertEqual(dq.detect_series_anomalies([("Q1", 2), ("Q2", 19)]), [])

    def test_stable_series_no_anomaly(self):
        self.assertEqual(dq.detect_series_anomalies([("Q1", 100), ("Q2", 110), ("Q3", 105)]), [])


class SignatureTests(SimpleTestCase):
    def test_same_breakdown_same_signature(self):
        v1 = {"disaggregates": {"All": {"Male": {"18-24": 5}, "Female": {"18-24": 3}}}}
        v2 = {"total": 8, "disaggregates": {"All": {"Female": {"18-24": 3}, "Male": {"18-24": 5}}}}
        self.assertEqual(dq.value_signature(v1), dq.value_signature(v2))

    def test_different_breakdown_differs(self):
        v1 = {"disaggregates": {"All": {"Male": {"18-24": 5}}}}
        v2 = {"disaggregates": {"All": {"Male": {"18-24": 6}}}}
        self.assertNotEqual(dq.value_signature(v1), dq.value_signature(v2))

    def test_empty_for_all_zero(self):
        self.assertEqual(dq.value_signature({"total": 0}), "")


class ScoringTests(SimpleTestCase):
    def test_perfect_score(self):
        r = dq.score_from_factors(completeness=100, consistency=100, timeliness=100, review=100, duplicate=100)
        self.assertEqual(r["score"], 100.0)
        self.assertEqual(r["label"], "Excellent")

    def test_labels(self):
        self.assertEqual(dq.quality_label(92), "Excellent")
        self.assertEqual(dq.quality_label(80), "Good")
        self.assertEqual(dq.quality_label(65), "Needs Attention")
        self.assertEqual(dq.quality_label(40), "Poor")

    def test_weighted_blend(self):
        r = dq.score_from_factors(completeness=50, consistency=100, timeliness=100, review=100, duplicate=100)
        # completeness weight 30/100 dropped to 50 → 85
        self.assertEqual(r["score"], 85.0)

    def test_ratio_score(self):
        self.assertEqual(dq.ratio_score(9, 10), 90.0)
        self.assertEqual(dq.ratio_score(0, 0), 100.0)
