from django.db import DatabaseError
from collections import defaultdict
from rest_framework import serializers
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
from .hierarchy import normalize_project_hierarchy_overrides
from .project_scope_sync import sync_project_scope_tables


class ProjectIndicatorSerializer(serializers.ModelSerializer):
    """Serializer for ProjectIndicator through model."""
    
    indicator_name = serializers.CharField(source='indicator.name', read_only=True)
    indicator_code = serializers.CharField(source='indicator.code', read_only=True)
    progress = serializers.SerializerMethodField()
    
    class Meta:
        model = ProjectIndicator
        fields = [
            'id', 'project', 'indicator', 'indicator_name', 'indicator_code',
            'target_value', 'current_value', 'baseline_value', 'progress'
        ]
    
    def get_progress(self, obj):
        if obj.target_value == 0:
            return 0
        return min(int((obj.current_value / obj.target_value) * 100), 100)


class ProjectSerializer(serializers.ModelSerializer):
    """Serializer for Project model."""
    
    created_by_name = serializers.CharField(source='created_by.username', read_only=True)
    indicators_count = serializers.SerializerMethodField()
    tasks_count = serializers.SerializerMethodField()
    progress_percentage = serializers.IntegerField(read_only=True)
    client_organizations = serializers.SerializerMethodField()
    
    class Meta:
        model = Project
        fields = [
            'id', 'name', 'code', 'description', 'funder', 'status',
            'start_date', 'end_date', 'organizations', 'assigned_users',
            'indicators_count',
            'tasks_count', 'progress_percentage', 'hierarchy_overrides',
            'client_organizations',
            'is_training', 'training_expires_after_days', 'training_notes',
            'created_at', 'updated_at', 'created_by', 'created_by_name',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at', 'created_by']
    
    def get_indicators_count(self, obj):
        annotated_count = getattr(obj, 'indicators_count', None)
        if annotated_count is not None:
            return annotated_count
        return obj.indicators.count()
    
    def get_tasks_count(self, obj):
        annotated_count = getattr(obj, 'tasks_count', None)
        if annotated_count is not None:
            return annotated_count
        return obj.tasks.count()

    def get_client_organizations(self, obj):
        try:
            rows = obj.client_organizations.all().order_by('name')
        except DatabaseError:
            return []
        return [
            {
                'id': str(row.id),
                'name': row.name or '',
            }
            for row in rows
        ]

    def to_representation(self, instance):
        data = super().to_representation(instance)
        completed = getattr(instance, 'completed_indicators_count', None)
        total = getattr(instance, 'total_project_indicators', None)
        if completed is not None and total is not None:
            data['progress_percentage'] = int((completed / total) * 100) if total else 0
        return data

    def create(self, validated_data):
        project = super().create(validated_data)
        sync_project_scope_tables(project)
        return project

    def update(self, instance, validated_data):
        project = super().update(instance, validated_data)
        sync_project_scope_tables(project)
        return project

    def _is_admin_request(self):
        from organizations.access import is_organization_admin
        request = self.context.get('request')
        return request is not None and is_organization_admin(request.user)

    def validate_assigned_users(self, value):
        # Only admins may manage which users are assigned to a project.
        if not self._is_admin_request():
            if self.instance is not None:
                return list(self.instance.assigned_users.all())
            return []
        return value

    def validate_is_training(self, value):
        if not self._is_admin_request():
            # Non-admins cannot change is_training; preserve existing or default False
            if self.instance is not None:
                return self.instance.is_training
            return False
        return value

    def validate(self, attrs):
        organizations_payload = attrs.get('organizations')
        hierarchy_in_payload = 'hierarchy_overrides' in attrs

        if organizations_payload is None and not hierarchy_in_payload:
            return attrs

        if organizations_payload is not None:
            allowed_org_ids = {int(org.id) for org in organizations_payload}
        elif self.instance is not None:
            allowed_org_ids = set(self.instance.organizations.values_list('id', flat=True))
        else:
            allowed_org_ids = set()

        source_overrides = (
            attrs.get('hierarchy_overrides')
            if hierarchy_in_payload
            else getattr(self.instance, 'hierarchy_overrides', {})
        )

        if self.instance is None and organizations_payload is None and source_overrides:
            raise serializers.ValidationError(
                {'hierarchy_overrides': 'Set project organizations before configuring hierarchy overrides.'}
            )

        try:
            attrs['hierarchy_overrides'] = normalize_project_hierarchy_overrides(
                source_overrides,
                allowed_org_ids=allowed_org_ids,
            )
        except ValueError as exc:
            raise serializers.ValidationError({'hierarchy_overrides': str(exc)})

        return attrs


class ProjectDetailSerializer(ProjectSerializer):
    """Detailed serializer including indicators."""
    
    project_indicators = serializers.SerializerMethodField()
    organization_targets = serializers.SerializerMethodField()
    project_organizations = serializers.SerializerMethodField()
    project_hierarchy_links = serializers.SerializerMethodField()
    project_indicator_assignments = serializers.SerializerMethodField()
    project_disaggregation_rules = serializers.SerializerMethodField()
    
    class Meta(ProjectSerializer.Meta):
        fields = ProjectSerializer.Meta.fields + [
            'project_indicators',
            'organization_targets',
            'project_organizations',
            'project_hierarchy_links',
            'project_indicator_assignments',
            'project_disaggregation_rules',
        ]
    
    def get_project_indicators(self, obj):
        project_indicators = getattr(obj, 'projectindicator_set', None)
        if project_indicators is None:
            project_indicators = ProjectIndicator.objects.filter(project=obj).select_related('indicator')
        return ProjectIndicatorSerializer(project_indicators, many=True).data

    def get_organization_targets(self, obj):
        try:
            rows = list(
                ProjectIndicatorOrganizationTarget.objects.filter(
                    project_indicator__project=obj
                ).select_related(
                    'project_indicator__indicator',
                    'organization',
                ).order_by(
                    'project_indicator__indicator__name',
                    'organization__name',
                    'id',
                )
            )
        except DatabaseError:
            return []

        results = []
        for row in rows:
            project_indicator = row.project_indicator
            indicator = project_indicator.indicator
            organization = row.organization
            project_id = project_indicator.project_id
            indicator_id = indicator.id
            indicator_name = indicator.name or ''
            indicator_code = indicator.code or ''
            organization_id = organization.id
            organization_name = organization.name or ''
            organization_code = organization.code or ''
            q1_target = row.q1_target
            q2_target = row.q2_target
            q3_target = row.q3_target
            q4_target = row.q4_target
            target_value = row.target_value
            current_value = row.current_value
            baseline_value = row.baseline_value

            progress = 0
            if target_value and float(target_value) > 0:
                progress = min(int((float(current_value or 0) / float(target_value)) * 100), 100)

            results.append(
                {
                    'id': str(row.id),
                    'project': str(project_id),
                    'project_name': obj.name,
                    'project_code': obj.code,
                    'indicator': str(indicator_id),
                    'indicator_name': indicator_name,
                    'indicator_code': indicator_code,
                    'organization': str(organization_id),
                    'organization_name': organization_name,
                    'organization_code': organization_code,
                    'q1_target': q1_target,
                    'q2_target': q2_target,
                    'q3_target': q3_target,
                    'q4_target': q4_target,
                    'target_value': target_value,
                    'current_value': current_value,
                    'baseline_value': baseline_value,
                    'progress': progress,
                }
            )

        return results

    def get_project_organizations(self, obj):
        try:
            rows = list(
                ProjectOrganization.objects.filter(
                    project=obj
                ).select_related(
                    'organization',
                    'client',
                    'parent_assignment',
                    'parent_assignment__organization',
                ).order_by(
                    '-is_active',
                    'organization__name',
                    'id',
                )
            )
        except DatabaseError:
            rows = []

        if rows:
            org_ids = [row.organization_id for row in rows]
            assigned_indicator_ids_by_org: dict[int, set[int]] = defaultdict(set)
            reported_indicator_ids_by_org: dict[int, set[int]] = defaultdict(set)

            try:
                assignment_rows = ProjectIndicatorAssignment.objects.filter(
                    project_indicator__project=obj,
                    organization_id__in=org_ids,
                    is_active=True,
                ).values_list('organization_id', 'project_indicator__indicator_id')
                for organization_id, indicator_id in assignment_rows:
                    assigned_indicator_ids_by_org[int(organization_id)].add(int(indicator_id))
            except DatabaseError:
                pass

            try:
                from aggregates.models import Aggregate

                reported_rows = Aggregate.objects.filter(
                    project=obj,
                    organization_id__in=org_ids,
                ).exclude(
                    status__in=['draft', 'rejected'],
                ).values_list('organization_id', 'indicator_id')
                for organization_id, indicator_id in reported_rows:
                    reported_indicator_ids_by_org[int(organization_id)].add(int(indicator_id))
            except Exception:
                # Aggregates app may be unavailable in legacy/test bootstrap paths.
                pass

            def _normalize_scope_list(raw_value):
                if isinstance(raw_value, list):
                    return [str(value).strip() for value in raw_value if str(value).strip()]
                if isinstance(raw_value, str):
                    return [entry.strip() for entry in raw_value.split(',') if entry.strip()]
                return []

            def _partner_type_label(row):
                # There is exactly one overseer per project — BONASO, the
                # Project Senior Coordinator / Admin. It is identified by the
                # 'lead' project role (or the BONASO org name), NOT by org type:
                # most partners are NGOs and must not be labelled overseer.
                org = getattr(row, 'organization', None)
                try:
                    from analysis.views import _is_bonaso_organization_name
                    is_bonaso = _is_bonaso_organization_name(getattr(org, 'name', ''))
                except Exception:
                    is_bonaso = False
                if row.role == 'lead' or is_bonaso:
                    return 'Project Senior Coordinator / Admin'
                if row.is_coordinator and row.is_implementer:
                    return 'Coordinator + Implementer'
                if row.is_coordinator:
                    return 'Coordinator'
                if row.is_sub_grantee:
                    return 'Sub-grantee'
                if row.is_implementer:
                    return 'Implementer'
                return (row.role or 'other').replace('_', ' ').title()

            def _reporting_status(row, assigned_count: int, reported_count: int):
                if not row.can_report_indicators:
                    return 'reporting_disabled'
                if assigned_count <= 0:
                    return 'not_assigned'
                if reported_count <= 0:
                    return 'not_reporting'
                if reported_count < assigned_count:
                    return 'partially_reporting'
                return 'reporting'

            return [
                {
                    'id': str(row.id),
                    'project': str(obj.id),
                    'client': str(row.client_id) if row.client_id else None,
                    'client_name': row.client.name if row.client_id else None,
                    'organization': str(row.organization_id),
                    'organization_name': row.organization.name or '',
                    'organization_code': row.organization.code or '',
                    'parent_assignment': str(row.parent_assignment_id) if row.parent_assignment_id else None,
                    'parent_organization': (
                        str(row.parent_assignment.organization_id)
                        if row.parent_assignment_id else None
                    ),
                    'parent_organization_name': (
                        row.parent_assignment.organization.name
                        if row.parent_assignment_id and row.parent_assignment.organization_id
                        else None
                    ),
                    'role': row.role,
                    'cluster': row.cluster or '',
                    'is_coordinator': bool(row.is_coordinator),
                    'is_sub_grantee': bool(row.is_sub_grantee),
                    'is_implementer': bool(row.is_implementer),
                    'can_report_indicators': bool(row.can_report_indicators),
                    'partner_type': _partner_type_label(row),
                    'thematic_areas': _normalize_scope_list(row.thematic_areas),
                    'districts': _normalize_scope_list(row.districts),
                    'localities': _normalize_scope_list(row.localities),
                    'contract_start_date': row.contract_start_date,
                    'contract_end_date': row.contract_end_date,
                    'source_sheet': row.source_sheet or '',
                    'source_row': row.source_row,
                    'is_training': bool(row.is_training),
                    'is_active': bool(row.is_active),
                    'implementation_scope': row.implementation_scope or {},
                    'assigned_indicator_count': len(
                        assigned_indicator_ids_by_org.get(int(row.organization_id), set())
                    ),
                    'reported_indicator_count': len(
                        reported_indicator_ids_by_org.get(int(row.organization_id), set())
                    ),
                    'reporting_status': _reporting_status(
                        row,
                        len(assigned_indicator_ids_by_org.get(int(row.organization_id), set())),
                        len(reported_indicator_ids_by_org.get(int(row.organization_id), set())),
                    ),
                }
                for row in rows
            ]

        return [
            {
                'id': f'legacy-{organization.id}',
                'project': str(obj.id),
                'client': None,
                'client_name': None,
                'organization': str(organization.id),
                'organization_name': organization.name or '',
                'organization_code': organization.code or '',
                'parent_assignment': None,
                'parent_organization': None,
                'parent_organization_name': None,
                'role': 'implementing_partner',
                'cluster': '',
                'is_coordinator': False,
                'is_sub_grantee': False,
                'is_implementer': True,
                'can_report_indicators': True,
                'partner_type': 'Implementer',
                'thematic_areas': [],
                'districts': [],
                'localities': [],
                'contract_start_date': None,
                'contract_end_date': None,
                'source_sheet': '',
                'source_row': None,
                'is_training': bool(getattr(obj, 'is_training', False)),
                'is_active': True,
                'implementation_scope': {},
                'assigned_indicator_count': 0,
                'reported_indicator_count': 0,
                'reporting_status': 'not_assigned',
            }
            for organization in obj.organizations.all().order_by('name')
        ]

    def get_project_hierarchy_links(self, obj):
        try:
            rows = list(
                ProjectOrganizationHierarchy.objects.filter(
                    project=obj
                ).select_related(
                    'parent_organization',
                    'child_organization',
                ).order_by(
                    '-is_active',
                    'parent_organization__name',
                    'child_organization__name',
                    'id',
                )
            )
        except DatabaseError:
            rows = []

        if rows:
            return [
                {
                    'id': str(row.id),
                    'project': str(obj.id),
                    'parent_organization': str(row.parent_organization_id),
                    'parent_organization_name': row.parent_organization.name or '',
                    'child_organization': str(row.child_organization_id),
                    'child_organization_name': row.child_organization.name or '',
                    'is_active': bool(row.is_active),
                }
                for row in rows
            ]

        fallback_rows = []
        for parent_id, child_ids in (obj.hierarchy_overrides or {}).items():
            parent_id_str = str(parent_id)
            for child_id in child_ids or []:
                fallback_rows.append(
                    {
                        'id': f'legacy-{parent_id_str}-{child_id}',
                        'project': str(obj.id),
                        'parent_organization': parent_id_str,
                        'parent_organization_name': '',
                        'child_organization': str(child_id),
                        'child_organization_name': '',
                        'is_active': True,
                    }
                )
        return fallback_rows

    def get_project_indicator_assignments(self, obj):
        try:
            rows = list(
                ProjectIndicatorAssignment.objects.filter(
                    project_indicator__project=obj
                ).select_related(
                    'project_indicator__indicator',
                    'organization',
                ).order_by(
                    'project_indicator__indicator__name',
                    'organization__name',
                    'id',
                )
            )
        except DatabaseError:
            return []

        return [
            {
                'id': str(row.id),
                'project': str(obj.id),
                'project_indicator': str(row.project_indicator_id),
                'project_organization': str(row.project_organization_id) if row.project_organization_id else None,
                'indicator': str(row.project_indicator.indicator_id),
                'indicator_name': row.project_indicator.indicator.name or '',
                'indicator_code': row.project_indicator.indicator.code or '',
                'organization': str(row.organization_id),
                'organization_name': row.organization.name or '',
                'organization_code': row.organization.code or '',
                'assignment_source': row.assignment_source,
                'is_active': bool(row.is_active),
                'assignment_metadata': row.assignment_metadata or {},
            }
            for row in rows
        ]

    def get_project_disaggregation_rules(self, obj):
        try:
            rows = list(
                ProjectIndicatorDisaggregationRule.objects.filter(
                    project_indicator__project=obj
                ).select_related(
                    'project_indicator__indicator',
                    'organization',
                ).order_by(
                    'project_indicator__indicator__name',
                    'organization__name',
                    'sort_order',
                    'id',
                )
            )
        except DatabaseError:
            return []

        return [
            {
                'id': str(row.id),
                'project': str(obj.id),
                'project_indicator': str(row.project_indicator_id),
                'indicator': str(row.project_indicator.indicator_id),
                'indicator_name': row.project_indicator.indicator.name or '',
                'indicator_code': row.project_indicator.indicator.code or '',
                'organization': str(row.organization_id) if row.organization_id else None,
                'organization_name': row.organization.name if row.organization_id else None,
                'dimension_key': row.dimension_key,
                'display_label': row.display_label,
                'is_required': bool(row.is_required),
                'is_active': bool(row.is_active),
                'sort_order': int(row.sort_order or 0),
                'config': row.config or {},
            }
            for row in rows
        ]


class TaskSerializer(serializers.ModelSerializer):
    """Serializer for Task model."""
    
    project_name = serializers.CharField(source='project.name', read_only=True)
    assigned_to_name = serializers.CharField(source='assigned_to.username', read_only=True)
    created_by_name = serializers.CharField(source='created_by.username', read_only=True)
    
    class Meta:
        model = Task
        fields = [
            'id', 'project', 'project_name', 'name', 'description', 'status',
            'priority', 'assigned_to', 'assigned_to_name', 'due_date',
            'completed_at', 'created_at', 'updated_at', 'created_by', 'created_by_name'
        ]
        read_only_fields = ['id', 'created_at', 'updated_at', 'created_by', 'completed_at']


class DeadlineSerializer(serializers.ModelSerializer):
    """Serializer for Deadline model."""
    
    project_name = serializers.CharField(source='project.name', read_only=True)
    submitted_by_name = serializers.CharField(source='submitted_by.username', read_only=True)
    days_remaining = serializers.SerializerMethodField()
    
    class Meta:
        model = Deadline
        fields = [
            'id', 'project', 'project_name', 'name', 'description', 'due_date',
            'status', 'indicators', 'submitted_at', 'submitted_by',
            'submitted_by_name', 'days_remaining', 'created_at', 'updated_at'
        ]
        read_only_fields = ['id', 'created_at', 'updated_at', 'submitted_at', 'submitted_by']
    
    def get_days_remaining(self, obj):
        from django.utils import timezone
        if obj.status in ['submitted', 'approved']:
            return None
        delta = obj.due_date - timezone.now().date()
        return delta.days


class ProjectActivitySerializer(serializers.ModelSerializer):
    project_name = serializers.CharField(source='project.name', read_only=True)
    organization_name = serializers.CharField(source='organization.name', read_only=True)
    created_by_name = serializers.CharField(source='created_by.username', read_only=True)

    class Meta:
        model = ProjectActivity
        fields = [
            'id', 'project', 'project_name', 'title', 'description', 'status',
            'start_date', 'end_date', 'visible_to_all',
            'organization', 'organization_name',
            'created_by', 'created_by_name',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'created_by', 'created_at', 'updated_at']


class ClientOrganizationSerializer(serializers.ModelSerializer):
    project_count = serializers.SerializerMethodField()

    class Meta:
        model = ClientOrganization
        fields = [
            'id', 'name', 'description', 'contact_name', 'contact_email',
            'contact_phone', 'website', 'is_active', 'projects', 'project_count',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']

    def get_project_count(self, obj):
        return obj.projects.count()


class NarrativeReportSerializer(serializers.ModelSerializer):
    project_name = serializers.CharField(source='project.name', read_only=True)
    organization_name = serializers.CharField(source='organization.name', read_only=True)
    uploaded_by_name = serializers.CharField(source='uploaded_by.username', read_only=True)
    file_url = serializers.SerializerMethodField()

    class Meta:
        model = NarrativeReport
        fields = [
            'id', 'project', 'project_name', 'organization', 'organization_name',
            'title', 'description', 'file', 'file_url', 'file_name',
            'uploaded_by', 'uploaded_by_name',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'file_url', 'file_name', 'uploaded_by', 'created_at', 'updated_at']

    def get_file_url(self, obj):
        request = self.context.get('request')
        if obj.file and request:
            return request.build_absolute_uri(obj.file.url)
        return None
