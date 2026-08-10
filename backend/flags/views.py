from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from users.permissions import HasModulePermission
import django_filters
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework.filters import SearchFilter, OrderingFilter
from rest_framework.pagination import PageNumberPagination
from django.utils import timezone
from django.db import models
from organizations.access import get_user_organization_ids, is_organization_admin, filter_queryset_by_org_ids, training_view_mode
from projects.hierarchy import resolve_organization_scope_with_project_hierarchy
from aggregates.models import Aggregate

from .models import Flag, FlagComment
from .serializers import FlagSerializer, FlagCommentSerializer


def apply_flag_training_filter(queryset, request, prefix=""):
    """Isolate Sesigo Live vs Training flags.

    A Flag carries no ``is_training`` of its own — it points at a subject
    polymorphically (``content_type`` + ``object_id``). Its environment is that
    of the subject: the aggregate's / interaction's project, or (for respondent
    flags) whether the respondent has a training-project interaction.

      Live (default): exclude flags whose subject is a training-project record.
      Training Mode:  show ONLY those. Unknown subject types are treated as
                      live-only (conservative — never surface them in training).

    ``prefix`` addresses the polymorphic columns through a relation, e.g.
    ``"flag__"`` for FlagComment.
    """
    mode = training_view_mode(request)
    if mode == "all":
        return queryset
    from respondents.models import Interaction

    training_aggs = Aggregate.objects.filter(project__is_training=True).values("id")
    training_ints = Interaction.objects.filter(project__is_training=True).values("id")
    training_resps = Interaction.objects.filter(
        project__is_training=True
    ).values("respondent_id")

    ct, oid = f"{prefix}content_type", f"{prefix}object_id"
    training_q = (
        models.Q(**{ct: "aggregate", f"{oid}__in": training_aggs})
        | models.Q(**{ct: "interaction", f"{oid}__in": training_ints})
        | models.Q(**{ct: "respondent", f"{oid}__in": training_resps})
    )
    if mode == "training":
        return queryset.filter(training_q)
    return queryset.exclude(training_q)


def apply_flag_project_gate(queryset, request, prefix=""):
    """Project-assignment gate for flags (mirrors the data endpoints). A flag has
    no project of its own, so we scope through its aggregate/interaction subject's
    project. Rollout-safe: admins (project_ids None) and users with no project
    assignments are NOT narrowed. Respondent-subject and other flag types are
    kept (governed by org scope) so no legitimate flag is hidden by this gate.
    """
    from projects.scope import get_user_project_ids
    project_ids = get_user_project_ids(request.user)
    if not project_ids:
        return queryset
    from respondents.models import Interaction

    out_aggs = Aggregate.objects.exclude(
        models.Q(project_id__in=project_ids) | models.Q(project__isnull=True)
    ).values("id")
    out_ints = Interaction.objects.exclude(
        models.Q(project_id__in=project_ids) | models.Q(project__isnull=True)
    ).values("id")
    ct, oid = f"{prefix}content_type", f"{prefix}object_id"
    out_of_scope = (
        models.Q(**{ct: "aggregate", f"{oid}__in": out_aggs})
        | models.Q(**{ct: "interaction", f"{oid}__in": out_ints})
    )
    return queryset.exclude(out_of_scope)


class FlagPagination(PageNumberPagination):
    """Let the Flags page request a large page so a filtered/searched result set
    is shown in full (the default 20 would silently truncate filtered results)."""

    page_size = 20
    page_size_query_param = "page_size"
    max_page_size = 1000


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
    pagination_class = FlagPagination
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_class = FlagFilterSet
    search_fields = ['title', 'description']
    ordering_fields = ['created_at', 'priority', 'status']
    ordering = ['-created_at']
    
    def get_queryset(self):
        user = self.request.user
        if is_organization_admin(user):
            qs = Flag.objects.all()
        else:
            org_ids = get_user_organization_ids(user)
            if org_ids:
                qs = filter_queryset_by_org_ids(Flag.objects.all(), 'organization_id', org_ids)
            else:
                qs = Flag.objects.filter(created_by=user)
        qs = apply_flag_training_filter(qs, self.request)
        return apply_flag_project_gate(qs, self.request)
    
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
        if not is_organization_admin(user):
            org_ids = get_user_organization_ids(user)
            if org_ids:
                queryset = filter_queryset_by_org_ids(queryset, 'flag__organization_id', org_ids)
            else:
                queryset = queryset.filter(created_by=user)
        # A comment's environment + project scope follow its parent flag's subject.
        queryset = apply_flag_training_filter(queryset, self.request, prefix="flag__")
        return apply_flag_project_gate(queryset, self.request, prefix="flag__")
    
    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

