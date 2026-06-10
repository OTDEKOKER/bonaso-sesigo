# respondents/views.py

from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response as DRFResponse
from rest_framework.permissions import IsAuthenticated
from rest_framework.exceptions import PermissionDenied
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework.filters import SearchFilter, OrderingFilter
from django.db.models import Count, Max, Prefetch
from django.http import HttpResponse
import csv
from organizations.access import get_user_organization_ids, is_organization_admin, filter_queryset_by_org_ids, apply_training_filter, assert_project_write_allowed
from projects.scope import filter_queryset_by_assigned_projects
from idempotency.mixins import IdempotentMutationMixin
from projects.assignment_rules import (
    is_indicator_assigned_to_organization,
    is_organization_in_project_scope,
)

from .models import Respondent, Interaction, Response
from .serializers import (
    RespondentSerializer,
    RespondentProfileSerializer,
    InteractionSerializer,
    InteractionCreateSerializer,
    ResponseSerializer
)


class RespondentViewSet(IdempotentMutationMixin, viewsets.ModelViewSet):
    """ViewSet for managing respondents."""
    
    queryset = Respondent.objects.all()
    serializer_class = RespondentSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ['organization', 'gender', 'is_active']
    search_fields = ['unique_id', 'first_name', 'last_name', 'phone', 'email']
    ordering_fields = ['last_name', 'first_name', 'created_at', 'unique_id']
    ordering = ['last_name', 'first_name']
    
    def get_queryset(self):
        """Filter queryset by user role and organization."""
        queryset = Respondent.objects.select_related(
            'organization', 'created_by'
        ).annotate(
            interactions_count=Count('interactions', distinct=True),
            last_interaction_date=Max('interactions__date'),
        )

        if self.action in {'retrieve', 'profile'}:
            queryset = queryset.prefetch_related(
                Prefetch(
                    'interactions',
                    queryset=Interaction.objects.select_related(
                        'respondent', 'assessment', 'project', 'event', 'created_by'
                    ).annotate(
                        responses_count=Count('responses', distinct=True)
                    ).prefetch_related(
                        Prefetch(
                            'responses',
                            queryset=Response.objects.select_related('indicator', 'question'),
                        )
                    ),
                )
            )

        user = self.request.user
        if is_organization_admin(user):
            return queryset
        org_ids = get_user_organization_ids(user)
        if org_ids:
            return filter_queryset_by_org_ids(queryset, 'organization_id', org_ids)
        return Respondent.objects.none()
    
    def perform_create(self, serializer):
        organization = serializer.validated_data.get('organization')
        if not is_organization_admin(self.request.user):
            allowed_org_ids = set(get_user_organization_ids(self.request.user) or [])
            if not organization or organization.id not in allowed_org_ids:
                raise PermissionDenied('You do not have permission to create respondents for this organization.')
        serializer.save(created_by=self.request.user)
    
    @action(detail=True, methods=['get'])
    def profile(self, request, pk=None):
        """Get respondent profile with all interactions."""
        respondent = self.get_object()
        serializer = RespondentProfileSerializer(respondent)
        return DRFResponse(serializer.data)
    
    @action(detail=False, methods=['get'])
    def search(self, request):
        """Search respondents by unique ID."""
        query = request.query_params.get('q', '')
        respondents = self.get_queryset().filter(unique_id__icontains=query)[:10]
        return DRFResponse(RespondentSerializer(respondents, many=True).data)
    
    @action(detail=False, methods=['get'])
    def stats(self, request):
        """Get respondent statistics."""
        qs = self.get_queryset()
        return DRFResponse({
            'total': qs.count(),
            'active': qs.filter(is_active=True).count(),
            'by_gender': list(qs.values('gender').annotate(count=Count('id'))),
            'by_organization': list(qs.values('organization__name').annotate(count=Count('id'))),
        })
    
    @action(detail=False, methods=['get'])
    def export(self, request):
        """Export respondents to CSV."""
        response = HttpResponse(content_type='text/csv')
        response['Content-Disposition'] = 'attachment; filename="respondents.csv"'
        
        writer = csv.writer(response)
        writer.writerow(['ID', 'Unique ID', 'First Name', 'Last Name', 'Gender', 'Organization'])
        
        for r in self.get_queryset():
            writer.writerow([
                r.id, r.unique_id, r.first_name, r.last_name,
                r.gender, r.organization.name if r.organization else ''
            ])
        
        return response


