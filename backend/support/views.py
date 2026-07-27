"""Support / help-desk API.

Permission model
----------------
* Any authenticated user may RAISE a ticket (the module is default-open; admins
  can still restrict specific users via UserModulePermission).
* Visibility (``get_queryset``): admins see everything; everyone else sees tickets
  they reported, tickets assigned to them, or tickets for an organisation in their
  hierarchy scope. Internal comments are hidden from non-staff.
* Lifecycle mutations (assign / status / priority / resolve) are restricted to
  support staff (admin / manager / officer). A reporter may only add comments,
  reopen, or accept-close their own resolved ticket.

No sensitive database errors, stack traces or tokens are ever surfaced — the API
returns plain, user-safe messages.
"""
from __future__ import annotations

from datetime import timedelta

import django_filters
from django.db import models
from django.utils import timezone
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import status as http_status
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.filters import OrderingFilter, SearchFilter
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from organizations.access import (
    can_review_aggregates, get_user_organization_ids, is_organization_admin,
)
from users.permissions import HasModulePermission

from . import services
from .models import SupportTicket, SupportTicketComment
from .serializers import SupportTicketCommentSerializer, SupportTicketSerializer

# Legal status transitions for support staff. Same-status is an idempotent no-op.
STAFF_TRANSITIONS = {
    'new': {'acknowledged', 'investigating', 'closed'},
    'acknowledged': {'investigating', 'awaiting_user', 'resolved', 'closed'},
    'investigating': {'acknowledged', 'awaiting_user', 'resolved', 'closed'},
    'awaiting_user': {'investigating', 'resolved', 'closed'},
    'resolved': {'closed', 'reopened'},
    'closed': {'reopened'},
    'reopened': {'acknowledged', 'investigating', 'awaiting_user', 'resolved', 'closed'},
}
# A reporter (non-staff) may only accept a resolution or push back.
REPORTER_TRANSITIONS = {
    'resolved': {'closed', 'reopened'},
    'closed': {'reopened'},
}


def _is_support_staff(user) -> bool:
    return can_review_aggregates(user)  # admin / manager / officer


class SupportTicketPagination(PageNumberPagination):
    page_size = 25
    page_size_query_param = 'page_size'
    max_page_size = 500


class SupportTicketFilterSet(django_filters.FilterSet):
    date_from = django_filters.DateFilter(field_name='created_at', lookup_expr='date__gte')
    date_to = django_filters.DateFilter(field_name='created_at', lookup_expr='date__lte')
    unassigned = django_filters.BooleanFilter(field_name='assigned_to', lookup_expr='isnull')
    open = django_filters.BooleanFilter(method='filter_open')

    class Meta:
        model = SupportTicket
        fields = [
            'status', 'category', 'severity', 'priority',
            'affected_organization', 'affected_project', 'assigned_to', 'reporter',
        ]

    def filter_open(self, queryset, name, value):
        if value is True:
            return queryset.filter(status__in=SupportTicket.OPEN_STATUSES)
        if value is False:
            return queryset.filter(status__in=SupportTicket.TERMINAL_STATUSES)
        return queryset


