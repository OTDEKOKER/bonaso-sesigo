"""Regression tests for audit finding S-2: announcement read isolation.

Announcement writes were already boundary-checked (H4), but the read queryset
applied no training filter, so a project-scoped training announcement leaked
into live views (and vice versa). get_queryset now runs apply_training_filter.
"""
from datetime import date

from django.test import TestCase
from django.contrib.auth import get_user_model
from rest_framework.test import APIRequestFactory
from rest_framework.request import Request

from projects.models import Project
from messaging.models import Announcement
from messaging.views import AnnouncementViewSet

User = get_user_model()


class AnnouncementIsolationTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.admin = User.objects.create_user(
            username="ann_admin", password="x", is_superuser=True, is_staff=True, role="admin"
        )
        cls.live_proj = Project.objects.create(
            name="Live P", code="ANN-LIVE-P", status="active",
            start_date=date(2026, 1, 1), end_date=date(2026, 12, 31), is_training=False)
        cls.train_proj = Project.objects.create(
            name="Demo P", code="ANN-DEMO-P", status="active",
            start_date=date(2026, 1, 1), end_date=date(2026, 12, 31), is_training=True)

        cls.global_ann = Announcement.objects.create(title="Global", content="g", scope="global")
        cls.live_ann = Announcement.objects.create(
            title="LiveAnn", content="l", scope="project", project=cls.live_proj)
        cls.train_ann = Announcement.objects.create(
            title="TrainAnn", content="t", scope="project", project=cls.train_proj)

    def _titles(self, mode=None):
        r = Request(APIRequestFactory().get("/api/announcements/"))
        r.user = self.admin
        if mode is not None:
            r._auth = {"mode": mode}
        v = AnnouncementViewSet()
        v.request = r
        v.kwargs = {}
        v.format_kwarg = None
        v.action = "list"
        return set(v.get_queryset().values_list("title", flat=True))

    def test_live_view_hides_training_announcement(self):
        titles = self._titles(mode="live")
        self.assertIn("Global", titles)
        self.assertIn("LiveAnn", titles)
        self.assertNotIn("TrainAnn", titles)

    def test_training_view_hides_live_announcement(self):
        titles = self._titles(mode="training")
        self.assertIn("TrainAnn", titles)
        self.assertNotIn("LiveAnn", titles)
        self.assertNotIn("Global", titles)

    def test_legacy_no_claim_defaults_to_live(self):
        titles = self._titles(mode=None)
        self.assertIn("LiveAnn", titles)
        self.assertNotIn("TrainAnn", titles)
