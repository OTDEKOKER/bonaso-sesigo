from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    IndicatorViewSet, IndicatorAliasViewSet, AssessmentViewSet, QuestionViewSet,
)

router = DefaultRouter()
router.register('assessments', AssessmentViewSet, basename='assessments')
router.register('questions', QuestionViewSet, basename='questions')
router.register('aliases', IndicatorAliasViewSet, basename='indicator-aliases')
router.register('', IndicatorViewSet, basename='indicators')

urlpatterns = [
    path('', include(router.urls)),
]
