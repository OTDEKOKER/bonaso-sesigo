from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import FormSchemaView, SubmissionCreateView, SubmissionViewSet

router = DefaultRouter()
router.register("submissions", SubmissionViewSet, basename="cso-submissions")

urlpatterns = [
    # Public
    path("schema/", FormSchemaView.as_view(), name="cso-mapping-schema"),
    path("submit/", SubmissionCreateView.as_view(), name="cso-mapping-submit"),
    # Authorised staff (router: submissions/, submissions/<pk>/, /export/, /summary/)
    *router.urls,
]
