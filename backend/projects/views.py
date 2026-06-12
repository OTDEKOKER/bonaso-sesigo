from decimal import Decimal, InvalidOperation

from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.parsers import MultiPartParser, FormParser
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework.exceptions import PermissionDenied
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework.filters import SearchFilter, OrderingFilter
from django.utils import timezone
from django.utils.dateparse import parse_date
from django.db import models
from django.db import DatabaseError
from django.db.models import Count, F, Prefetch, Q, Sum
from organizations.access import get_user_organization_ids, is_organization_admin, filter_queryset_by_org_ids, apply_training_filter, apply_training_filter_to_projects, assert_project_write_allowed
from users.permissions import HasModulePermission


def _guard_project_write(request, serializer):
    """Enforce the training/live boundary for a project-scoped write.

    Resolves the target project from the incoming data (create) or the existing
    instance (partial update) and defers to assert_project_write_allowed. Audit
    finding H4 — applied to every project-scoped write path.
    """
    project = serializer.validated_data.get('project')
    if project is None and serializer.instance is not None:
        project = getattr(serializer.instance, 'project', None)
    assert_project_write_allowed(request, project)

from .models import (
    ClientOrganization,
    NarrativeReport,
    Project,
    ProjectActivity,
    ProjectIndicator,
    ProjectIndicatorAssignment,
    ProjectIndicatorDisaggregationRule,
    ProjectIndicatorOrganizationTarget,
    ProjectOrganization,
    ProjectOrganizationHierarchy,
    Task,
    Deadline,
)
from .hierarchy import resolve_organization_scope_with_project_hierarchy
from .project_indicator_links import ensure_project_indicator_link
from .project_indicator_scope_sync import ensure_project_indicator_assignments
from .project_scope_sync import sync_project_scope_tables
from indicators.models import Indicator
from .serializers import (
    ProjectSerializer, ProjectDetailSerializer, ProjectIndicatorSerializer,
    TaskSerializer, DeadlineSerializer, ProjectActivitySerializer,
)


