from django.urls import path

from .views import RestoreValidateView, RestoreHistoryView

urlpatterns = [
    path("validate/", RestoreValidateView.as_view(), name="restore_validate"),
    path("history/", RestoreHistoryView.as_view(), name="restore_history"),
]
