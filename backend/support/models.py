"""Support / help-desk tickets (rollout ops-readiness WS1).

A lightweight, auditable help-desk workflow for the platform. Deliberately reuses
existing infrastructure rather than duplicating it:

  * status/assignment/priority/resolution/reopen **history** is written to the
    unified ``audit.AuditEvent`` stream (object_type='support_ticket'), not a new
    history table;
  * user-facing **notifications** reuse ``messaging.Notification``;
  * **permission scoping** reuses ``organizations.access`` (org + hierarchy) and
    the per-module ``users.permissions.HasModulePermission`` gate.

Only the ticket itself and its threaded comments are new.
"""
from __future__ import annotations

from datetime import timedelta

from django.db import models


class SupportTicket(models.Model):
    """One reported support/help-desk issue and its lifecycle."""

    # ── Lifecycle ────────────────────────────────────────────────────────────
    STATUS_NEW = 'new'
    STATUS_ACKNOWLEDGED = 'acknowledged'
    STATUS_INVESTIGATING = 'investigating'
    STATUS_AWAITING_USER = 'awaiting_user'
    STATUS_RESOLVED = 'resolved'
    STATUS_CLOSED = 'closed'
    STATUS_REOPENED = 'reopened'
    STATUS_CHOICES = [
        (STATUS_NEW, 'New'),
        (STATUS_ACKNOWLEDGED, 'Acknowledged'),
        (STATUS_INVESTIGATING, 'Investigating'),
        (STATUS_AWAITING_USER, 'Awaiting user'),
        (STATUS_RESOLVED, 'Resolved'),
        (STATUS_CLOSED, 'Closed'),
        (STATUS_REOPENED, 'Reopened'),
    ]
    # Statuses that count as "still needs work" for queue/SLA purposes.
    OPEN_STATUSES = {
        STATUS_NEW, STATUS_ACKNOWLEDGED, STATUS_INVESTIGATING,
        STATUS_AWAITING_USER, STATUS_REOPENED,
    }
    TERMINAL_STATUSES = {STATUS_RESOLVED, STATUS_CLOSED}

    # ── Category (mirrors the reporting workflow surfaces) ───────────────────
    CATEGORY_CHOICES = [
        ('login_access', 'Login or access'),
        ('permission_role', 'Permission or role'),
        ('org_hierarchy', 'Organisation hierarchy'),
        ('indicator_target', 'Indicator or target'),
        ('workbook_download', 'Workbook download'),
        ('workbook_upload', 'Workbook upload'),
        ('validation_error', 'Validation error'),
        ('submission', 'Submission'),
        ('review_approval', 'Review or approval'),
        ('dashboard_analytics', 'Dashboard or analytics'),
        ('funder_report', 'Funder report'),
        ('performance', 'Performance'),
        ('other', 'Other'),
    ]

    SEVERITY_CHOICES = [
        ('low', 'Low'),
        ('medium', 'Medium'),
        ('high', 'High'),
        ('critical', 'Critical'),
    ]
    PRIORITY_CHOICES = [
        ('low', 'Low'),
        ('normal', 'Normal'),
        ('high', 'High'),
        ('urgent', 'Urgent'),
    ]

    # First-response and resolution targets by severity, in hours. Surfaced to the
    # API/UI and used by the ``overdue`` queue logic. These are TARGETS, not hard
    # deadlines — escalation policy lives in the help-desk runbook.
    RESPONSE_TARGET_HOURS = {'critical': 2, 'high': 8, 'medium': 24, 'low': 72}
    RESOLUTION_TARGET_HOURS = {'critical': 8, 'high': 48, 'medium': 120, 'low': 240}

    title = models.CharField(max_length=255)
    description = models.TextField()

    category = models.CharField(max_length=32, choices=CATEGORY_CHOICES, default='other')
    severity = models.CharField(max_length=16, choices=SEVERITY_CHOICES, default='medium')
    priority = models.CharField(max_length=16, choices=PRIORITY_CHOICES, default='normal')
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default=STATUS_NEW, db_index=True)

    # ── Context ──────────────────────────────────────────────────────────────
    affected_organization = models.ForeignKey(
        'organizations.Organization', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='support_tickets',
    )
    affected_project = models.ForeignKey(
        'projects.Project', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='support_tickets',
    )
    reporting_period = models.ForeignKey(
        'aggregates.ReportingPeriod', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='support_tickets',
    )
    # Free-text period label for issues that don't map to a formal ReportingPeriod
    # row (e.g. a monthly window). Optional; complements reporting_period.
    reporting_period_label = models.CharField(max_length=64, blank=True, default='')

    # ── People ───────────────────────────────────────────────────────────────
    reporter = models.ForeignKey(
        'users.User', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='reported_support_tickets',
    )
    # Denormalised so the reporter's identity survives a later user deletion.
    reporter_username = models.CharField(max_length=150, blank=True, default='')
    assigned_to = models.ForeignKey(
        'users.User', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='assigned_support_tickets',
    )

    # ── Resolution ───────────────────────────────────────────────────────────
    resolution_notes = models.TextField(blank=True, default='')
    resolved_at = models.DateTimeField(null=True, blank=True)
    resolved_by = models.ForeignKey(
        'users.User', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='resolved_support_tickets',
    )

    # ── Optional links to the record the ticket is about ─────────────────────
    related_aggregate = models.ForeignKey(
        'aggregates.Aggregate', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='support_tickets',
    )
    related_upload = models.ForeignKey(
        'uploads.Upload', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='support_tickets',
    )
    # Free-text reference for anything else (a funder report id, an export, …).
    related_reference = models.CharField(max_length=255, blank=True, default='')

    metadata = models.JSONField(default=dict, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)  # date reported
    updated_at = models.DateTimeField(auto_now=True)      # last update

    class Meta:
        ordering = ['-created_at', '-id']
        indexes = [
            models.Index(fields=['status'], name='support_status_idx'),
            models.Index(fields=['assigned_to', 'status'], name='support_assignee_status_idx'),
            models.Index(fields=['affected_organization', 'status'], name='support_org_status_idx'),
            models.Index(fields=['reporter'], name='support_reporter_idx'),
            models.Index(fields=['-created_at'], name='support_created_idx'),
        ]

    def __str__(self):
        return f'#{self.id} {self.title} ({self.get_status_display()})'

    @property
    def is_open(self) -> bool:
        return self.status in self.OPEN_STATUSES

    def resolution_target_at(self):
        """Datetime by which this ticket should be resolved per its severity target."""
        hours = self.RESOLUTION_TARGET_HOURS.get(self.severity)
        if hours is None or self.created_at is None:
            return None
        return self.created_at + timedelta(hours=hours)

    def is_overdue(self, *, now=None) -> bool:
        """True when an OPEN ticket has passed its severity resolution target."""
        if not self.is_open:
            return False
        target = self.resolution_target_at()
        if target is None:
            return False
        from django.utils import timezone
        return (now or timezone.now()) > target


class SupportTicketComment(models.Model):
    """A threaded note on a ticket. Internal comments are visible to support
    staff/admins only; non-internal comments are the user-facing conversation."""

    ticket = models.ForeignKey(
        SupportTicket, on_delete=models.CASCADE, related_name='comments',
    )
    content = models.TextField()
    # Internal triage notes are hidden from the reporter (see the serializer /
    # view scoping). Only support staff may set this true.
    is_internal = models.BooleanField(default=False)

    created_by = models.ForeignKey(
        'users.User', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='support_comments',
    )
    created_by_username = models.CharField(max_length=150, blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['created_at', 'id']

    def __str__(self):
        return f'Comment on #{self.ticket_id}'
