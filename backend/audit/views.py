import csv

import django_filters
from django.http import HttpResponse
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.filters import OrderingFilter
from rest_framework.permissions import BasePermission, IsAuthenticated
from rest_framework.response import Response

from organizations.access import is_organization_admin

from .models import AuditEvent
from .serializers import AuditEventSerializer


class IsOrganizationAdmin(BasePermission):
    """Audit log is investigation data — administrators only."""

    message = 'Administrator access is required to view the audit log.'

    def has_permission(self, request, view):
        return bool(request.user and is_organization_admin(request.user))


class AuditEventFilterSet(django_filters.FilterSet):
    date_from = django_filters.IsoDateTimeFilter(field_name='created_at', lookup_expr='gte')
    date_to = django_filters.IsoDateTimeFilter(field_name='created_at', lookup_expr='lte')
    object_id = django_filters.CharFilter(field_name='object_id', lookup_expr='exact')

    class Meta:
        model = AuditEvent
        fields = {
            'action': ['exact'],
            'object_type': ['exact'],
            'actor': ['exact'],
            'organization': ['exact'],
            'project': ['exact'],
        }


class AuditEventViewSet(viewsets.ReadOnlyModelViewSet):
    """Read-only, admin-only access to the unified audit stream, with filtering
    (actor / action / object / org / project / date range) and CSV export."""

    queryset = AuditEvent.objects.select_related('actor', 'organization', 'project')
    serializer_class = AuditEventSerializer
    permission_classes = [IsAuthenticated, IsOrganizationAdmin]
    filter_backends = [DjangoFilterBackend, OrderingFilter]
    filterset_class = AuditEventFilterSet
    ordering_fields = ['created_at', 'action', 'object_type']
    ordering = ['-created_at']

    @action(detail=False, methods=['get'])
    def export(self, request):
        """Export the filtered audit stream as CSV (capped to 50k rows)."""
        queryset = self.filter_queryset(self.get_queryset())[:50000]
        response = HttpResponse(content_type='text/csv')
        response['Content-Disposition'] = 'attachment; filename="audit_log.csv"'
        writer = csv.writer(response)
        writer.writerow([
            'id', 'created_at', 'actor', 'action', 'object_type', 'object_id',
            'organization', 'project', 'ip_address', 'description',
        ])
        for event in queryset:
            writer.writerow([
                event.id,
                event.created_at.isoformat(),
                event.actor_username or (event.actor_id and f'user {event.actor_id}') or 'system',
                event.action,
                event.object_type,
                event.object_id,
                event.organization.name if event.organization_id else '',
                event.project.name if event.project_id else '',
                event.ip_address or '',
                event.description,
            ])
        return response

    @action(detail=False, methods=['get'])
    def actions(self, request):
        """List the distinct action vocabulary for filter UIs."""
        return Response([{'value': value, 'label': label} for value, label in AuditEvent.ACTION_CHOICES])
