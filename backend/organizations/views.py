from rest_framework import viewsets, status
from users.permissions import HasModulePermission
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework.filters import SearchFilter, OrderingFilter
from django.db.models import Count

from .models import Organization
from .access import get_user_organization_ids, is_organization_admin, filter_queryset_by_org_ids, apply_training_filter_via_projects
from .serializers import (
    OrganizationSerializer, OrganizationTreeSerializer, OrganizationSimpleSerializer
)


class OrganizationViewSet(viewsets.ModelViewSet):
    """ViewSet for managing organizations."""
    
    queryset = Organization.objects.all()
    serializer_class = OrganizationSerializer
    required_module = 'organizations'
    permission_classes = [IsAuthenticated, HasModulePermission]
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ['type', 'parent', 'is_active']
    search_fields = ['name', 'code', 'description']
    ordering_fields = ['name', 'created_at', 'type']
    ordering = ['name']
    
    def get_queryset(self):
        queryset = Organization.objects.select_related('parent').annotate(
            children_count=Count('children', distinct=True),
            users_count=Count('users', distinct=True),
        )
        # Isolate Sesigo Training Mode: demo organisations are linked only to
        # training projects and must not clutter live organisation lists.
        queryset = apply_training_filter_via_projects(queryset, self.request)

        user = self.request.user
        if is_organization_admin(user):
            return queryset
        org_ids = get_user_organization_ids(user)
        if org_ids:
            org = user.organization
            ancestor_ids = [ancestor.id for ancestor in org.get_ancestors()]
            return queryset.filter(id__in=org_ids + ancestor_ids)
        return Organization.objects.none()
    
    def perform_create(self, serializer):
        serializer.save()

    def destroy(self, request, *args, **kwargs):
        """Refuse to hard-delete an organisation that carries reporting history (C1).

        Deleting an organisation cascades through the Aggregate table, destroying
        its submitted reporting data. When history exists we return 409 and steer
        the admin to deactivate (``is_active=False``) instead.
        """
        from core.lifecycle import organization_delete_block_reason
        instance = self.get_object()
        reason = organization_delete_block_reason(instance)
        if reason:
            return Response(
                {'detail': reason, 'code': 'reporting_history_exists'},
                status=status.HTTP_409_CONFLICT,
            )
        return super().destroy(request, *args, **kwargs)

    @action(detail=False, methods=['get'])
    def tree(self, request):
        """Get organization hierarchy tree."""
        root_orgs = Organization.objects.filter(parent__isnull=True, is_active=True)
        # Keep demo (training-only) organisations out of the live hierarchy tree.
        root_orgs = apply_training_filter_via_projects(root_orgs, request)
        serializer = OrganizationTreeSerializer(root_orgs, many=True)
        return Response(serializer.data)
    
    @action(detail=False, methods=['get'])
    def simple(self, request):
        """Get simple list for dropdowns."""
        orgs = self.get_queryset().filter(is_active=True)
        serializer = OrganizationSimpleSerializer(orgs, many=True)
        return Response(serializer.data)
    
    @action(detail=True, methods=['get'])
    def descendants(self, request, pk=None):
        """Get all descendant organizations."""
        org = self.get_object()
        descendants = org.get_descendants()
        serializer = OrganizationSimpleSerializer(descendants, many=True)
        return Response(serializer.data)
    
    @action(detail=True, methods=['get'])
    def users(self, request, pk=None):
        """Get users in this organization."""
        from users.serializers import UserSerializer
        org = self.get_object()
        org_ids = [org.id] + [child.id for child in org.get_descendants()]
        users = filter_queryset_by_org_ids(org.users.model.objects.select_related('organization'), 'organization_id', org_ids)
        serializer = UserSerializer(users, many=True)
        return Response(serializer.data)
