from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import AggregateViewSet
from .reporting_period_views import ReportingPeriodViewSet

# Single router. The aggregates viewset is registered at the EMPTY prefix, so its
# detail route (``^(?P<pk>[^/.]+)/$``) would swallow ``reporting-periods/`` if it
# came first. Register reporting-periods BEFORE aggregates so its routes resolve
# first; the empty-prefix aggregates list/create (``^$``) still precedes the
# router's own API-root view, so POST /api/aggregates/ keeps working.
router = DefaultRouter()
router.register('reporting-periods', ReportingPeriodViewSet, basename='reporting-periods')
router.register('', AggregateViewSet, basename='aggregates')

urlpatterns = [
    path('', include(router.urls)),
]