class SupportTicketViewSet(viewsets.ModelViewSet):
    """Create/list/retrieve/update support tickets + lifecycle actions."""

    required_module = 'support'
    serializer_class = SupportTicketSerializer
    permission_classes = [IsAuthenticated, HasModulePermission]
    pagination_class = SupportTicketPagination
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_class = SupportTicketFilterSet
    search_fields = ['title', 'description', 'related_reference']
    ordering_fields = ['created_at', 'updated_at', 'priority', 'severity', 'status']
    ordering = ['-created_at']

    def get_queryset(self):
        user = self.request.user
        base = SupportTicket.objects.select_related(
            'affected_organization', 'affected_project', 'reporter',
            'assigned_to', 'resolved_by',
        )
        if is_organization_admin(user):
            return base
        org_ids = get_user_organization_ids(user)
        scope = models.Q(reporter=user) | models.Q(assigned_to=user)
        if org_ids:
            scope |= models.Q(affected_organization_id__in=org_ids)
        return base.filter(scope).distinct()

    # ── Creation ──────────────────────────────────────────────────────────────
    def perform_create(self, serializer):
        user = self.request.user
        ticket = serializer.save(
            reporter=user,
            reporter_username=getattr(user, 'username', '') or '',
            status=SupportTicket.STATUS_NEW,
        )
        services.record_ticket_event(
            ticket, request=self.request, actor=user, action='create',
            event='created',
            description=f'Support ticket #{ticket.id} raised: {ticket.title}.',
            extra={'category': ticket.category, 'severity': ticket.severity,
                   'priority': ticket.priority},
        )
        services.notify_ticket_created(ticket, actor=user)

    # Block blind PATCH/PUT of lifecycle fields by non-staff; staff may edit the
    # descriptive fields (title/description/category/links). Status/assignment/
    # resolution are read-only in the serializer and move only via the actions.
    def perform_update(self, serializer):
        if not _is_support_staff(self.request.user):
            raise PermissionDenied('Only support staff may edit ticket details.')
        ticket = serializer.save()
        services.record_ticket_event(
            ticket, request=self.request, actor=self.request.user, action='update',
            event='edited', description=f'Support ticket #{ticket.id} details edited.',
        )

    def perform_destroy(self, instance):
        # Tickets are an audit surface; only admins may delete, and it is audited.
        if not is_organization_admin(self.request.user):
            raise PermissionDenied('Only administrators may delete support tickets.')
        services.record_ticket_event(
            instance, request=self.request, actor=self.request.user, action='delete',
            event='deleted', description=f'Support ticket #{instance.id} deleted.',
        )
        instance.delete()

    # ── Lifecycle actions ──────────────────────────────────────────────────────
    @action(detail=True, methods=['post'])
    def assign(self, request, pk=None):
        ticket = self.get_object()
        if not _is_support_staff(request.user):
            raise PermissionDenied('Only support staff may assign tickets.')
        assignee_id = request.data.get('assigned_to')
        from users.models import User
        assignee = None
        if assignee_id not in (None, '', 0, '0'):
            try:
                assignee = User.objects.get(pk=assignee_id, is_active=True)
            except (User.DoesNotExist, ValueError, TypeError):
                raise ValidationError({'assigned_to': 'Unknown or inactive user.'})
        previous = ticket.assigned_to_id
        ticket.assigned_to = assignee
        # First assignment nudges a brand-new ticket into acknowledged.
        if assignee and ticket.status == SupportTicket.STATUS_NEW:
            ticket.status = SupportTicket.STATUS_ACKNOWLEDGED
        ticket.save(update_fields=['assigned_to', 'status', 'updated_at'])
        services.record_ticket_event(
            ticket, request=request, actor=request.user, action='assign',
            event='assignment',
            description=(f'Support ticket #{ticket.id} assigned to '
                         f'{assignee.username if assignee else "nobody"}.'),
            extra={'previous_assignee_id': previous,
                   'new_assignee_id': ticket.assigned_to_id},
        )
        services.notify_ticket_assigned(ticket, actor=request.user)
        return Response(self.get_serializer(ticket).data)

    @action(detail=True, methods=['post'])
    def set_status(self, request, pk=None):
        ticket = self.get_object()
        new_status = (request.data.get('status') or '').strip()
        valid = dict(SupportTicket.STATUS_CHOICES)
        if new_status not in valid:
            raise ValidationError({'status': f'Unknown status "{new_status}".'})
        previous = ticket.status
        if new_status == previous:
            return Response(self.get_serializer(ticket).data)  # idempotent no-op

        staff = _is_support_staff(request.user)
        is_reporter = ticket.reporter_id == getattr(request.user, 'id', None)
        allowed_map = STAFF_TRANSITIONS if staff else (REPORTER_TRANSITIONS if is_reporter else {})
        if new_status not in allowed_map.get(previous, set()):
            raise PermissionDenied(
                f'You may not move this ticket from "{previous}" to "{new_status}".'
            )
        self._apply_status(ticket, new_status, request)
        return Response(self.get_serializer(ticket).data)

    @action(detail=True, methods=['post'])
    def resolve(self, request, pk=None):
        ticket = self.get_object()
        if not _is_support_staff(request.user):
            raise PermissionDenied('Only support staff may resolve tickets.')
        if ticket.status not in STAFF_TRANSITIONS or 'resolved' not in STAFF_TRANSITIONS.get(ticket.status, set()):
            if ticket.status != SupportTicket.STATUS_RESOLVED:
                raise ValidationError({'status': f'Cannot resolve a "{ticket.status}" ticket.'})
        notes = (request.data.get('resolution_notes') or '').strip()
        if notes:
            ticket.resolution_notes = notes
        self._apply_status(ticket, SupportTicket.STATUS_RESOLVED, request,
                           resolved_by=request.user)
        return Response(self.get_serializer(ticket).data)

    @action(detail=True, methods=['post'])
    def reopen(self, request, pk=None):
        ticket = self.get_object()
        staff = _is_support_staff(request.user)
        is_reporter = ticket.reporter_id == getattr(request.user, 'id', None)
        if not (staff or is_reporter):
            raise PermissionDenied('Only the reporter or support staff may reopen a ticket.')
        if ticket.status not in SupportTicket.TERMINAL_STATUSES:
            raise ValidationError({'status': 'Only a resolved or closed ticket can be reopened.'})
        self._apply_status(ticket, SupportTicket.STATUS_REOPENED, request, clear_resolution=True)
        return Response(self.get_serializer(ticket).data)

    @action(detail=True, methods=['post'])
    def set_priority(self, request, pk=None):
        ticket = self.get_object()
        if not _is_support_staff(request.user):
            raise PermissionDenied('Only support staff may change priority or severity.')
        changed = {}
        new_priority = (request.data.get('priority') or '').strip()
        new_severity = (request.data.get('severity') or '').strip()
        if new_priority:
            if new_priority not in dict(SupportTicket.PRIORITY_CHOICES):
                raise ValidationError({'priority': f'Unknown priority "{new_priority}".'})
            if new_priority != ticket.priority:
                changed['priority'] = (ticket.priority, new_priority)
                ticket.priority = new_priority
        if new_severity:
            if new_severity not in dict(SupportTicket.SEVERITY_CHOICES):
                raise ValidationError({'severity': f'Unknown severity "{new_severity}".'})
            if new_severity != ticket.severity:
                changed['severity'] = (ticket.severity, new_severity)
                ticket.severity = new_severity
        if not changed:
            return Response(self.get_serializer(ticket).data)
        ticket.save(update_fields=['priority', 'severity', 'updated_at'])
        for field, (old, new) in changed.items():
            services.record_ticket_event(
                ticket, request=request, actor=request.user, action='update',
                event=f'{field}_change',
                description=f'Support ticket #{ticket.id} {field} {old} -> {new}.',
                extra={'field': field, 'previous': old, 'new': new},
            )
        return Response(self.get_serializer(ticket).data)

    def _apply_status(self, ticket, new_status, request, *, resolved_by=None,
                      clear_resolution=False):
        previous = ticket.status
        ticket.status = new_status
        fields = ['status', 'updated_at']
        if new_status == SupportTicket.STATUS_RESOLVED:
            ticket.resolved_at = timezone.now()
            ticket.resolved_by = resolved_by or request.user
            fields += ['resolved_at', 'resolved_by', 'resolution_notes']
        elif clear_resolution:
            ticket.resolved_at = None
            ticket.resolved_by = None
            fields += ['resolved_at', 'resolved_by']
        ticket.save(update_fields=list(dict.fromkeys(fields)))
        event = {'resolved': 'resolution', 'reopened': 'reopen'}.get(new_status, 'status_change')
        services.record_ticket_event(
            ticket, request=request, actor=request.user, action='update',
            event=event,
            description=f'Support ticket #{ticket.id}: {previous} -> {new_status}.',
            extra={'previous_status': previous, 'new_status': new_status},
        )
        services.notify_ticket_status_changed(ticket, actor=request.user, previous_status=previous)

    # ── Comments ────────────────────────────────────────────────────────────────
    @action(detail=True, methods=['get', 'post'])
    def comments(self, request, pk=None):
        ticket = self.get_object()
        staff = _is_support_staff(request.user)
        if request.method == 'GET':
            qs = ticket.comments.select_related('created_by').all()
            if not staff:  # reporters never see internal triage notes
                qs = qs.filter(is_internal=False)
            return Response(SupportTicketCommentSerializer(qs, many=True).data)
        # POST
        content = (request.data.get('content') or '').strip()
        if not content:
            raise ValidationError({'content': 'A comment cannot be empty.'})
        is_internal = bool(request.data.get('is_internal')) and staff
        comment = SupportTicketComment.objects.create(
            ticket=ticket, content=content, is_internal=is_internal,
            created_by=request.user,
            created_by_username=getattr(request.user, 'username', '') or '',
        )
        services.record_ticket_event(
            ticket, request=request, actor=request.user, action='update',
            event='comment',
            description=f'Comment added to support ticket #{ticket.id}.',
            extra={'is_internal': is_internal, 'comment_id': comment.id},
        )
        services.notify_ticket_comment(ticket, comment, actor=request.user)
        return Response(SupportTicketCommentSerializer(comment).data,
                        status=http_status.HTTP_201_CREATED)

    @action(detail=True, methods=['get'])
    def history(self, request, pk=None):
        ticket = self.get_object()
        events = services.ticket_history(ticket.id)
        return Response([
            {
                'id': e.id,
                'action': e.action,
                'event': (e.metadata or {}).get('event', e.action),
                'actor': e.actor_username or (e.actor_id and f'user {e.actor_id}') or 'system',
                'description': e.description,
                'metadata': e.metadata,
                'created_at': e.created_at.isoformat(),
            }
            for e in events
        ])

    @action(detail=False, methods=['get'])
    def stats(self, request):
        """Queue summary for the operational dashboard, scoped to what the caller
        may see."""
        qs = self.get_queryset()
        now = timezone.now()
        open_qs = qs.filter(status__in=SupportTicket.OPEN_STATUSES)
        # .values() drops the base select_related (avoids a deferred+traversed
        # conflict) and keeps this light — overdue is a pure per-row target check.
        overdue = 0
        for row in open_qs.values('severity', 'created_at'):
            hours = SupportTicket.RESOLUTION_TARGET_HOURS.get(row['severity'])
            if hours and row['created_at'] and now > row['created_at'] + timedelta(hours=hours):
                overdue += 1
        return Response({
            'total': qs.count(),
            'open': open_qs.count(),
            'unassigned_open': open_qs.filter(assigned_to__isnull=True).count(),
            'overdue': overdue,
            'by_status': list(qs.values('status').annotate(count=models.Count('id'))),
            'by_category': list(qs.values('category').annotate(count=models.Count('id'))),
            'by_priority': list(qs.values('priority').annotate(count=models.Count('id'))),
        })


class SupportTicketCommentViewSet(viewsets.ReadOnlyModelViewSet):
    """Read-only comment list (writes go through the ticket ``comments`` action so
    permission + notification rules are centralised)."""

    required_module = 'support'
    serializer_class = SupportTicketCommentSerializer
    permission_classes = [IsAuthenticated, HasModulePermission]
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['ticket']

    def get_queryset(self):
        user = self.request.user
        qs = SupportTicketComment.objects.select_related('ticket', 'created_by')
        if is_organization_admin(user) or _is_support_staff(user):
            return qs
        # Non-staff: only comments on tickets they can see, and never internal notes.
        org_ids = get_user_organization_ids(user)
        scope = models.Q(ticket__reporter=user) | models.Q(ticket__assigned_to=user)
        if org_ids:
            scope |= models.Q(ticket__affected_organization_id__in=org_ids)
        return qs.filter(scope).filter(is_internal=False).distinct()
