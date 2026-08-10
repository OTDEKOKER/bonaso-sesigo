"""Training/live isolation for the respondent list (incident 2026-08-10).

A Respondent carries no is_training; its mode is defined by its interactions'
projects. Training Mode must show only respondents seen in training; Live must
exclude training-only respondents but keep those with no interactions yet.
"""
from datetime import date

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIRequestFactory

from organizations.models import Organization
from projects.models import Project
from respondents.models import Respondent, Interaction
from respondents.views import RespondentViewSet

User = get_user_model()


class RespondentTrainingIsolationTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.org = Organization.objects.create(name="Org A", code="ORGA")
        cls.live = Project.objects.create(
            name="Live", code="LIVE", start_date=date(2026, 1, 1),
            end_date=date(2026, 12, 31), is_training=False)
        cls.train = Project.objects.create(
            name="Train", code="TRAIN", start_date=date(2026, 1, 1),
            end_date=date(2026, 12, 31), is_training=True)
        cls.admin = User.objects.create_user(
            username="admin", password="x", is_staff=True, is_superuser=True)
        cls.r_live = Respondent.objects.create(
            unique_id="R-LIVE", first_name="L", last_name="L", organization=cls.org)
        cls.r_train = Respondent.objects.create(
            unique_id="R-TRAIN", first_name="T", last_name="T", organization=cls.org)
        cls.r_none = Respondent.objects.create(
            unique_id="R-NONE", first_name="N", last_name="N", organization=cls.org)
        Interaction.objects.create(respondent=cls.r_live, project=cls.live, date=date(2026, 2, 1))
        Interaction.objects.create(respondent=cls.r_train, project=cls.train, date=date(2026, 2, 1))

    def _ids(self, mode):
        req = APIRequestFactory().get("/api/respondents/")
        req._auth = {"mode": mode}
        req.query_params = req.GET  # DRF adds this during dispatch; supply it here
        req.user = self.admin  # admin → isolates the training dimension (no org/project narrowing)
        view = RespondentViewSet()
        view.request = req
        view.action = "list"
        view.format_kwarg = None
        return set(view.get_queryset().values_list("unique_id", flat=True))

    def test_training_shows_only_training_respondents(self):
        self.assertEqual(self._ids("training"), {"R-TRAIN"})

    def test_live_shows_live_and_uninteracted_respondents(self):
        self.assertEqual(self._ids("live"), {"R-LIVE", "R-NONE"})
