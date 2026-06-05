from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import UploadViewSet, ImportJobViewSet, ExportJobViewSet

router = DefaultRouter()
router.register('imports', ImportJobViewSet, basename='import-jobs')
router.register('exports', ExportJobViewSet, basename='export-jobs')
router.register('', UploadViewSet, basename='uploads')

urlpatterns = [
    path('', include(router.urls)),
]
