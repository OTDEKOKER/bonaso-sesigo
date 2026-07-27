from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import SupportTicketCommentViewSet, SupportTicketViewSet

router = DefaultRouter()
router.register('comments', SupportTicketCommentViewSet, basename='support-comments')
router.register('tickets', SupportTicketViewSet, basename='support-tickets')

urlpatterns = [
    path('', include(router.urls)),
]
