from django.db import models


class AuditEvent(models.Model):
    """Centralized, append-only audit stream (rollout readiness R6).

    A single table that records every significant action across the platform so
    an investigation can reconstruct who did what, to which object, when, and
    from where. Distinct from ``users.UserActivity`` (which only tracked
    login/logout/admin) — this is the unified stream the readiness audit asked
    for. Rows are written best-effort via ``audit.recording.record_audit_event``
    and are never edited or deleted in the normal request path.
    """

    ACTION_CHOICES = [
        ('create', 'Create'),
        ('update', 'Update'),
        ('delete', 'Delete'),
        ('review', 'Review'),
        ('approve', 'Approve'),
        ('reject', 'Reject'),
        ('flag', 'Flag'),
        ('unflag', 'Unflag'),
        ('import', 'Import'),
        ('export', 'Export'),
        ('assign', 'Assign'),
        ('login', 'Login'),
        ('logout', 'Logout'),
        ('backup_generated', 'Backup generated'),
        ('backup_downloaded', 'Backup downloaded'),
        ('backup_download_reminder_sent', 'Backup download reminder sent'),
        ('backup_uploaded', 'Backup uploaded'),
        ('backup_restored', 'Backup restored'),
        ('restore_failed', 'Restore failed'),
        ('environment_override', 'Environment override'),
        # ── Quarterly Reporting Control Framework ────────────────────────────
        ('reporting_window_override', 'Reporting window override'),
        ('reporting_period_created', 'Reporting period created'),
        ('reporting_period_updated', 'Reporting period updated'),
        ('reporting_scheduled', 'Reporting scheduled'),
        ('reporting_opened', 'Reporting opened'),
        ('reporting_closed', 'Reporting closed'),
        ('reporting_reopened', 'Reporting reopened'),
        ('reporting_archived', 'Reporting archived'),
        ('late_reporting_enabled', 'Late reporting enabled'),
        ('late_reporting_disabled', 'Late reporting disabled'),
        ('reporting_submission_blocked', 'Reporting submission blocked'),
    ]

    actor = models.ForeignKey(
        'users.User',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='audit_events',
    )
    # Denormalised so the actor's identity survives a later user deletion.
    actor_username = models.CharField(max_length=150, blank=True)

    action = models.CharField(max_length=32, choices=ACTION_CHOICES)
    object_type = models.CharField(max_length=64, blank=True)
    # Char (not int) so the stream is object-type agnostic.
    object_id = models.CharField(max_length=64, blank=True)

    organization = models.ForeignKey(
        'organizations.Organization',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='audit_events',
    )
    project = models.ForeignKey(
        'projects.Project',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='audit_events',
    )

    ip_address = models.GenericIPAddressField(null=True, blank=True)
    description = models.TextField(blank=True)
    metadata = models.JSONField(default=dict, blank=True)

    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ['-created_at', '-id']
        indexes = [
            models.Index(fields=['-created_at'], name='audit_created_idx'),
            models.Index(fields=['action'], name='audit_action_idx'),
            models.Index(fields=['object_type', 'object_id'], name='audit_object_idx'),
            models.Index(fields=['actor'], name='audit_actor_idx'),
        ]

    def __str__(self):
        who = self.actor_username or (self.actor_id and f'user {self.actor_id}') or 'system'
        return f'{who} {self.action} {self.object_type}:{self.object_id} @ {self.created_at:%Y-%m-%d %H:%M}'
