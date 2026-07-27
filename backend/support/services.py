"""Support-ticket side effects: audit history + user notifications + staff resolution.

Every state change on a ticket is recorded to the unified ``audit.AuditEvent``
stream (reused, not duplicated) and — where a human should be told — a
``messaging.Notification`` is created. All of these are best-effort: an auditing
or notification failure must never break the ticket action itself.
"""
from __future__ import annotations

import logging

from django.db.models import Q

from audit.recording import record_audit_event
from messaging.models import Notification
from users.models import User

logger = logging.getLogger(__name__)


def ticket_link(ticket_id: int) -> str:
    return f"/support/{ticket_id}"


def _display_name(user) -> str:
    if not user:
        return "A user"
    full = (getattr(user, "full_name", "") or "").strip()
    return full or user.username or "A user"


# ── Audit history (reuses audit.AuditEvent, object_type='support_ticket') ──────
def record_ticket_event(ticket, *, request=None, actor=None, action='update',
                        event='', description='', extra=None):
    """Append one ticket lifecycle event to the unified audit stream.

    ``action`` is one of the existing AuditEvent verbs (create/update/assign/…);
    ``event`` is a finer-grained label stored in metadata so a ticket timeline can
    render it (created / status_change / assignment / priority_change / severity_change
    / resolution / reopen / comment)."""
    metadata = {'event': event or action}
    if extra:
        metadata.update(extra)
    record_audit_event(
        action=action,
        actor=actor,
        request=request,
        object_type='support_ticket',
        object_id=ticket.id,
        organization=ticket.affected_organization,
        project=ticket.affected_project,
        description=description or f'Support ticket #{ticket.id}: {event or action}.',
        metadata=metadata,
    )


def ticket_history(ticket_id: int):
    """The audit events for one ticket, oldest first (for the detail timeline)."""
    from audit.models import AuditEvent
    return (
        AuditEvent.objects
        .filter(object_type='support_ticket', object_id=str(ticket_id))
        .order_by('created_at', 'id')
    )


# ── Support staff resolution ──────────────────────────────────────────────────
def get_support_staff_users(exclude_user_ids=None):
    """Active admins + M&E Managers — the triage/assignment pool. Kept broad so a
    newly raised ticket is always seen by someone who can action it."""
    excluded = {int(u) for u in (exclude_user_ids or [])}
    users = User.objects.filter(is_active=True).filter(
        Q(is_superuser=True) | Q(is_staff=True) | Q(role='admin') | Q(role='manager')
    )
    return [u for u in users if u.id not in excluded]


def _notify(recipients, *, title, content, link):
    recipients = [u for u in recipients if u and getattr(u, 'is_active', False)]
    if not recipients:
        return
    try:
        Notification.objects.bulk_create([
            Notification(user=u, title=title, content=content, link=link)
            for u in recipients
        ])
    except Exception:  # pragma: no cover - notification must never break the action
        logger.exception('Failed to create support notifications')


# ── Notification events ────────────────────────────────────────────────────────
def notify_ticket_created(ticket, *, actor=None):
    recipients = get_support_staff_users(exclude_user_ids=[actor.id] if actor else None)
    _notify(
        recipients,
        title='New support ticket',
        content=(f'{_display_name(actor)} raised "{ticket.title}" '
                 f'({ticket.get_category_display()}, {ticket.get_severity_display()} severity).'),
        link=ticket_link(ticket.id),
    )


def notify_ticket_assigned(ticket, *, actor=None):
    if not ticket.assigned_to or (actor and ticket.assigned_to_id == actor.id):
        return
    _notify(
        [ticket.assigned_to],
        title='Support ticket assigned to you',
        content=f'{_display_name(actor)} assigned ticket #{ticket.id} "{ticket.title}" to you.',
        link=ticket_link(ticket.id),
    )


def notify_ticket_status_changed(ticket, *, actor=None, previous_status=None):
    """Tell the reporter (and the assignee, if different) that status moved."""
    recipients = []
    if ticket.reporter and (not actor or ticket.reporter_id != actor.id):
        recipients.append(ticket.reporter)
    if (ticket.assigned_to and (not actor or ticket.assigned_to_id != actor.id)
            and ticket.assigned_to_id != ticket.reporter_id):
        recipients.append(ticket.assigned_to)
    _notify(
        recipients,
        title=f'Support ticket {ticket.get_status_display().lower()}',
        content=(f'Ticket #{ticket.id} "{ticket.title}" moved from '
                 f'{previous_status or "?"} to {ticket.status} by {_display_name(actor)}.'),
        link=ticket_link(ticket.id),
    )


def notify_ticket_comment(ticket, comment, *, actor=None):
    """Notify the 'other side' of a new (non-internal) comment."""
    if comment.is_internal:
        recipients = get_support_staff_users(exclude_user_ids=[actor.id] if actor else None)
    else:
        recipients = []
        if ticket.reporter and (not actor or ticket.reporter_id != actor.id):
            recipients.append(ticket.reporter)
        if ticket.assigned_to and (not actor or ticket.assigned_to_id != actor.id):
            recipients.append(ticket.assigned_to)
        if not recipients:  # reporter commenting with no assignee → tell staff
            recipients = get_support_staff_users(exclude_user_ids=[actor.id] if actor else None)
    _notify(
        recipients,
        title='New comment on support ticket',
        content=f'{_display_name(actor)} commented on ticket #{ticket.id} "{ticket.title}".',
        link=ticket_link(ticket.id),
    )
