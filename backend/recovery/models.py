from django.conf import settings
from django.db import models


class RestoreHistory(models.Model):
    """Append-only log of every restore attempt (validation + apply).

    Restores are applied by a supervised CLI command, never from a web request,
    so this table is the record of what was attempted, by whom, between which
    environments, and how it ended.
    """

    RESULT_CHOICES = [
        ("validated", "Validated (not applied)"),
        ("pending", "Apply started"),
        ("success", "Restored"),
        ("failed", "Failed"),
        ("rolled_back", "Failed — rolled back"),
        ("rejected", "Rejected (validation)"),
    ]

    created_at = models.DateTimeField(auto_now_add=True)
    restored_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="restore_events",
    )
    restored_by_username = models.CharField(max_length=150, blank=True)

    backup_name = models.CharField(max_length=255, blank=True)
    backup_created_at = models.CharField(max_length=64, blank=True)
    checksum = models.CharField(max_length=128, blank=True)

    source_environment = models.CharField(max_length=32, blank=True)
    target_environment = models.CharField(max_length=32, blank=True)
    environment_override = models.BooleanField(default=False)

    result = models.CharField(max_length=32, choices=RESULT_CHOICES)
    notes = models.TextField(blank=True)
    # Free-form summary captured at validation time (counts, manifest, etc.).
    summary = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["-created_at"], name="restore_created_idx"),
            models.Index(fields=["result"], name="restore_result_idx"),
        ]

    def __str__(self):
        return f"{self.result} {self.backup_name} -> {self.target_environment} @ {self.created_at:%Y-%m-%d %H:%M}"
