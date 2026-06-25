"""Tests for the sub_labels -> aggregate_disaggregation_config bootstrap.

These lock in that ``aggregate_disaggregation_config`` is the single source of
truth: legacy ``sub_labels`` are only ever a *seed* for a real config, the
config the bootstrap produces is always valid, drives the workbook matrix, and
the backfill command is safe (dry-run no-op, idempotent, never overwrites an
existing config, never edits ``sub_labels``).
"""
from io import StringIO

from django.core.management import call_command
from django.test import TestCase

from aggregates.models import Aggregate
from aggregates.reporting_workbook import resolve_matrix_config
from indicators.disaggregation import (
    STANDARD_AGE_BAND_VALUES,
    STANDARD_KP_VALUES,
    STANDARD_SEX_VALUES,
    bootstrap_config,
    config_from_aggregate_data,
    config_from_sub_labels,
    has_enabled_config,
    validate_disaggregation_config,
)
from indicators.models import Indicator
from organizations.models import Organization
from projects.models import Project
from users.models import User


class ConfigFromSubLabelsTests(TestCase):
    def test_known_dimensions_get_standard_values(self):
        cfg, unresolved = config_from_sub_labels(["Key Population", "Sex", "Age Range"])
        self.assertEqual(unresolved, [])
        by_key = {d["key"]: d for d in cfg["dimensions"]}
        self.assertEqual(by_key["sex"]["values"], STANDARD_SEX_VALUES)
        self.assertEqual(by_key["age_band"]["values"], STANDARD_AGE_BAND_VALUES)
        self.assertEqual(by_key["key_population"]["values"], STANDARD_KP_VALUES)
        self.assertTrue(cfg["enabled"])

    def test_age_synonyms_map_to_age_band(self):
        for name in ("Age Range", "Age Band", "Age Group", "age"):
            cfg, _ = config_from_sub_labels([name])
            self.assertEqual(cfg["dimensions"][0]["key"], "age_band")

    def test_unknown_label_is_reported_not_invented(self):
        cfg, unresolved = config_from_sub_labels(["Disaggregate"])
        self.assertEqual(cfg, {})
        self.assertEqual(unresolved, ["Disaggregate"])

    def test_partial_resolution_reports_remainder(self):
        cfg, unresolved = config_from_sub_labels(["Age Range", "Disaggregate"])
        self.assertEqual([d["key"] for d in cfg["dimensions"]], ["age_band"])
        self.assertEqual(unresolved, ["Disaggregate"])

    def test_empty_sub_labels(self):
        self.assertEqual(config_from_sub_labels([]), ({}, []))
        self.assertEqual(config_from_sub_labels(None), ({}, []))

    def test_output_is_always_valid(self):
        cfg, _ = config_from_sub_labels(["Sex", "Age Range", "Key Population"])
        self.assertEqual(validate_disaggregation_config(cfg), cfg)


class ConfigFromDataTests(TestCase):
    def test_recovers_primary_sex_age_from_nested_data(self):
        samples = [{
            "Drop out": {"Male": {"10-14": 1}, "Female": {"15-19": 2}},
            "Discharged": {"Male": {"20-24": 3}},
        }]
        cfg = config_from_aggregate_data(samples, sub_labels=["Disaggregate", "Sex", "Age Range"])
        by_key = {d["key"]: d for d in cfg["dimensions"]}
        self.assertIn("disaggregate", by_key)
        self.assertEqual(by_key["disaggregate"]["values"], ["Drop out", "Discharged"])
        self.assertEqual(by_key["sex"]["values"], STANDARD_SEX_VALUES)
        # Age bands are sorted numerically.
        self.assertEqual(by_key["age_band"]["values"], ["10-14", "15-19", "20-24"])

    def test_totals_only_yields_no_config(self):
        self.assertEqual(config_from_aggregate_data([{}, None], sub_labels=["Age Range"]), {})

    def test_all_placeholder_axis_dropped(self):
        samples = [{"All": {"All": {"10-14": 5, "65+": 1}}}]
        cfg = config_from_aggregate_data(samples, sub_labels=["Age Range"])
        self.assertEqual([d["key"] for d in cfg["dimensions"]], ["age_band"])
        self.assertEqual(cfg["dimensions"][0]["values"], ["10-14", "65+"])

    def test_output_is_always_valid(self):
        samples = [{"X": {"Male": {"10-14": 1}}}]
        cfg = config_from_aggregate_data(samples, sub_labels=["Disaggregate", "Sex"])
        self.assertEqual(validate_disaggregation_config(cfg), cfg)