class ProjectViewSet(viewsets.ModelViewSet):
    """ViewSet for managing projects."""
    
    queryset = Project.objects.all()
    required_module = 'projects'
    permission_classes = [IsAuthenticated, HasModulePermission]
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ['status', 'organizations']
    search_fields = ['name', 'code', 'description', 'funder']
    ordering_fields = ['name', 'start_date', 'end_date', 'created_at']
    ordering = ['-start_date']

    def _project_scope_org_ids(self, project):
        try:
            scoped_ids = set(
                ProjectOrganization.objects.filter(
                    project=project,
                    is_active=True,
                ).values_list('organization_id', flat=True)
            )
        except DatabaseError:
            scoped_ids = set()
        if scoped_ids:
            return scoped_ids
        return set(project.organizations.values_list('id', flat=True))
    
    def get_serializer_class(self):
        if self.action == 'retrieve':
            return ProjectDetailSerializer
        return ProjectSerializer
    
    def get_queryset(self):
        queryset = Project.objects.select_related('created_by').prefetch_related(
            'organizations',
            'client_organizations',
        ).annotate(
            indicators_count=Count('indicators', distinct=True),
            tasks_count=Count('tasks', distinct=True),
            completed_indicators_count=Count(
                'projectindicator',
                filter=Q(projectindicator__current_value__gte=F('projectindicator__target_value')),
                distinct=True,
            ),
            total_project_indicators=Count('projectindicator', distinct=True),
        )

        if self.action == 'retrieve':
            queryset = queryset.prefetch_related(
                Prefetch(
                    'projectindicator_set',
                    queryset=ProjectIndicator.objects.select_related('indicator'),
                )
            )

        user = self.request.user
        # Isolate Sesigo Live System and Sesigo Training Mode projects for EVERY
        # caller, admins included. Audit finding: training projects (is_training=
        # True) were leaking into the live project dropdowns because admins were
        # exempted from this filter. Live mode now never surfaces training
        # projects; an admin who genuinely needs to see them opts in explicitly
        # with include_training=true (training_view_mode == "all"), which the
        # helper honours. Training Mode (training_only/mode=training) still shows
        # only training projects.
        queryset = apply_training_filter_to_projects(queryset, self.request)
        if is_organization_admin(user):
            # Admins keep cross-project visibility (no project-assignment gate);
            # only the training/live isolation above is applied.
            return queryset

        # Non-admins: project-assignment gate on top of the training isolation.
        # Project-assignment gate: non-admin users only see projects they are
        # explicitly assigned to (or that they created). This is the official
        # "users must not see projects they shouldn't" rule and replaces the
        # previous global Organization.parent-tree membership check.
        assigned_project_ids = set(user.assigned_projects.values_list('id', flat=True))
        return queryset.filter(
            models.Q(id__in=assigned_project_ids) |
            models.Q(created_by=user)
        ).distinct()

    def perform_create(self, serializer):
        # A project created while operating in Sesigo Training Mode must be a
        # training project, regardless of role. This prevents trainees from
        # unknowingly creating live projects (and writing live data into them).
        from organizations.access import is_training_only_request
        if is_training_only_request(self.request):
            serializer.save(created_by=self.request.user, is_training=True)
        else:
            serializer.save(created_by=self.request.user)

    @action(detail=True, methods=['get'])
    def stats(self, request, pk=None):
        """Get project statistics."""
        project = self.get_object()
        indicators = ProjectIndicator.objects.filter(project=project)
        
        return Response({
            'total_indicators': indicators.count(),
            'completed_targets': indicators.filter(current_value__gte=models.F('target_value')).count(),
            'pending_deadlines': project.deadlines.filter(status='pending').count(),
            'progress_percentage': project.progress_percentage,
        })
    
    @action(detail=True, methods=['post'])
    def assign_indicators(self, request, pk=None):
        """Assign indicators to project."""
        project = self.get_object()
        indicator_ids = request.data.get('indicator_ids', [])
        
        for ind_id in indicator_ids:
            ensure_project_indicator_link(project, ind_id)
            project_indicator = ProjectIndicator.objects.filter(
                project=project,
                indicator_id=ind_id,
            ).first()
            if project_indicator is not None:
                # Phase 3 foundation: persist project-scoped assignment rows
                # without changing legacy indicator visibility behavior yet.
                ensure_project_indicator_assignments(
                    project_indicator,
                    source='project_scope',
                )
            indicator = Indicator.objects.filter(id=ind_id).first()
            if indicator and not Task.objects.filter(
                project=project,
                name=indicator.name
            ).exists():
                Task.objects.create(
                    project=project,
                    name=indicator.name,
                    description=indicator.description,
                    status='pending',
                    priority='medium',
                    created_by=request.user,
                )
        return Response({'detail': 'Indicators assigned.'})
    
    @action(detail=True, methods=['post'])
    def set_target(self, request, pk=None):
        """Set target for indicator in project."""
        project = self.get_object()
        indicator_id = request.data.get('indicator_id')
        if not indicator_id:
            return Response({'detail': 'indicator_id is required.'}, status=status.HTTP_400_BAD_REQUEST)

        organization_id = request.data.get('organization_id')

        def to_decimal(value):
            if value in (None, ""):
                return Decimal("0")
            if isinstance(value, Decimal):
                return value
            try:
                return Decimal(str(value))
            except (InvalidOperation, TypeError, ValueError):
                return Decimal("0")

        q1_target = to_decimal(request.data.get('q1_target'))
        q2_target = to_decimal(request.data.get('q2_target'))
        q3_target = to_decimal(request.data.get('q3_target'))
        q4_target = to_decimal(request.data.get('q4_target'))
        baseline_value = to_decimal(request.data.get('baseline_value'))
        requested_target_value = request.data.get('target_value')
        target_value = (
            to_decimal(requested_target_value)
            if requested_target_value not in (None, "")
            else q1_target + q2_target + q3_target + q4_target
        )
        
        ensure_project_indicator_link(
            project,
            indicator_id,
            target_value=target_value,
            baseline_value=baseline_value,
            q1_target=q1_target,
            q2_target=q2_target,
            q3_target=q3_target,
            q4_target=q4_target,
        )
        pi = ProjectIndicator.objects.get(project=project, indicator_id=indicator_id)
        indicator = Indicator.objects.filter(id=indicator_id).first()
        if indicator and not Task.objects.filter(
            project=project,
            name=indicator.name
        ).exists():
            Task.objects.create(
                project=project,
                name=indicator.name,
                description=indicator.description,
                status='pending',
                priority='medium',
                    created_by=request.user,
                )

        # Modern payload path: save organization-scoped quarterly targets.
        if organization_id not in (None, ""):
            try:
                organization_id_value = int(organization_id)
            except (TypeError, ValueError):
                return Response({'detail': 'organization_id must be a valid integer.'}, status=status.HTTP_400_BAD_REQUEST)

            if not is_organization_admin(request.user):
                allowed_org_ids = set(get_user_organization_ids(request.user) or [])
                if organization_id_value not in allowed_org_ids:
                    raise PermissionDenied('You do not have permission to set targets for this organization.')

            project_org_ids = self._project_scope_org_ids(project)
            if project_org_ids and organization_id_value not in project_org_ids:
                return Response(
                    {'detail': 'organization_id is not assigned to this project.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            # Preserve legacy behavior: update organization-scoped targets in
            # place, and roll up quarterly + annual totals onto ProjectIndicator.
            ProjectIndicatorOrganizationTarget.objects.update_or_create(
                project_indicator=pi,
                organization_id=organization_id_value,
                defaults={
                    'q1_target': q1_target,
                    'q2_target': q2_target,
                    'q3_target': q3_target,
                    'q4_target': q4_target,
                    'target_value': target_value,
                    'baseline_value': baseline_value,
                },
            )
            ensure_project_indicator_assignments(
                pi,
                organization_ids=[organization_id_value],
                source='organization_target',
            )

            totals = pi.organization_targets.aggregate(
                q1_total=Sum('q1_target'),
                q2_total=Sum('q2_target'),
                q3_total=Sum('q3_target'),
                q4_total=Sum('q4_target'),
                target_total=Sum('target_value'),
                baseline_total=Sum('baseline_value'),
            )
            pi.q1_target = totals.get('q1_total') or Decimal("0")
            pi.q2_target = totals.get('q2_total') or Decimal("0")
            pi.q3_target = totals.get('q3_total') or Decimal("0")
            pi.q4_target = totals.get('q4_total') or Decimal("0")
            pi.target_value = totals.get('target_total') or Decimal("0")
            pi.baseline_value = totals.get('baseline_total') or Decimal("0")
            pi.save(
                update_fields=[
                    'q1_target',
                    'q2_target',
                    'q3_target',
                    'q4_target',
                    'target_value',
                    'baseline_value',
                ]
            )
        else:
            # Legacy payload path: save project-level aggregate target only.
            pi.target_value = target_value
            pi.baseline_value = baseline_value
            pi.save(update_fields=['target_value', 'baseline_value'])
        return Response({'detail': 'Target set.'})

    @action(detail=True, methods=['get'])
    def setup(self, request, pk=None):
        """Return project-scoped setup payload for hierarchy and assignment workflows."""
        project = self.get_object()
        project_serializer = ProjectDetailSerializer(project, context=self.get_serializer_context())
        payload = project_serializer.data
        payload['project_setup_ready'] = True
        return Response(payload)

    @action(detail=True, methods=['post'])
    def set_organization_roles(self, request, pk=None):
        """Upsert project organization role rows without removing legacy links."""
        project = self.get_object()
        role_rows = request.data.get('roles')
        if not isinstance(role_rows, list):
            return Response({'detail': 'roles must be an array.'}, status=status.HTTP_400_BAD_REQUEST)

        valid_roles = {choice for choice, _label in ProjectOrganization.ROLE_CHOICES}
        current_scope_org_ids = set(project.organizations.values_list('id', flat=True))
        allowed_org_ids = None if is_organization_admin(request.user) else set(get_user_organization_ids(request.user) or [])
        touched_org_ids = set()

        def _normalize_scope_list(value):
            if value in (None, ''):
                return []
            if isinstance(value, list):
                return [str(item).strip() for item in value if str(item).strip()]
            if isinstance(value, str):
                return [entry.strip() for entry in value.split(',') if entry.strip()]
            return []

        def _coerce_bool(value, default=False):
            if value is None:
                return bool(default)
            if isinstance(value, bool):
                return value
            if isinstance(value, str):
                normalized = value.strip().lower()
                if normalized in {'1', 'true', 'yes', 'y', 'on'}:
                    return True
                if normalized in {'0', 'false', 'no', 'n', 'off'}:
                    return False
            return bool(value)

        try:
            for row in role_rows:
                if not isinstance(row, dict):
                    return Response({'detail': 'Each role entry must be an object.'}, status=status.HTTP_400_BAD_REQUEST)
                try:
                    organization_id = int(row.get('organization_id'))
                except (TypeError, ValueError):
                    return Response({'detail': 'organization_id must be an integer.'}, status=status.HTTP_400_BAD_REQUEST)
                if allowed_org_ids is not None and organization_id not in allowed_org_ids:
                    raise PermissionDenied('You do not have permission to set roles for this organization.')

                role_value = str(row.get('role') or 'implementing_partner').strip()
                if role_value not in valid_roles:
                    return Response({'detail': f'Invalid role: {role_value}.'}, status=status.HTTP_400_BAD_REQUEST)

                is_active = _coerce_bool(row.get('is_active', True), default=True)
                implementation_scope = row.get('implementation_scope') or {}
                if not isinstance(implementation_scope, dict):
                    return Response(
                        {'detail': 'implementation_scope must be an object when provided.'},
                        status=status.HTTP_400_BAD_REQUEST,
                    )

                existing = ProjectOrganization.objects.filter(
                    project=project,
                    organization_id=organization_id,
                ).first()

                role_for_flags = role_value or (existing.role if existing else 'implementing_partner')
                default_is_coordinator = role_for_flags == 'coordinator'
                default_is_sub_grantee = role_for_flags == 'sub_grantee'
                default_is_implementer = role_for_flags in {'implementing_partner', 'coordinator', 'sub_grantee'}

                client_id = row.get('client_id')
                if client_id in ('', None):
                    normalized_client_id = existing.client_id if existing else None
                else:
                    try:
                        normalized_client_id = int(client_id)
                    except (TypeError, ValueError):
                        return Response({'detail': 'client_id must be an integer when provided.'}, status=status.HTTP_400_BAD_REQUEST)
                    if not ClientOrganization.objects.filter(id=normalized_client_id).exists():
                        return Response({'detail': f'Client organization {normalized_client_id} does not exist.'}, status=status.HTTP_400_BAD_REQUEST)
                    project.client_organizations.add(normalized_client_id)

                parent_assignment_id = row.get('parent_assignment_id')
                if parent_assignment_id in ('', None):
                    normalized_parent_assignment_id = existing.parent_assignment_id if existing else None
                else:
                    try:
                        normalized_parent_assignment_id = int(parent_assignment_id)
                    except (TypeError, ValueError):
                        return Response({'detail': 'parent_assignment_id must be an integer when provided.'}, status=status.HTTP_400_BAD_REQUEST)
                    if not ProjectOrganization.objects.filter(
                        id=normalized_parent_assignment_id,
                        project=project,
                    ).exists():
                        return Response(
                            {'detail': f'parent_assignment_id {normalized_parent_assignment_id} is not in this project.'},
                            status=status.HTTP_400_BAD_REQUEST,
                        )

                contract_start_date_raw = row.get('contract_start_date', existing.contract_start_date if existing else None)
                contract_end_date_raw = row.get('contract_end_date', existing.contract_end_date if existing else None)
                contract_start_date = parse_date(str(contract_start_date_raw)) if contract_start_date_raw else None
                contract_end_date = parse_date(str(contract_end_date_raw)) if contract_end_date_raw else None
                if contract_start_date_raw and contract_start_date is None:
                    return Response({'detail': 'contract_start_date must be in YYYY-MM-DD format.'}, status=status.HTTP_400_BAD_REQUEST)
                if contract_end_date_raw and contract_end_date is None:
                    return Response({'detail': 'contract_end_date must be in YYYY-MM-DD format.'}, status=status.HTTP_400_BAD_REQUEST)

                source_row_raw = row.get('source_row', existing.source_row if existing else None)
                source_row = None
                if source_row_raw not in (None, ''):
                    try:
                        source_row = int(source_row_raw)
                    except (TypeError, ValueError):
                        return Response({'detail': 'source_row must be an integer when provided.'}, status=status.HTTP_400_BAD_REQUEST)

                ProjectOrganization.objects.update_or_create(
                    project=project,
                    organization_id=organization_id,
                    defaults={
                        'role': role_value,
                        'client_id': normalized_client_id,
                        'parent_assignment_id': normalized_parent_assignment_id,
                        'cluster': str(row.get('cluster', existing.cluster if existing else '') or '').strip(),
                        'is_coordinator': _coerce_bool(
                            row.get('is_coordinator', existing.is_coordinator if existing else default_is_coordinator),
                            default=existing.is_coordinator if existing else default_is_coordinator,
                        ),
                        'is_sub_grantee': _coerce_bool(
                            row.get('is_sub_grantee', existing.is_sub_grantee if existing else default_is_sub_grantee),
                            default=existing.is_sub_grantee if existing else default_is_sub_grantee,
                        ),
                        'is_implementer': _coerce_bool(
                            row.get('is_implementer', existing.is_implementer if existing else default_is_implementer),
                            default=existing.is_implementer if existing else default_is_implementer,
                        ),
                        'can_report_indicators': _coerce_bool(
                            row.get('can_report_indicators', existing.can_report_indicators if existing else True),
                            default=existing.can_report_indicators if existing else True,
                        ),
                        'thematic_areas': _normalize_scope_list(row.get('thematic_areas', existing.thematic_areas if existing else [])),
                        'districts': _normalize_scope_list(row.get('districts', existing.districts if existing else [])),
                        'localities': _normalize_scope_list(row.get('localities', existing.localities if existing else [])),
                        'contract_start_date': contract_start_date,
                        'contract_end_date': contract_end_date,
                        'source_sheet': str(row.get('source_sheet', existing.source_sheet if existing else '') or '').strip(),
                        'source_row': source_row,
                        'is_training': _coerce_bool(
                            row.get('is_training', existing.is_training if existing else project.is_training),
                            default=existing.is_training if existing else project.is_training,
                        ),
                        'is_active': is_active,
                        'implementation_scope': implementation_scope,
                    },
                )
                touched_org_ids.add(organization_id)
                if is_active and organization_id not in current_scope_org_ids:
                    project.organizations.add(organization_id)
                    current_scope_org_ids.add(organization_id)
        except DatabaseError:
            return Response(
                {'detail': 'Project setup tables are not yet available. Run migrations first.'},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        # Keep compatibility rows in sync with legacy fields.
        sync_project_scope_tables(project)
        return Response({'detail': 'Project organization roles updated.', 'updated': len(touched_org_ids)})

    @action(detail=True, methods=['post'])
    def set_hierarchy_links(self, request, pk=None):
        """
        Directly write ProjectOrganizationHierarchy rows.
        Dual-writes to hierarchy_overrides JSON for backward compatibility.
        replace=True (default) deactivates existing links not in the payload.
        """
        project = self.get_object()
        links = request.data.get('links')
        replace = bool(request.data.get('replace', True))

        if not isinstance(links, list):
            return Response({'detail': 'links must be an array.'}, status=status.HTTP_400_BAD_REQUEST)

        project_scope_org_ids = self._project_scope_org_ids(project)
        allowed_org_ids = (
            None if is_organization_admin(request.user)
            else set(get_user_organization_ids(request.user) or [])
        )

        desired_pairs: set[tuple[int, int]] = set()
        for row in links:
            if not isinstance(row, dict):
                return Response({'detail': 'Each link entry must be an object.'}, status=status.HTTP_400_BAD_REQUEST)
            try:
                parent_id = int(row.get('parent_organization_id'))
                child_id = int(row.get('child_organization_id'))
            except (TypeError, ValueError):
                return Response(
                    {'detail': 'parent_organization_id and child_organization_id must be integers.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if parent_id == child_id:
                return Response(
                    {'detail': 'parent_organization_id and child_organization_id must differ.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if project_scope_org_ids:
                if parent_id not in project_scope_org_ids:
                    return Response(
                        {'detail': f'Organization {parent_id} is not in project scope.'},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                if child_id not in project_scope_org_ids:
                    return Response(
                        {'detail': f'Organization {child_id} is not in project scope.'},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
            if allowed_org_ids is not None and parent_id not in allowed_org_ids:
                raise PermissionDenied('You do not have permission to set hierarchy for this organization.')
            desired_pairs.add((parent_id, child_id))

        try:
            if replace:
                existing_active = list(
                    ProjectOrganizationHierarchy.objects.filter(project=project, is_active=True)
                )
                stale_ids = [
                    row.id
                    for row in existing_active
                    if (row.parent_organization_id, row.child_organization_id) not in desired_pairs
                ]
                if stale_ids:
                    ProjectOrganizationHierarchy.objects.filter(id__in=stale_ids).update(is_active=False)

            for parent_id, child_id in desired_pairs:
                ProjectOrganizationHierarchy.objects.update_or_create(
                    project=project,
                    parent_organization_id=parent_id,
                    child_organization_id=child_id,
                    defaults={'is_active': True},
                )

            # Keep assignment parent links aligned with project hierarchy links.
            parent_assignment_by_child_org: dict[int, int] = {}
            for parent_org_id, child_org_id in sorted(desired_pairs):
                if child_org_id in parent_assignment_by_child_org:
                    continue
                parent_assignment = ProjectOrganization.objects.filter(
                    project=project,
                    organization_id=parent_org_id,
                ).first()
                child_assignment = ProjectOrganization.objects.filter(
                    project=project,
                    organization_id=child_org_id,
                ).first()
                if not parent_assignment or not child_assignment:
                    continue
                parent_assignment_by_child_org[child_org_id] = parent_assignment.id
                if child_assignment.parent_assignment_id != parent_assignment.id or not child_assignment.is_sub_grantee:
                    child_assignment.parent_assignment_id = parent_assignment.id
                    child_assignment.is_sub_grantee = True
                    child_assignment.save(update_fields=['parent_assignment', 'is_sub_grantee', 'updated_at'])
                if not parent_assignment.is_coordinator:
                    parent_assignment.is_coordinator = True
                    parent_assignment.save(update_fields=['is_coordinator', 'updated_at'])

            # Clear parent_assignment for rows no longer linked under this project.
            if replace:
                active_child_org_ids = set(parent_assignment_by_child_org.keys())
                stale_child_rows = ProjectOrganization.objects.filter(
                    project=project,
                    parent_assignment__isnull=False,
                )
                if active_child_org_ids:
                    stale_child_rows = stale_child_rows.exclude(organization_id__in=active_child_org_ids)
                stale_child_rows.update(parent_assignment=None)

            # Dual-write: keep hierarchy_overrides JSON in sync for backward compat.
            from collections import defaultdict
            children_by_parent: dict[str, list[str]] = defaultdict(list)
            for parent_id, child_id in desired_pairs:
                children_by_parent[str(parent_id)].append(str(child_id))
            project.hierarchy_overrides = dict(children_by_parent)
            project.save(update_fields=['hierarchy_overrides', 'updated_at'])

        except DatabaseError:
            return Response(
                {'detail': 'Project hierarchy tables are not yet available. Run migrations first.'},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        return Response({'detail': 'Hierarchy links updated.', 'links_updated': len(desired_pairs)})

    @action(detail=True, methods=['post'])
    def set_indicator_assignments(self, request, pk=None):
        """Upsert project indicator assignments and optional disaggregation rules."""
        project = self.get_object()
        assignment_rows = request.data.get('assignments')
        replace = bool(request.data.get('replace', True))
        if not isinstance(assignment_rows, list):
            return Response({'detail': 'assignments must be an array.'}, status=status.HTTP_400_BAD_REQUEST)

        project_scope_org_ids = self._project_scope_org_ids(project)
        allowed_org_ids = None if is_organization_admin(request.user) else set(get_user_organization_ids(request.user) or [])
        total_assignments = 0
        total_rules = 0

        try:
            for row in assignment_rows:
                if not isinstance(row, dict):
                    return Response({'detail': 'Each assignment entry must be an object.'}, status=status.HTTP_400_BAD_REQUEST)
                try:
                    indicator_id = int(row.get('indicator_id'))
                except (TypeError, ValueError):
                    return Response({'detail': 'indicator_id must be an integer.'}, status=status.HTTP_400_BAD_REQUEST)

                ensure_project_indicator_link(project, indicator_id)
                project_indicator = ProjectIndicator.objects.filter(
                    project=project,
                    indicator_id=indicator_id,
                ).first()
                if project_indicator is None:
                    continue

                organization_ids = row.get('organization_ids') or []
                if not isinstance(organization_ids, list):
                    return Response({'detail': 'organization_ids must be an array.'}, status=status.HTTP_400_BAD_REQUEST)
                normalized_org_ids = set()
                for raw_org_id in organization_ids:
                    try:
                        normalized_org_id = int(raw_org_id)
                    except (TypeError, ValueError):
                        return Response({'detail': 'organization_ids must contain integers.'}, status=status.HTTP_400_BAD_REQUEST)
                    if project_scope_org_ids and normalized_org_id not in project_scope_org_ids:
                        return Response(
                            {'detail': f'Organization {normalized_org_id} is not in project scope.'},
                            status=status.HTTP_400_BAD_REQUEST,
                        )
                    if allowed_org_ids is not None and normalized_org_id not in allowed_org_ids:
                        raise PermissionDenied('You do not have permission to assign indicators for this organization.')
                    normalized_org_ids.add(normalized_org_id)

                project_assignments_by_org_id = {
                    int(row.organization_id): row
                    for row in ProjectOrganization.objects.filter(
                        project=project,
                        organization_id__in=normalized_org_ids,
                    )
                }

                if replace:
                    ProjectIndicatorAssignment.objects.filter(
                        project_indicator=project_indicator,
                        assignment_source__in=['manual', 'project_scope', 'organization_target', 'aggregate_history'],
                    ).exclude(
                        organization_id__in=normalized_org_ids,
                    ).update(
                        is_active=False,
                    )

                for organization_id in normalized_org_ids:
                    project_assignment = project_assignments_by_org_id.get(int(organization_id))
                    if project_assignment and (not project_assignment.is_implementer or not project_assignment.can_report_indicators):
                        project_assignment.is_implementer = True
                        project_assignment.can_report_indicators = True
                        project_assignment.save(update_fields=['is_implementer', 'can_report_indicators', 'updated_at'])

                    ProjectIndicatorAssignment.objects.update_or_create(
                        project_indicator=project_indicator,
                        organization_id=organization_id,
                        defaults={
                            'project_organization': project_assignment,
                            'assignment_source': 'manual',
                            'is_active': True,
                        },
                    )
                    total_assignments += 1

                rule_rows = row.get('disaggregation_rules') or []
                if rule_rows and not isinstance(rule_rows, list):
                    return Response({'detail': 'disaggregation_rules must be an array.'}, status=status.HTTP_400_BAD_REQUEST)

                if replace and isinstance(rule_rows, list):
                    ProjectIndicatorDisaggregationRule.objects.filter(
                        project_indicator=project_indicator,
                        is_active=True,
                    ).update(is_active=False)

                for rule in rule_rows:
                    if not isinstance(rule, dict):
                        return Response({'detail': 'Each disaggregation rule must be an object.'}, status=status.HTTP_400_BAD_REQUEST)
                    dimension_key = str(rule.get('dimension_key') or '').strip()
                    if not dimension_key:
                        return Response({'detail': 'dimension_key is required for disaggregation rules.'}, status=status.HTTP_400_BAD_REQUEST)

                    raw_rule_org = rule.get('organization_id')
                    rule_org_id = None
                    if raw_rule_org not in (None, ''):
                        try:
                            rule_org_id = int(raw_rule_org)
                        except (TypeError, ValueError):
                            return Response({'detail': 'organization_id in rule must be an integer.'}, status=status.HTTP_400_BAD_REQUEST)
                        if project_scope_org_ids and rule_org_id not in project_scope_org_ids:
                            return Response(
                                {'detail': f'Rule organization {rule_org_id} is not in project scope.'},
                                status=status.HTTP_400_BAD_REQUEST,
                            )
                        if allowed_org_ids is not None and rule_org_id not in allowed_org_ids:
                            raise PermissionDenied('You do not have permission to set disaggregation rules for this organization.')

                    ProjectIndicatorDisaggregationRule.objects.update_or_create(
                        project_indicator=project_indicator,
                        organization_id=rule_org_id,
                        dimension_key=dimension_key,
                        defaults={
                            'display_label': str(rule.get('display_label') or '').strip(),
                            'is_required': bool(rule.get('is_required', False)),
                            'is_active': bool(rule.get('is_active', True)),
                            'sort_order': int(rule.get('sort_order') or 0),
                            'config': rule.get('config') if isinstance(rule.get('config'), dict) else {},
                        },
                    )
                    total_rules += 1
        except DatabaseError:
            return Response(
                {'detail': 'Project setup tables are not yet available. Run migrations first.'},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        return Response(
            {
                'detail': 'Project indicator assignments updated.',
                'assignments_updated': total_assignments,
                'disaggregation_rules_updated': total_rules,
            }
        )

    @action(detail=True, methods=['post'])
    def training_reset(self, request, pk=None):
        """
        Admin-only: clear all training data for a training project.
        Requires is_training=True on the project. Never touches production data.
        """
        if not is_organization_admin(request.user):
            raise PermissionDenied('Only admins can reset training data.')

        project = self.get_object()
        if not project.is_training:
            return Response(
                {'detail': 'training_reset can only be used on projects marked as is_training=True.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Safety: confirm before destructive action unless confirm=true is sent.
        confirmed = str(request.data.get('confirm') or '').strip().lower() in {'1', 'true', 'yes'}
        if not confirmed:
            return Response(
                {
                    'detail': (
                        'You are about to clear demo/training data only. '
                        'Production data will not be touched. '
                        'Send confirm=true to proceed.'
                    ),
                    'project': project.name,
                    'requires_confirmation': True,
                },
                status=status.HTTP_200_OK,
            )

        from django.db import transaction as db_transaction
        from aggregates.models import Aggregate
        summary = {}

        with db_transaction.atomic():
            # Delete aggregate records for this training project.
            agg_qs = Aggregate.objects.filter(project=project)
            summary['aggregates_deleted'] = agg_qs.count()
            agg_qs.delete()

            # Delete narrative reports for this training project.
            nr_qs = project.narrative_reports.all()
            summary['narrative_reports_deleted'] = nr_qs.count()
            nr_qs.delete()

            # Delete tasks for this training project.
            task_qs = project.tasks.all()
            summary['tasks_deleted'] = task_qs.count()
            task_qs.delete()

            # Delete deadlines for this training project.
            dl_qs = project.deadlines.all()
            summary['deadlines_deleted'] = dl_qs.count()
            dl_qs.delete()

            # Delete project activities for this training project.
            pa_qs = project.activities.all()
            summary['activities_deleted'] = pa_qs.count()
            pa_qs.delete()

        summary['production_records_touched'] = 0
        summary['project'] = project.name
        summary['detail'] = 'Training data reset successfully. Production data was not touched.'
        return Response(summary, status=status.HTTP_200_OK)


class TaskViewSet(viewsets.ModelViewSet):
    """ViewSet for managing tasks."""
    
    queryset = Task.objects.all()
    serializer_class = TaskSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ['project', 'status', 'priority', 'assigned_to']
    search_fields = ['name', 'description']
    ordering_fields = ['due_date', 'priority', 'created_at']
    ordering = ['due_date', '-priority']
    
    def get_queryset(self):
        queryset = Task.objects.select_related('project', 'assigned_to', 'created_by')
        queryset = apply_training_filter(queryset, self.request, project_lookup='project')
        user = self.request.user
        if is_organization_admin(user):
            return queryset
        org_ids = get_user_organization_ids(user)
        if org_ids:
            return filter_queryset_by_org_ids(queryset, 'project__organizations__id', org_ids).distinct()
        return queryset.filter(assigned_to=user)
    
    def perform_create(self, serializer):
        _guard_project_write(self.request, serializer)
        serializer.save(created_by=self.request.user)

    def perform_update(self, serializer):
        _guard_project_write(self.request, serializer)
        serializer.save()

    @action(detail=True, methods=['post'])
    def complete(self, request, pk=None):
        """Mark task as complete."""
        task = self.get_object()
        task.status = 'completed'
        task.completed_at = timezone.now()
        task.save()
        return Response(TaskSerializer(task).data)


class DeadlineViewSet(viewsets.ModelViewSet):
    """ViewSet for managing deadlines."""
    
    queryset = Deadline.objects.all()
    serializer_class = DeadlineSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ['project', 'status']
    search_fields = ['name', 'description']
    ordering_fields = ['due_date', 'created_at']
    ordering = ['due_date']
    
    def get_queryset(self):
        queryset = Deadline.objects.select_related(
            'project', 'submitted_by'
        ).prefetch_related('indicators')
        queryset = apply_training_filter(queryset, self.request, project_lookup='project')
        user = self.request.user
        if is_organization_admin(user):
            return queryset
        org_ids = get_user_organization_ids(user)
        if org_ids:
            queryset = filter_queryset_by_org_ids(queryset, 'project__organizations__id', org_ids).distinct()
        else:
            queryset = Deadline.objects.none()

        def _to_int(value):
            try:
                return int(value)
            except (TypeError, ValueError):
                return None

        coordinator_param = self.request.query_params.get('coordinator')
        organization_param = self.request.query_params.get('organization')
        project_param = self.request.query_params.get('project')
        date_from = self.request.query_params.get('date_from')
        date_to = self.request.query_params.get('date_to')

        coordinator_id = _to_int(coordinator_param) if coordinator_param not in (None, "") else None
        organization_id = _to_int(organization_param) if organization_param not in (None, "") else None
        project_id = _to_int(project_param) if project_param not in (None, "") else None

        scoped_org_ids = None
        if coordinator_id is not None:
            scoped_org_ids = resolve_organization_scope_with_project_hierarchy(
                coordinator_id,
                project_id=project_id,
            )
        if organization_id is not None:
            organization_scope = resolve_organization_scope_with_project_hierarchy(
                organization_id,
                project_id=project_id,
            )
            scoped_org_ids = (
                organization_scope
                if scoped_org_ids is None
                else scoped_org_ids.intersection(organization_scope)
            )
        if scoped_org_ids is not None:
            if len(scoped_org_ids) == 0:
                return queryset.none()
            queryset = queryset.filter(project__organizations__id__in=scoped_org_ids).distinct()

        if date_from:
            queryset = queryset.filter(due_date__gte=date_from)
        if date_to:
            queryset = queryset.filter(due_date__lte=date_to)

        upcoming = str(self.request.query_params.get('upcoming', '')).lower()
        if upcoming in {'1', 'true', 'yes'}:
            try:
                days = int(self.request.query_params.get('days', 7))
            except (TypeError, ValueError):
                days = 7
            if days < 0:
                days = 7
            today = timezone.now().date()
            cutoff = today + timezone.timedelta(days=days)
            queryset = queryset.filter(
                status='pending',
                due_date__gte=today,
                due_date__lte=cutoff,
            )
        return queryset
    
    @action(detail=False, methods=['get'])
    def upcoming(self, request):
        """Get upcoming deadlines."""
        try:
            days = int(request.query_params.get('days', 7))
        except (TypeError, ValueError):
            days = 7
        if days < 0:
            days = 7
        today = timezone.now().date()
        cutoff = timezone.now().date() + timezone.timedelta(days=days)
        deadlines = self.get_queryset().filter(
            status='pending',
            due_date__gte=today,
            due_date__lte=cutoff
        )
        return Response(DeadlineSerializer(deadlines, many=True).data)
    
    def perform_create(self, serializer):
        _guard_project_write(self.request, serializer)
        serializer.save()

    def perform_update(self, serializer):
        _guard_project_write(self.request, serializer)
        serializer.save()

    @action(detail=True, methods=['post'])
    def submit(self, request, pk=None):
        """Submit deadline."""
        deadline = self.get_object()
        deadline.status = 'submitted'
        deadline.submitted_at = timezone.now()
        deadline.submitted_by = request.user
        deadline.save()
        return Response(DeadlineSerializer(deadline).data)



class ProjectActivityViewSet(viewsets.ModelViewSet):
    """ViewSet for project activities."""

    queryset = ProjectActivity.objects.select_related('project', 'organization', 'created_by').all()
    serializer_class = ProjectActivitySerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ['project', 'status', 'organization', 'visible_to_all']
    search_fields = ['title', 'description']
    ordering = ['start_date', 'title']

    def get_queryset(self):
        qs = ProjectActivity.objects.select_related('project', 'organization', 'created_by')
        qs = apply_training_filter(qs, self.request, project_lookup='project')
        user = self.request.user
        if is_organization_admin(user):
            return qs
        org_ids = get_user_organization_ids(user)
        return qs.filter(
            Q(visible_to_all=True) | Q(organization_id__in=org_ids)
        )

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)


class ClientOrganizationViewSet(viewsets.ModelViewSet):
    """ViewSet for client/funder organizations."""

    queryset = ClientOrganization.objects.prefetch_related('projects').all()
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ['is_active']
    search_fields = ['name', 'description', 'contact_name', 'contact_email']
    ordering = ['name']

    def get_serializer_class(self):
        from .serializers import ClientOrganizationSerializer
        return ClientOrganizationSerializer

    def get_queryset(self):
        from .models import ClientOrganization
        from organizations.access import apply_training_filter_via_projects
        user = self.request.user
        qs = ClientOrganization.objects.prefetch_related('projects')
        # Hide client orgs linked only to training projects from live views.
        qs = apply_training_filter_via_projects(qs, self.request, projects_lookup='projects')
        if is_organization_admin(user):
            return qs
        return qs.filter(is_active=True)


class NarrativeReportViewSet(viewsets.ModelViewSet):
    """ViewSet for narrative report uploads."""

    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser]
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ['project', 'organization']
    ordering = ['-created_at']
    http_method_names = ['get', 'post', 'patch', 'delete', 'head', 'options']

    def get_serializer_class(self):
        from .serializers import NarrativeReportSerializer
        return NarrativeReportSerializer

    def get_queryset(self):
        from .models import NarrativeReport
        qs = NarrativeReport.objects.select_related('project', 'organization', 'uploaded_by')
        user = self.request.user
        if not is_organization_admin(user):
            org_ids = get_user_organization_ids(user)
            qs = qs.filter(organization_id__in=org_ids)
        return apply_training_filter(qs, self.request, project_lookup='project')

    def perform_create(self, serializer):
        _guard_project_write(self.request, serializer)
        serializer.save(uploaded_by=self.request.user)

    def perform_update(self, serializer):
        _guard_project_write(self.request, serializer)
        serializer.save()
