from django.test import TestCase
from indicators.models import Indicator, strip_single_year_age_values


class SingleAgeGuardTests(TestCase):
    CFG = {
        "enabled": True,
        "dimensions": [
            {"key": "sex", "label": "Sex", "values": ["Male", "Female"]},
            {"key": "age_band", "label": "Age Range",
             "values": ["10", "10-14", "11", "15-19", "20-24", "65+"]},
        ],
    }

    def test_strip_helper_removes_single_years_keeps_groups(self):
        cfg = strip_single_year_age_values({**self.CFG, "dimensions": [
            dict(self.CFG["dimensions"][0]),
            {"key": "age_band", "label": "Age", "values": ["10", "10-14", "11", "15-19", "65+"]},
        ]})
        age = [d for d in cfg["dimensions"] if d["key"] == "age_band"][0]
        self.assertEqual(age["values"], ["10-14", "15-19", "65+"])

    def test_save_sanitizes_config(self):
        ind = Indicator.objects.create(name="Test reach", code="GUARD_1", type="number",
                                       aggregate_disaggregation_config=self.CFG)
        ind.refresh_from_db()
        age = [d for d in ind.aggregate_disaggregation_config["dimensions"] if d["key"] == "age_band"][0]
        self.assertEqual(age["values"], ["10-14", "15-19", "20-24", "65+"])
        self.assertNotIn("10", age["values"])

    def test_non_age_dimension_untouched(self):
        cfg = strip_single_year_age_values({"dimensions": [
            {"key": "platform", "label": "Platform", "values": ["1", "Facebook", "2"]},
        ]})
        # "platform" is not an age dimension -> bare-number values are NOT stripped
        self.assertEqual(cfg["dimensions"][0]["values"], ["1", "Facebook", "2"])
