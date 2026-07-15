from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import ReportViewSet, SavedQueryViewSet, ScheduledReportViewSet, DashboardView, CoordinatorTargetViewSet, indicator_trends, indicator_trends_bulk, chart_export_excel, management_intelligence, geographic_coverage

# Create a router and register our viewsets
router = DefaultRouter()
router.register('reports', ReportViewSet, basename='reports')
router.register('scheduled-reports', ScheduledReportViewSet, basename='scheduled-reports')
router.register('saved-queries', SavedQueryViewSet, basename='saved-queries')
router.register('dashboard', DashboardView, basename='dashboard')  # DashboardView as a ViewSet
router.register('coordinator-targets', CoordinatorTargetViewSet, basename='coordinator-targets')

# Include the router URLs in urlpatterns
urlpatterns = [
    path('', include(router.urls)),
    path('trends/<int:indicator_id>/', indicator_trends, name='indicator-trends'),
    path('trends/', indicator_trends_bulk, name='indicator-trends-bulk'),
    path('chart-export/', chart_export_excel, name='chart-export-excel'),
    path('management-intelligence/', management_intelligence, name='management-intelligence'),
    path('geographic-coverage/', geographic_coverage, name='geographic-coverage'),
]
