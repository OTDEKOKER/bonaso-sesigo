"""Best-effort audit recording.

``record_audit_event`` is the single entry point used by views to append to the
unified audit stream. It is deliberately defensive: auditing must NEVER break the
action being audited, so any failure is logged and swallowed rather than raised
into the request path.
"""
from __future__ import annotations

import logging

logger = logging.getLogger(__name__)


def client_ip(request):
    """Best-effort client IP, honouring a single proxy hop (X-Forwarded-For)."""
    if request is None:
        return None
    forwarded = request.META.get('HTTP_X_FORWARDED_FOR')
    if forwarded:
        return forwarded.split(',')[0].strip() or None
    return request.META.get('REMOTE_ADDR')


def _resolve_actor(actor, request):
    if actor is not None and getattr(actor, 'pk', None):
        return actor
    if request is not None:
        user = getattr(request, 'user', None)
        if user is not None and getattr(user, 'is_authenticated', False):
            return user
    return None


def record_audit_event(
    *,
    action,
    actor=None,
    object_type='',
    object_id=None,
    organization=None,
    project=None,
    request=None,
    description='',
    metadata=None,
):
    """Append one event to the unified audit stream. Never raises."""
    try:
        from .models import AuditEvent

        resolved_actor = _resolve_actor(actor, request)
        AuditEvent.objects.create(
            actor=resolved_actor,
            actor_username=getattr(resolved_actor, 'username', '') or '',
            action=str(action),
            object_type=str(object_type or ''),
            object_id='' if object_id is None else str(object_id),
            organization=organization if getattr(organization, 'pk', None) else None,
            project=project if getattr(project, 'pk', None) else None,
            ip_address=client_ip(request),
            description=str(description or ''),
            metadata=metadata if isinstance(metadata, dict) else {},
        )
    except Exception:  # pragma: no cover - auditing must never break the caller
        logger.exception(
            'Failed to record audit event (action=%s object=%s:%s)',
            action,
            object_type,
            object_id,
        )
