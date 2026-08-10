"""Training/live isolation for flags (incident 2026-08-10).

A Flag has no is_training of its own; its environment follows the polymorphic
subject it points at. These tests pin the fixed behaviour: Training Mode shows
only flags on training-project subjects, Live excludes them.
"""
from datetime import date

from django.test import TestCase
from rest_framework.test import APIRequestFactory

from organizations.models import Organization
from projects.models import Project
from indicators.models import Indicator
from aggregates.models import Aggregate
from flags.models import Flag
from flags.views import apply_flag_training_filter


class FlagTrainingIsolationTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.org = Organization.objects.create(name="Org A", code="ORGA")
        cls.ind = Indicator.objects.create(name="Ind", code="IND1")
        cls.live = Project.objects.create(
            name="Live", code="LIVE", start_date=date(2026, 1, 1),
            end_date=date(2026, 12, 31), is_training=False)
        cls.train = Project.objects.create(
            name="Train", code="TRAIN", start_date=date(2026, 1, 1),
            end_date=date(2026, 12, 31), is_training=True)
        cls.agg_live = Aggregate.objects.create(
            indicator=cls.ind, organization=cls.org, project=cls.live,
            period_start=date(2026, 1, 1), period_end=date(2026, 3, 31), value={"total": 1})
        cls.agg_train = Aggregate.objects.create(
            indicator=cls.ind, organization=cls.org, project=cls.train,
            period_start=date(2026, 1, 1), period_end=date(2026, 3, 31), value={"total": 1})
        Flag.objects.create(content_type="aggregate", object_id=cls.agg_live.id,
                            organization=cls.org, title="LIVE", description="d")
        Flag.objects.create(content_type="aggregate", object_id=cls.agg_train.id,
                            organization=cls.org, title="TRAIN", description="d")

    def _titles(self, mode):
        req = APIRequestFactory().get("/api/flags/")
        req._auth = {"mode": mode}  # mirrors a verified JWT mode claim
        req.query_params = req.GET
        return set(
            apply_flag_training_filter(Flag.objects.all(), req).values_list("title", flat=True)
        )

    def test_training_shows_only_training_flags(self):
        self.assertEqual(self._titles("training"), {"TRAIN"})

    def test_live_excludes_training_flags(self):
        self.assertEqual(self._titles("live"), {"LIVE"})
