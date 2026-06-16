from django.urls import path

from .views import IssueDetailView, IssueDownloadView, IssueRerunView, IssueAckView

urlpatterns = [
    path("issues/<str:issue_id>/", IssueDetailView.as_view(), name="system_issue_detail"),
    path("issues/<str:issue_id>/download/", IssueDownloadView.as_view(), name="system_issue_download"),
    path("issues/<str:issue_id>/rerun/", IssueRerunView.as_view(), name="system_issue_rerun"),
    path("issues/<str:issue_id>/ack/", IssueAckView.as_view(), name="system_issue_ack"),
]
