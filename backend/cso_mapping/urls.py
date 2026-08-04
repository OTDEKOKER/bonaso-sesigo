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
    path("drafts/", DraftCreateView.as_view(), name="cso-mapping-draft-create"),
    path("drafts/<str:token>/", DraftDetailView.as_view(), name="cso-mapping-draft-detail"),
    path(
        "drafts/<str:token>/submit/",
        DraftSubmitView.as_view(),
        name="cso-mapping-draft-submit",
    ),
    # Authorised staff (router: submissions/, submissions/<pk>/, /export/, /summary/)
    *router.urls,
]
