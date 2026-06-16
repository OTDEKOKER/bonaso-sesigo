from django.conf import settings
from django.db import models


class SystemIssueAck(models.Model):
    """Admin acknowledgement state for a System Status issue.

    Issues are derived live from the health checks, so they have no row of their
    own. This table records an admin's disposition (reviewed / resolved /
    ignored) keyed by the issue's stable ``issue_key`` plus a ``fingerprint`` of
    its evidence. If the underlying problem changes, the fingerprint changes and
    the acknowledgement no longer applies — the issue re-surfaces as open.
    """

    STATUS_CHOICES = [
        ("needs_review", "Needs review"),
        ("reviewed", "Reviewed"),
        ("resolved", "Resolved"),
        ("ignored", "Ignored"),
    ]

    issue_key = models.CharField(max_length=128, db_index=True)
    fingerprint = models.CharField(max_length=64)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES)
    note = models.TextField(blank=True)
    acknowledged_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="system_issue_acks",
    )
    acknowledged_by_username = models.CharField(max_length=150, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["issue_key", "fingerprint"], name="uniq_issue_ack"),
        ]
        ordering = ["-updated_at"]

    def __str__(self):
        return f"{self.issue_key} [{self.status}]"
