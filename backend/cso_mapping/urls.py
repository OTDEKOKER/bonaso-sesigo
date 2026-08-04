from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import (
    DraftCreateView,
    DraftDetailView,
    DraftSubmitView,
    FormSchemaView,
    SubmissionCreateView,
    SubmissionViewSet,
)

router = DefaultRouter()
router.register("submissions", SubmissionViewSet, basename="cso-submissions")

urlpatterns = [
    # Public
    path("schema/", FormSchemaView.as_view(), name="cso-mapping-schema"),
    path("submit/", SubmissionCreateView.as_view(), name="cso-mapping-submit"),
    # The resume token travels in the X-CSO-Draft-Token header, never the URL.
    path("drafts/", DraftCreateView.as_view(), name="cso-mapping-draft-create"),
    path("drafts/current/", DraftDetailView.as_view(), name="cso-mapping-draft-detail"),
    path(
        "drafts/current/submit/",
        DraftSubmitView.as_view(),
        name="cso-mapping-draft-submit",
    ),
    # Authorised staff (router: submissions/, submissions/<pk>/, /export/, /summary/)
    *router.urls,
]
