"""Regression guard (audit finding S1): every data-bearing viewset that belongs
to a user-assignable module must declare ``required_module`` AND include
``HasModulePermission`` in its ``permission_classes`` — otherwise an admin's
explicit module deny would not be enforced at the API for that endpoint.

If you add a new viewset that exposes module data, add it here (or, if it is a
deliberately cross-cutting/per-user mechanism like ExportJob, document the
exclusion below).
"""
from django.test import SimpleTestCase

from users.permissions import HasModulePermission

from aggregates.views import AggregateViewSet
from analysis.views import (
    ReportViewSet, CoordinatorTargetViewSet, SavedQueryViewSet, ScheduledReportViewSet,
)
from events.views import EventViewSet
from flags.views import FlagViewSet, FlagCommentViewSet
from indicators.views import IndicatorViewSet
from messaging.views import MessageViewSet, AnnouncementViewSet, NotificationViewSet
from organizations.views import OrganizationViewSet
from projects.views import ProjectViewSet
from respondents.views import RespondentViewSet, InteractionViewSet, ResponseViewSet
from social.views import SocialPostViewSet
from support.views import SupportTicketViewSet, SupportTicketCommentViewSet
from uploads.views import UploadViewSet, ImportJobViewSet
from users.views import UserViewSet

# (viewset, expected module slug)
SENSITIVE_VIEWSETS = [
    (AggregateViewSet, "aggregates"),
    (ReportViewSet, "reports"),
    (CoordinatorTargetViewSet, "targets"),
    (SavedQueryViewSet, "reports"),
    (ScheduledReportViewSet, "reports"),
    (EventViewSet, "events"),
    (FlagViewSet, "flags"),
    (FlagCommentViewSet, "flags"),
    (IndicatorViewSet, "indicators"),
    (MessageViewSet, "messages"),
    (AnnouncementViewSet, "messages"),
    (NotificationViewSet, "notifications"),
    (OrganizationViewSet, "organizations"),
    (ProjectViewSet, "projects"),
    (RespondentViewSet, "respondents"),
    (InteractionViewSet, "respondents"),
    (ResponseViewSet, "respondents"),
    (SocialPostViewSet, "social"),
    (SupportTicketViewSet, "support"),
    (SupportTicketCommentViewSet, "support"),
    (UploadViewSet, "uploads"),
    (ImportJobViewSet, "uploads"),
    (UserViewSet, "users"),
]

# Intentionally NOT module-gated (documented): ExportJobViewSet is a cross-cutting
# per-user mechanism (exports are triggered from BOTH analysis and uploads), so a
# single required_module would falsely lock out otherwise-entitled users; it is
# isolated by created_by scope instead.


class RequiredModuleCoverageTests(SimpleTestCase):
    def test_sensitive_viewsets_declare_required_module(self):
        missing = [vs.__name__ for vs, _ in SENSITIVE_VIEWSETS
                   if not getattr(vs, "required_module", None)]
        self.assertEqual(missing, [], f"viewsets missing required_module: {missing}")

    def test_required_module_matches_expected_slug(self):
        wrong = [(vs.__name__, getattr(vs, "required_module", None), slug)
                 for vs, slug in SENSITIVE_VIEWSETS
                 if getattr(vs, "required_module", None) != slug]
        self.assertEqual(wrong, [], f"required_module slug mismatches: {wrong}")

    def test_sensitive_viewsets_enforce_module_permission(self):
        missing = [vs.__name__ for vs, _ in SENSITIVE_VIEWSETS
                   if HasModulePermission not in tuple(getattr(vs, "permission_classes", ()))]
        self.assertEqual(missing, [], f"viewsets not enforcing HasModulePermission: {missing}")