class InteractionViewSet(IdempotentMutationMixin, viewsets.ModelViewSet):
    """ViewSet for managing interactions."""
    
    queryset = Interaction.objects.all()
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ['respondent', 'assessment', 'project', 'event']
    search_fields = ['respondent__unique_id', 'notes']
    ordering_fields = ['date', 'created_at']
    ordering = ['-date', '-created_at']
    
    def get_serializer_class(self):
        if self.action == 'create':
            return InteractionCreateSerializer
        return InteractionSerializer
    
    def get_queryset(self):
        """Filter interactions by user role and organization."""
        queryset = Interaction.objects.select_related(
            'respondent', 'assessment', 'project', 'event', 'created_by'
        ).annotate(
            responses_count=Count('responses', distinct=True)
        ).prefetch_related(
            Prefetch(
                'responses',
                queryset=Response.objects.select_related('indicator'),
            )
        )

        user = self.request.user
        if not is_organization_admin(user):
            # Project-assignment gate (project-less interactions are kept; org
            # scope still applies).
            queryset = filter_queryset_by_assigned_projects(
                queryset, user, 'project_id', include_null_project=True
            )
            org_ids = get_user_organization_ids(user)
            if org_ids:
                queryset = filter_queryset_by_org_ids(queryset, 'respondent__organization_id', org_ids)
            else:
                queryset = queryset.filter(created_by=user)
        return apply_training_filter(queryset, self.request, project_lookup="project")

    def perform_create(self, serializer):
        respondent = serializer.validated_data.get('respondent')
        project = serializer.validated_data.get('project')
        event = serializer.validated_data.get('event')
        responses = serializer.validated_data.get('responses', []) or []
        # Enforce the Sesigo Training/Live boundary on interaction capture.
        assert_project_write_allowed(self.request, project)
        if not is_organization_admin(self.request.user):
            allowed_org_ids = set(get_user_organization_ids(self.request.user) or [])
            if not respondent or respondent.organization_id not in allowed_org_ids:
                raise PermissionDenied('You do not have permission to create interactions for this respondent.')
            if project and project.organizations.exists() and not project.organizations.filter(id__in=allowed_org_ids).exists():
                raise PermissionDenied('You do not have permission to use this project for interaction capture.')
            if event:
                allowed_event_org_ids = set(
                    [event.organization_id]
                    + list(event.participating_organizations.values_list('id', flat=True))
                )
                if allowed_event_org_ids and allowed_event_org_ids.isdisjoint(allowed_org_ids):
                    raise PermissionDenied('You do not have permission to use this event for interaction capture.')
        if project and respondent and not is_organization_in_project_scope(project, respondent.organization_id):
            raise PermissionDenied('Respondent organization is not in the selected project scope.')
        if project and respondent:
            # Resolve each response's reporting indicator (via its question, if
            # any) and enforce that it is assigned to the respondent's org for
            # the project. Questions with no linked indicator skip this check.
            from indicators.models import Question
            question_ids = [
                r.get('question') for r in responses if r.get('question') not in (None, '')
            ]
            indicator_by_question = dict(
                Question.objects.filter(id__in=question_ids)
                .exclude(indicator__isnull=True)
                .values_list('id', 'indicator_id')
            )
            for response in responses:
                question_id = response.get('question')
                if question_id not in (None, ''):
                    parsed_indicator_id = indicator_by_question.get(int(question_id))
                else:
                    indicator_id = response.get('indicator')
                    if indicator_id in (None, ''):
                        continue
                    try:
                        parsed_indicator_id = int(indicator_id)
                    except (TypeError, ValueError):
                        raise PermissionDenied('Indicator id in responses must be a valid integer.')
                if parsed_indicator_id is None:
                    continue
                if not is_indicator_assigned_to_organization(
                    project=project,
                    indicator_id=parsed_indicator_id,
                    organization_id=respondent.organization_id,
                ):
                    raise PermissionDenied(
                        f'Indicator {parsed_indicator_id} is not assigned to this respondent organization for the selected project.'
                    )
        serializer.save(created_by=self.request.user)
    
    @action(detail=True, methods=['post'])
    def add_response(self, request, pk=None):
        """Add a response (answer to a question) to an interaction."""
        interaction = self.get_object()
        from indicators.models import Question

        question_id = request.data.get('question')
        parsed_indicator_id = None
        if question_id not in (None, ''):
            question = Question.objects.filter(id=question_id).first()
            if question is None:
                return DRFResponse({'detail': 'Question not found.'}, status=status.HTTP_404_NOT_FOUND)
            parsed_indicator_id = question.indicator_id
        else:
            indicator_id = request.data.get('indicator')
            if indicator_id not in (None, ''):
                try:
                    parsed_indicator_id = int(indicator_id)
                except (TypeError, ValueError):
                    return DRFResponse(
                        {'detail': 'indicator must be a valid integer id.'},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
        if (
            interaction.project_id
            and parsed_indicator_id is not None
            and not is_indicator_assigned_to_organization(
                project=interaction.project,
                indicator_id=parsed_indicator_id,
                organization_id=interaction.respondent.organization_id,
            )
        ):
            raise PermissionDenied('This indicator is not assigned to the respondent organization for the interaction project.')
        serializer = ResponseSerializer(data={
            'interaction': interaction.id,
            **request.data
        })
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return DRFResponse(serializer.data, status=status.HTTP_201_CREATED)


class ResponseViewSet(IdempotentMutationMixin, viewsets.ModelViewSet):
    """ViewSet for managing responses."""
    
    queryset = Response.objects.select_related('interaction', 'indicator', 'question')
    serializer_class = ResponseSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['interaction', 'indicator', 'question']

    def get_queryset(self):
        user = self.request.user
        queryset = Response.objects.select_related(
            'interaction', 'indicator', 'question', 'interaction__respondent'
        )
        if not is_organization_admin(user):
            queryset = filter_queryset_by_assigned_projects(
                queryset, user, 'interaction__project_id', include_null_project=True
            )
            org_ids = get_user_organization_ids(user)
            if org_ids:
                queryset = filter_queryset_by_org_ids(queryset, 'interaction__respondent__organization_id', org_ids)
            else:
                queryset = queryset.filter(interaction__created_by=user)
        return apply_training_filter(queryset, self.request, project_lookup="interaction__project")

    def perform_create(self, serializer):
        interaction = serializer.validated_data.get('interaction')
        question = serializer.validated_data.get('question')
        indicator_id = question.indicator_id if question else None
        # SEC-2: enforce organisation ownership of the target interaction before
        # writing a response. Without this a non-admin could attach a response to
        # another organisation's interaction by guessing a sequential id (write
        # IDOR / cross-org data injection). Mirror InteractionViewSet scope rules.
        if not is_organization_admin(self.request.user):
            allowed_org_ids = set(get_user_organization_ids(self.request.user) or [])
            interaction_org_id = (
                interaction.respondent.organization_id if interaction and interaction.respondent_id else None
            )
            if interaction_org_id is None or interaction_org_id not in allowed_org_ids:
                raise PermissionDenied(
                    'You do not have permission to add responses to this interaction.'
                )
        # Enforce the Sesigo Training/Live boundary on response capture too.
        if interaction is not None:
            assert_project_write_allowed(self.request, interaction.project)
        if interaction and interaction.project_id and indicator_id:
            if not is_indicator_assigned_to_organization(
                project=interaction.project,
                indicator_id=indicator_id,
                organization_id=interaction.respondent.organization_id,
            ):
                raise PermissionDenied('This indicator is not assigned to the respondent organization for the interaction project.')
        serializer.save()