class BootstrapPrecedenceTests(TestCase):
    def test_existing_config_is_kept(self):
        existing = {"enabled": True, "dimensions": [{"key": "sex", "label": "Sex", "values": ["Male"]}]}
        ind = Indicator(code="C1", name="n", aggregate_disaggregation_config=existing, sub_labels=["Age Range"])
        cfg, unresolved = bootstrap_config(ind, [{"X": {"Male": {"10-14": 1}}}])
        self.assertEqual(cfg, existing)
        self.assertEqual(unresolved, [])

    def test_data_preferred_over_sub_labels(self):
        ind = Indicator(code="C2", name="n", aggregate_disaggregation_config={}, sub_labels=["Sex", "Age Range"])
        cfg, _ = bootstrap_config(ind, [{"All": {"Male": {"10-14": 7}}}])
        # Recovered from data -> only Sex (age present too); came from the data path.
        keys = [d["key"] for d in cfg["dimensions"]]
        self.assertIn("sex", keys)

    def test_sub_labels_used_when_no_data(self):
        ind = Indicator(code="C3", name="n", aggregate_disaggregation_config={}, sub_labels=["Age Range"])
        cfg, _ = bootstrap_config(ind, [])
        self.assertEqual(cfg["dimensions"][0]["values"], STANDARD_AGE_BAND_VALUES)


class WorkbookParityTests(TestCase):
    """A bootstrapped config must drive the workbook matrix exactly like a hand-authored one."""

    def test_bootstrapped_config_drives_matrix(self):
        cfg, _ = config_from_sub_labels(["Sex", "Age Range"])
        ind = Indicator(code="WB1", name="n", aggregate_disaggregation_config=cfg)
        matrix = resolve_matrix_config(ind)
        self.assertTrue(matrix.has_disaggregates)
        self.assertEqual(matrix.secondary_values, STANDARD_SEX_VALUES)
        self.assertEqual(matrix.band_values, STANDARD_AGE_BAND_VALUES)


class BackfillCommandTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.org = Organization.objects.create(name="Org")
        cls.project = Project.objects.create(
            name="Proj", code="P1", start_date="2026-01-01", end_date="2026-12-31")
        cls.user = User.objects.create_user(username="bf", email="bf@x.com", password="P!23456789", role="admin")
        # Legacy indicator: sub_labels, no config, and real captured data.
        cls.legacy = Indicator.objects.create(code="LEG1", name="Legacy", sub_labels=["Sex", "Age Range"])
        Aggregate.objects.create(
            indicator=cls.legacy, project=cls.project, organization=cls.org,
            period_start="2026-01-01", period_end="2026-03-31",
            value={"disaggregates": {"All": {"Male": {"10-14": 4}, "Female": {"15-19": 2}}}, "total": 6},
            created_by=cls.user,
        )
        # Already-configured indicator — must never be touched.
        cls.configured = Indicator.objects.create(
            code="CFG1", name="Configured",
            aggregate_disaggregation_config={"enabled": True, "dimensions": [
                {"key": "sex", "label": "Sex", "values": ["Male", "Female"]}]},
            sub_labels=["Sex"],
        )
        # Unseedable legacy indicator (generic primary, no data).
        cls.unseedable = Indicator.objects.create(code="GEN1", name="Generic", sub_labels=["Disaggregate"])

    def _run(self, *args):
        out = StringIO()
        call_command("backfill_disaggregation_config", *args, stdout=out)
        return out.getvalue()

    def test_dry_run_changes_nothing(self):
        self._run()
        self.legacy.refresh_from_db()
        self.assertFalse(has_enabled_config(self.legacy.aggregate_disaggregation_config))

    def test_apply_seeds_legacy_from_data(self):
        self._run("--apply")
        self.legacy.refresh_from_db()
        self.assertTrue(has_enabled_config(self.legacy.aggregate_disaggregation_config))
        # sub_labels are never modified.
        self.assertEqual(self.legacy.sub_labels, ["Sex", "Age Range"])

    def test_apply_never_overwrites_existing_config(self):
        before = dict(self.configured.aggregate_disaggregation_config)
        self._run("--apply")
        self.configured.refresh_from_db()
        self.assertEqual(self.configured.aggregate_disaggregation_config, before)

    def test_unseedable_reported_and_left_empty(self):
        output = self._run("--apply")
        self.unseedable.refresh_from_db()
        self.assertFalse(has_enabled_config(self.unseedable.aggregate_disaggregation_config))
        self.assertIn("GEN1", output)

    def test_idempotent(self):
        self._run("--apply")
        self.legacy.refresh_from_db()
        first = dict(self.legacy.aggregate_disaggregation_config)
        self._run("--apply")
        self.legacy.refresh_from_db()
        self.assertEqual(self.legacy.aggregate_disaggregation_config, first)


