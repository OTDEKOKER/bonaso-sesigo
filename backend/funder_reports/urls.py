from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import (
    ReportTemplateViewSet, ReportSectionViewSet, ReportFigureViewSet,
    ReportFigureIndicatorMappingViewSet, ReportFigureFilterViewSet,
    ReportFigureSnapshotViewSet, AdHocFigureGenerateView,
)

router = DefaultRouter()
router.register('templates', ReportTemplateViewSet, basename='report-templates')
router.register('sections', ReportSectionViewSet, basename='report-sections')
router.register('figures', ReportFigureViewSet, basename='report-figures')
router.register('figure-mappings', ReportFigureIndicatorMappingViewSet, basename='report-figure-mappings')
router.register('figure-filters', ReportFigureFilterViewSet, basename='report-figure-filters')
router.register('snapshots', ReportFigureSnapshotViewSet, basename='report-snapshots')

urlpatterns = router.urls + [
    path('adhoc-generate/', AdHocFigureGenerateView.as_view(), name='funder-adhoc-generate'),
]
