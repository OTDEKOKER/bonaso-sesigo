from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from users.permissions import HasModulePermission
import django_filters
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework.filters import SearchFilter, OrderingFilter
from django.utils import timezone
from django.db import models
from organizations.access import get_user_organization_ids, is_organization_admin, filter_queryset_by_org_ids
from projects.hierarchy import resolve_organization_scope_with_project_hierarchy
from aggregates.models import Aggregate

from .models import Flag, FlagComment
from .serializers import FlagSerializer, FlagCommentSerializer


class FlagFilterSet(django_filters.FilterSet):
    """Server-side filters for the Flags page, mirroring the filters used across
    the system (organization / project / coordinator / indicator / type / date).

    Flags reference their subject polymorphically (``content_type`` + ``object_id``),
    so project/indicator — which live on the linked aggregate, not on the flag —
    resolve the matching aggregate ids and restrict to ``content_type='aggregate'``
    flags. Coordinator resolves the org subtree for the project hierarchy (the same
    helper the aggregates page uses) and matches the flag's own ``organization``.
    ``category`` reads the data-quality category stashed in ``metadata``.
    """

    project = django_filters.CharFilter(method="filter_project")
    indicator = django_filters.CharFilter(method="filter_indicator")
    coordinator = django_filters.CharFilter(method="filter_coordinator")
    category = django_filters.CharFilter(field_name="metadata__category", lookup_expr="exact")
    date_from = django_filters.DateFilter(field_name="created_at", lookup_expr="date__gte")
    date_to = django_filters.DateFilter(field_name="created_at", lookup_expr="date__lte")

    class Meta:
        model = Flag
        fields = ["flag_type", "status", "priority", "organization", "assigned_to", "content_type"]

    @staticmethod
    def _to_int(value):
        try:
            return int(value)
        except (TypeError, ValueError):
            return None

    def _aggregate_flags(self, queryset, **agg_filter):
        agg_ids = Aggregate.objects.filter(**agg_filter).values("id")
        return queryset.filter(content_type="aggregate", object_id__in=agg_ids)

    def filter_project(self, queryset, name, value):
        project_id = self._to_int(value)
        if project_id is None:
            return queryset
        return self._aggregate_flags(queryset, project_id=project_id)

    def filter_indicator(self, queryset, name, value):
        indicator_id = self._to_int(value)
        if indicator_id is None:
            return queryset
        return self._aggregate_flags(queryset, indicator_id=indicator_id)

    def filter_coordinator(self, queryset, name, value):
        coordinator_id = self._to_int(value)
        if coordinator_id is None:
            return queryset
        project_id = self._to_int(self.data.get("project"))
        scoped_org_ids = list(
            resolve_organization_scope_with_project_hierarchy(coordinator_id, project_id=project_id)
        )
        if not scoped_org_ids:
            return queryset.none()
        return queryset.filter(organization_id__in=scoped_org_ids)


class FlagViewSet(viewsets.ModelViewSet):
    """ViewSet for managing flags."""

    queryset = Flag.objects.all()
    required_module = 'flags'
    serializer_class = FlagSerializer
    permission_classes = [IsAuthenticated, HasModulePermission]
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_class = FlagFilterSet
    search_fields = ['title', 'description']
    ordering_fields = ['created_at', 'priority', 'status']
    ordering = ['-created_at']
    
    def get_queryset(self):
        user = self.request.user
        if is_organization_admin(user):
            return Flag.objects.all()
        org_ids = get_user_organization_ids(user)
        if org_ids:
            return filter_queryset_by_org_ids(Flag.objects.all(), 'organization_id', org_ids)
        return Flag.objects.filter(created_by=user)
    
    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)
    
    @action(detail=True, methods=['post'])
    def resolve(self, request, pk=None):
        """Resolve a flag."""
        flag = self.get_object()
        flag.status = 'resolved'
        flag.resolution_notes = request.data.get('resolution_notes', '')
        flag.resolved_at = timezone.now()
        flag.resolved_by = request.user
        flag.save()
        return Response(FlagSerializer(flag).data)
    
    @action(detail=True, methods=['post'])
    def dismiss(self, request, pk=None):
        """Dismiss a flag."""
        flag = self.get_object()
        flag.status = 'dismissed'
        flag.resolution_notes = request.data.get('resolution_notes', '')
        flag.resolved_at = timezone.now()
        flag.resolved_by = request.user
        flag.save()
        return Response(FlagSerializer(flag).data)
    
    @action(detail=True, methods=['post'])
    def add_comment(self, request, pk=None):
        """Add comment to flag."""
        flag = self.get_object()
        serializer = FlagCommentSerializer(data={
            'flag': flag.id,
            'content': request.data.get('content', '')
        })
        serializer.is_valid(raise_exception=True)
        serializer.save(created_by=request.user)
        return Response(serializer.data, status=status.HTTP_201_CREATED)
    
    @action(detail=False, methods=['get'])
    def stats(self, request):
        """Get flag statistics."""
        qs = self.get_queryset()
        return Response({
            'total': qs.count(),
            'open': qs.filter(status='open').count(),
            'in_progress': qs.filter(status='in_progress').count(),
            'resolved': qs.filter(status='resolved').count(),
            'by_type': list(qs.values('flag_type').annotate(count=models.Count('id'))),
            'by_priority': list(qs.values('priority').annotate(count=models.Count('id'))),
        })


class FlagCommentViewSet(viewsets.ModelViewSet):
    """ViewSet for flag comments."""
    
    queryset = FlagComment.objects.all()
    required_module = 'flags'
    serializer_class = FlagCommentSerializer
    permission_classes = [IsAuthenticated, HasModulePermission]
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['flag']

    def get_queryset(self):
        user = self.request.user
        queryset = FlagComment.objects.select_related('flag', 'created_by')
        if is_organization_admin(user):
            return queryset
        org_ids = get_user_organization_ids(user)
        if org_ids:
            return filter_queryset_by_org_ids(queryset, 'flag__organization_id', org_ids)
        return queryset.filter(created_by=user)
    
    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