class RepairInvalidConfigTests(TestCase):
    """Lossless dedupe of case-variant duplicate values, preferring data-present variant."""

    @classmethod
    def setUpTestData(cls):
        cls.org = Organization.objects.create(name="O")
        cls.project = Project.objects.create(
            name="P", code="RP1", start_date="2026-01-01", end_date="2026-12-31")
        cls.user = User.objects.create_user(username="rp", email="rp@x.com", password="P!23456789", role="admin")
        # Config carries an uppercase + lowercase variant of the same value; stored
        # data uses the lowercase one.
        cls.ind = Indicator.objects.create(
            code="DUP1", name="Dup",
            aggregate_disaggregation_config={"enabled": True, "layout": "list", "dimensions": [
                {"key": "ncd", "label": "NCD Screening",
                 "values": ["BMI", "Waist Circumference", "Waist circumference"]}]},
        )
        Aggregate.objects.create(
            indicator=cls.ind, project=cls.project, organization=cls.org,
            period_start="2026-01-01", period_end="2026-03-31",
            value={"disaggregates": {"Waist circumference": {"All": {"All": 3}}}, "total": 3},
            created_by=cls.user,
        )

    def _run(self, *args):
        out = StringIO()
        call_command("repair_disaggregation_configs", *args, stdout=out)
        return out.getvalue()

    def test_dry_run_changes_nothing(self):
        self._run()
        self.ind.refresh_from_db()
        self.assertEqual(len(self.ind.aggregate_disaggregation_config["dimensions"][0]["values"]), 3)

    def test_apply_keeps_data_present_variant(self):
        self._run("--apply")
        self.ind.refresh_from_db()
        values = self.ind.aggregate_disaggregation_config["dimensions"][0]["values"]
        self.assertEqual(values, ["BMI", "Waist circumference"])  # lowercase (data) kept
        # Result is now valid.
        self.assertEqual(
            validate_disaggregation_config(self.ind.aggregate_disaggregation_config),
            self.ind.aggregate_disaggregation_config,
        )

    def test_valid_config_untouched(self):
        good = Indicator.objects.create(
            code="OK1", name="ok",
            aggregate_disaggregation_config={"enabled": True, "layout": "list", "dimensions": [
                {"key": "sex", "label": "Sex", "values": ["Male", "Female"]}]})
        self._run("--apply")
        good.refresh_from_db()
        self.assertEqual(good.aggregate_disaggregation_config["dimensions"][0]["values"], ["Male", "Female"])


class ConfigChangeAuditTests(TestCase):
    """Admin config changes are written to the unified audit stream (version history)."""

    @classmethod
    def setUpTestData(cls):
        cls.admin = User.objects.create_user(
            username="cfg_admin", email="ca@x.com", password="P!23456789", role="admin")

    def _patch_config(self, indicator, config):
        from rest_framework.test import APIRequestFactory, force_authenticate

        from indicators.views import IndicatorViewSet
        factory = APIRequestFactory()
        request = factory.patch("/", {"aggregate_disaggregation_config": config}, format="json")
        force_authenticate(request, user=self.admin)
        request.user = self.admin
        view = IndicatorViewSet()
        view.request = request
        view.action = "partial_update"
        view.format_kwarg = None
        serializer = view.get_serializer(indicator, data={"aggregate_disaggregation_config": config}, partial=True)
        serializer.is_valid(raise_exception=True)
        view.perform_update(serializer)

    def test_config_change_is_audited(self):
        from audit.models import AuditEvent

        ind = Indicator.objects.create(code="AUD1", name="Audited", created_by=self.admin)
        new_cfg = {"enabled": True, "layout": "list", "dimensions": [
            {"key": "sex", "label": "Sex", "values": ["Male", "Female"]}]}
        self._patch_config(ind, new_cfg)

        events = AuditEvent.objects.filter(object_type="indicator.disaggregation_config", object_id=str(ind.id))
        self.assertEqual(events.count(), 1)
        event = events.first()
        self.assertEqual(event.action, "update")
        self.assertEqual(event.actor, self.admin)
        self.assertEqual(event.metadata["new"], new_cfg)
        self.assertEqual(event.metadata["old"], {})

    def test_unchanged_config_is_not_audited(self):
        from audit.models import AuditEvent

        cfg = {"enabled": True, "layout": "list", "dimensions": [
            {"key": "sex", "label": "Sex", "values": ["Male", "Female"]}]}
        ind = Indicator.objects.create(
            code="AUD2", name="Audited2", aggregate_disaggregation_config=cfg, created_by=self.admin)
        self._patch_config(ind, cfg)
        self.assertEqual(
            AuditEvent.objects.filter(object_type="indicator.disaggregation_config", object_id=str(ind.id)).count(),
            0,
        )
