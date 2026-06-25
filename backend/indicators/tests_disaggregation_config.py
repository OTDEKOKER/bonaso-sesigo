"""Tests for admin-configurable indicator disaggregation (single source of truth)."""
from django.test import TestCase
from rest_framework import serializers as drf_serializers
from rest_framework.exceptions import PermissionDenied
from rest_framework.test import APIRequestFactory, force_authenticate

from aggregates.reporting_workbook import resolve_matrix_config
from indicators.disaggregation import validate_disaggregation_config
from indicators.models import Indicator
from indicators.serializers import IndicatorSerializer
from users.models import User


def _ctx(user):
    req = APIRequestFactory().patch("/")
    force_authenticate(req, user=user)
    req.user = user
    return {"request": req}


class ValidationRuleTests(TestCase):
    def test_empty_config_is_valid(self):
        self.assertEqual(validate_disaggregation_config({}), {})
        self.assertEqual(validate_disaggregation_config(None), {})

    def test_enabled_must_be_bool(self):
        with self.assertRaises(drf_serializers.ValidationError):
            validate_disaggregation_config({"enabled": "yes", "dimensions": []})

    def test_enabled_requires_a_dimension(self):
        with self.assertRaises(drf_serializers.ValidationError):
            validate_disaggregation_config({"enabled": True, "dimensions": []})

    def test_dimension_requires_key_label_values(self):
        for bad in (
            {"enabled": True, "dimensions": [{"label": "Sex", "values": ["M"]}]},     # no key
            {"enabled": True, "dimensions": [{"key": "sex", "values": ["M"]}]},        # no label
            {"enabled": True, "dimensions": [{"key": "sex", "label": "Sex", "values": []}]},  # empty values
        ):
            with self.assertRaises(drf_serializers.ValidationError):
                validate_disaggregation_config(bad)

    def test_duplicate_dimension_key_rejected(self):
        with self.assertRaises(drf_serializers.ValidationError):
            validate_disaggregation_config({"enabled": True, "dimensions": [
                {"key": "sex", "label": "Sex", "values": ["M"]},
                {"key": "sex", "label": "Gender", "values": ["F"]},
            ]})

    def test_duplicate_dimension_label_rejected(self):
        with self.assertRaises(drf_serializers.ValidationError):
            validate_disaggregation_config({"enabled": True, "dimensions": [
                {"key": "sex", "label": "Sex", "values": ["M"]},
                {"key": "gender", "label": "Sex", "values": ["F"]},
            ]})

    def test_duplicate_values_rejected(self):
        with self.assertRaises(drf_serializers.ValidationError):
            validate_disaggregation_config({"enabled": True, "dimensions": [
                {"key": "sex", "label": "Sex", "values": ["Male", "Male"]},
            ]})

    def test_valid_config_passes(self):
        cfg = {"enabled": True, "dimensions": [
            {"key": "sex", "label": "Sex", "values": ["Male", "Female"]},
            {"key": "age_band", "label": "Age Range", "values": ["10-14", "15-19"]},
        ]}
        self.assertEqual(validate_disaggregation_config(cfg), cfg)


class AdminGateTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.admin = User.objects.create_user(username="dc_admin", email="a@x.com", password="P!23456789", role="admin")
        cls.officer = User.objects.create_user(username="dc_off", email="o@x.com", password="P!23456789", role="officer")
        cls.ind = Indicator.objects.create(name="Reached", code="DC_IND", type="number")
        cls.cfg = {"enabled": True, "dimensions": [{"key": "sex", "label": "Sex", "values": ["Male", "Female"]}]}

    def test_admin_can_set_config(self):
        s = IndicatorSerializer(self.ind, data={"aggregate_disaggregation_config": self.cfg}, partial=True, context=_ctx(self.admin))
        self.assertTrue(s.is_valid(), s.errors)
        s.save()
        self.ind.refresh_from_db()
        self.assertTrue(self.ind.aggregate_disaggregation_config["enabled"])

    def test_non_admin_cannot_change_config(self):
        s = IndicatorSerializer(self.ind, data={"aggregate_disaggregation_config": self.cfg}, partial=True, context=_ctx(self.officer))
        self.assertTrue(s.is_valid(), s.errors)
        with self.assertRaises(PermissionDenied):
            s.save()

    def test_non_admin_can_edit_other_fields_without_touching_config(self):
        s = IndicatorSerializer(self.ind, data={"description": "updated"}, partial=True, context=_ctx(self.officer))
        self.assertTrue(s.is_valid(), s.errors)
        s.save()  # no PermissionDenied
        self.ind.refresh_from_db()
        self.assertEqual(self.ind.description, "updated")

    def test_invalid_config_rejected_at_serializer(self):
        bad = {"enabled": True, "dimensions": [{"key": "sex", "label": "Sex", "values": []}]}
        s = IndicatorSerializer(self.ind, data={"aggregate_disaggregation_config": bad}, partial=True, context=_ctx(self.admin))
        self.assertFalse(s.is_valid())
        self.assertIn("aggregate_disaggregation_config", s.errors)


class DenominatorTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.admin = User.objects.create_user(username="dn_admin", email="da@x.com", password="P!23456789", role="admin")
        cls.officer = User.objects.create_user(username="dn_off", email="do@x.com", password="P!23456789", role="officer")
        cls.eligible = Indicator.objects.create(name="Eligible for testing", code="DN_ELIG", type="number")
        cls.referred = Indicator.objects.create(name="Referred for HIV testing", code="DN_REF", type="percentage")

    def test_admin_can_set_denominator(self):
        s = IndicatorSerializer(self.referred, data={"denominator_indicator": self.eligible.id},
                                partial=True, context=_ctx(self.admin))
        self.assertTrue(s.is_valid(), s.errors)
        s.save()
        self.referred.refresh_from_db()
        self.assertEqual(self.referred.denominator_indicator_id, self.eligible.id)

    def test_denominator_detail_serialized(self):
        self.referred.denominator_indicator = self.eligible
        self.referred.save()
        data = IndicatorSerializer(self.referred, context=_ctx(self.admin)).data
        self.assertEqual(data["denominator_indicator"], self.eligible.id)
        self.assertEqual(data["denominator_indicator_detail"]["code"], "DN_ELIG")

    def test_non_admin_cannot_change_denominator(self):
        s = IndicatorSerializer(self.referred, data={"denominator_indicator": self.eligible.id},
                                partial=True, context=_ctx(self.officer))
        self.assertTrue(s.is_valid(), s.errors)
        with self.assertRaises(PermissionDenied):
            s.save()

    def test_indicator_cannot_be_own_denominator(self):
        s = IndicatorSerializer(self.referred, data={"denominator_indicator": self.referred.id},
                                partial=True, context=_ctx(self.admin))
        self.assertFalse(s.is_valid())
        self.assertIn("denominator_indicator", s.errors)


class SourceOfTruthTests(TestCase):
    def test_workbook_uses_saved_config(self):
        ind = Indicator.objects.create(
            name="KP reach", code="DC_KP", type="number",
            aggregate_disaggregation_config={"enabled": True, "dimensions": [
                {"key": "key_population", "label": "Key Population", "values": ["FSW", "MSM"]},
                {"key": "sex", "label": "Sex", "values": ["Male", "Female"]},
            ]},
        )
        cfg = resolve_matrix_config(ind)
        self.assertTrue(cfg.has_disaggregates)
        self.assertEqual(cfg.primary_values, ["FSW", "MSM"])      # from saved config
        self.assertEqual(cfg.secondary_values, ["Male", "Female"])

    def test_percentage_indicator_resolves_as_value(self):
        # Percentage indicators use their config (disaggregated numerator counts),
        # NOT a single rate cell.
        ind = Indicator.objects.create(
            name="% referred for testing", code="DC_PCT", type="percentage",
            aggregate_disaggregation_config={"enabled": True, "dimensions": [
                {"key": "sex", "label": "Sex", "values": ["Male", "Female"]},
                {"key": "age_band", "label": "Age Range", "values": ["15-19", "20-24"]},
            ]},
        )
        cfg = resolve_matrix_config(ind)
        self.assertTrue(cfg.has_disaggregates)          # resolves as a value, not single rate
        self.assertEqual(cfg.secondary_values, ["Male", "Female"])

    def test_no_config_no_disaggregation(self):
        ind = Indicator.objects.create(name="Plain", code="DC_PLAIN", type="number",
                                       aggregate_disaggregation_config={}, sub_labels=["Sex"])
        cfg = resolve_matrix_config(ind)
        # Backend workbook is config-driven; empty config → single value cell.
        # (Legacy sub_labels remain a FRONTEND fallback only.)
        self.assertFalse(cfg.has_disaggregates)
