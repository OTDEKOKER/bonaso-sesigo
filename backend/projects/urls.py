from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import ClientOrganizationViewSet, NarrativeReportViewSet, ProjectActivityViewSet, ProjectViewSet, TaskViewSet, DeadlineViewSet
from .workbook_layout_views import WorkbookLayoutViewSet

router = DefaultRouter()
router.register('projects', ProjectViewSet, basename='projects')
router.register('project-activities', ProjectActivityViewSet, basename='project-activities')
router.register('clients', ClientOrganizationViewSet, basename='clients')
router.register('narrative-reports', NarrativeReportViewSet, basename='narrative-reports')
router.register('tasks', TaskViewSet, basename='tasks')
router.register('deadlines', DeadlineViewSet, basename='deadlines')
router.register('workbook-layouts', WorkbookLayoutViewSet, basename='workbook-layouts')

urlpatterns = [
    path('', include(router.urls)),
]
