import re
from difflib import SequenceMatcher
from users.permissions import HasModulePermission

from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework.filters import SearchFilter, OrderingFilter
from django.db import models, transaction, IntegrityError
from django.db.models import Count, Prefetch

from .models import (
    Indicator, IndicatorAlias, Assessment, AssessmentQuestion, Question,
    AGGREGATE_MODE_CHOICES,
)
from .serializers import (
    IndicatorSerializer, IndicatorListSerializer, IndicatorSimpleSerializer, IndicatorAliasSerializer,
    AssessmentSerializer, AssessmentListSerializer, AssessmentSimpleSerializer,
    AssessmentQuestionSerializer, QuestionSerializer, QuestionSimpleSerializer,
)

# Known target-group terms stripped when comparing indicator names for deduplication.
# Removing them lets "# of PLHIV reached" match "# of people reached".
_TARGET_GROUP_TERMS = re.compile(
    r'\b('
    # PLHIV / HIV-positive
    r'plhiv|hiv positive|hiv\+|people living with hiv|living with hiv|'
    # AYP — Adolescents and Young People (10-24 yrs)
    r'ayp|adolescents? and young people|adolescents? and youth|young people|young person|'
    # General age/gender groups
    r'adolescents?|youth|children|child|boys?|girls?|women|men|male|females?|'
    # Key populations
    r'key populations?|kp|msm|men who have sex with men|fsw|female sex workers?|'
    r'pwid|people who inject drugs?|transgender|trans women|trans men|trans|'
    # Vulnerability categories
    r'ovc|orphans? and vulnerable children|orphan|vulnerable children|'
    r'sex workers?|inmates?|prisoners?|migrants?|refugees?'
    r')\b',
    re.IGNORECASE,
)

_PEOPLE_TERMS = re.compile(r'\b(people|persons?|individuals?|clients?|beneficiar\w+)\b', re.IGNORECASE)


def _normalize(text: str) -> str:
    """Lowercase, strip punctuation/extra whitespace."""
    return re.sub(r'\s+', ' ', re.sub(r'[^a-z0-9]+', ' ', str(text or '').lower())).strip()


def _normalize_for_dedup(text: str) -> str:
    """Normalize AND strip target-group terms for structural similarity comparison."""
    stripped = _TARGET_GROUP_TERMS.sub('people', text)
    stripped = _PEOPLE_TERMS.sub('people', stripped)
    return _normalize(stripped)


class IndicatorPagination(PageNumberPagination):
    page_size = 50
    page_size_query_param = 'page_size'
    max_page_size = 100


class AssessmentPagination(PageNumberPagination):
    page_size = 20
    page_size_query_param = 'page_size'
    max_page_size = 100


class IndicatorViewSet(viewsets.ModelViewSet):
    """ViewSet for managing indicators."""
    
    queryset = Indicator.objects.all()
    serializer_class = IndicatorSerializer
    required_module = 'indicators'
    permission_classes = [IsAuthenticated, HasModulePermission]
    pagination_class = IndicatorPagination
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ['type', 'category', 'is_active', 'is_deprecated', 'organizations']
    search_fields = ['name', 'code', 'description']
    ordering_fields = ['name', 'code', 'category', 'created_at']
    ordering = ['category', 'name']

    def get_serializer_class(self):
        if self.action == 'list':
            return IndicatorListSerializer
        if self.action == 'simple':
            return IndicatorSimpleSerializer
        return IndicatorSerializer
    
    def get_queryset(self):
        queryset = Indicator.objects.prefetch_related('organizations')
        if self.action != 'list':
            queryset = queryset.select_related('created_by').prefetch_related(
                Prefetch(
                    'aliases',
                    queryset=IndicatorAlias.objects.select_related('indicator', 'created_by'),
                ),
            ).annotate(
                organizations_count=Count('organizations', distinct=True)
            )
        # Isolate Sesigo Training Mode: demo indicators are linked only to
        # training projects and must not clutter live indicator lists/pickers.
        from organizations.access import apply_training_filter_via_projects
        queryset = apply_training_filter_via_projects(queryset, self.request)

        user = self.request.user
        if user.is_superuser or user.is_staff or user.role == 'admin':
            return queryset
        elif user.organization:
            return queryset.filter(
                models.Q(organizations=user.organization) | models.Q(organizations__isnull=True)
            ).distinct()
        return queryset.filter(organizations__isnull=True)
    
    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)
    
    @action(detail=False, methods=['get'])
    def simple(self, request):
        """Get simple list for dropdowns."""
        indicators = self.get_queryset().filter(is_active=True)
        serializer = IndicatorSimpleSerializer(indicators, many=True)
        return Response(serializer.data)
    
    @action(detail=False, methods=['get'])
    def types(self, request):
        """Get available indicator types."""
        return Response([
            {'value': choice[0], 'label': choice[1]}
            for choice in Indicator.TYPE_CHOICES
        ])
    
    @action(detail=False, methods=['get'])
    def categories(self, request):
        """Get available indicator categories."""
        return Response([
            {'value': choice[0], 'label': choice[1]}
            for choice in Indicator.CATEGORY_CHOICES
        ])

    @action(detail=False, methods=['get'], url_path='duplicate_candidates')
    def duplicate_candidates(self, request):
        """Return pairs of non-deprecated indicators whose names are structurally similar.

        Similarity is computed after stripping known target-group terms so that
        "# of PLHIV reached with NCD messages" matches the canonical
        "# of people reached with NCD prevention and control messages".

        Query params:
          threshold  — float 0-1, default 0.72
          category   — filter to a single category
        """
        threshold = float(request.query_params.get('threshold', 0.72))
        category_filter = request.query_params.get('category')

        qs = Indicator.objects.filter(is_deprecated=False).only('id', 'name', 'code', 'category', 'type')
        if category_filter:
            qs = qs.filter(category=category_filter)

        indicators = list(qs)
        normalized = [(_normalize_for_dedup(ind.name), _normalize(ind.name)) for ind in indicators]

        candidates = []
        for i, ind_a in enumerate(indicators):
            norm_a = normalized[i][0]
            for j in range(i + 1, len(indicators)):
                ind_b = indicators[j]
                norm_b = normalized[j][0]
                ratio = SequenceMatcher(None, norm_a, norm_b).ratio()
                if ratio >= threshold:
                    candidates.append({
                        'indicator_a': {
                            'id': ind_a.id,
                            'name': ind_a.name,
                            'code': ind_a.code,
                            'category': ind_a.category,
                            'type': ind_a.type,
                        },
                        'indicator_b': {
                            'id': ind_b.id,
                            'name': ind_b.name,
                            'code': ind_b.code,
                            'category': ind_b.category,
                            'type': ind_b.type,
                        },
                        'similarity': round(ratio, 3),
                    })

        candidates.sort(key=lambda x: x['similarity'], reverse=True)
        return Response({'count': len(candidates), 'results': candidates})

    @action(detail=True, methods=['post'], url_path='merge_into')
    def merge_into(self, request, pk=None):
        """Mark this indicator as a deprecated duplicate of a canonical indicator.

        The duplicate's name is registered as an alias on the canonical.
        Historical data (aggregates, targets) stays on the original indicator ID.
        New project assignments should use the canonical + set target_group.

        POST /api/indicators/{duplicate_id}/merge_into/
        Body: { "canonical_id": <int>, "target_group": "PLHIV", "notes": "..." }
        """
        duplicate = self.get_object()

        canonical_id = request.data.get('canonical_id')
        target_group = (request.data.get('target_group') or '').strip()
        notes = (request.data.get('notes') or '').strip()

        if not canonical_id:
            return Response({'detail': 'canonical_id is required.'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            canonical = Indicator.objects.get(id=canonical_id)
        except Indicator.DoesNotExist:
            return Response({'detail': 'Canonical indicator not found.'}, status=status.HTTP_404_NOT_FOUND)

        if canonical.id == duplicate.id:
            return Response({'detail': 'Cannot merge an indicator with itself.'}, status=status.HTTP_400_BAD_REQUEST)

        if canonical.is_deprecated:
            return Response({'detail': 'Canonical indicator is itself deprecated.'}, status=status.HTTP_400_BAD_REQUEST)

        if duplicate.is_deprecated:
            return Response({'detail': 'Indicator is already deprecated.'}, status=status.HTTP_400_BAD_REQUEST)

        normalized_dup_name = _normalize(duplicate.name)
        alias_notes = notes or f'Merged from deprecated indicator {duplicate.code}'
        if target_group:
            alias_notes = f'Target group: {target_group}. {alias_notes}'.strip()

        with transaction.atomic():
            try:
                IndicatorAlias.objects.get_or_create(
                    indicator=canonical,
                    normalized_name=normalized_dup_name,
                    defaults={
                        'name': duplicate.name,
                        'notes': alias_notes,
                        'created_by': request.user,
                    },
                )
            except IntegrityError:
                # Another active alias with this normalized_name already exists elsewhere;
                # skip alias creation but still complete the merge.
                pass

            duplicate.canonical_indicator = canonical
            duplicate.is_deprecated = True
            duplicate.is_active = False
            duplicate.save(update_fields=['canonical_indicator', 'is_deprecated', 'is_active', 'updated_at'])

        serializer = IndicatorSerializer(canonical, context={'request': request})
        return Response(serializer.data)

    @action(detail=True, methods=['post'], url_path='restore')
    def restore(self, request, pk=None):
        """Undo a merge: un-deprecate this indicator and remove its canonical link.

        POST /api/indicators/{id}/restore/
        """
        indicator = self.get_object()

        if not indicator.is_deprecated:
            return Response({'detail': 'Indicator is not deprecated.'}, status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            canonical = indicator.canonical_indicator
            if canonical:
                IndicatorAlias.objects.filter(
                    indicator=canonical,
                    normalized_name=_normalize(indicator.name),
                ).delete()

            indicator.canonical_indicator = None
            indicator.is_deprecated = False
            indicator.is_active = True
            indicator.save(update_fields=['canonical_indicator', 'is_deprecated', 'is_active', 'updated_at'])

        serializer = IndicatorSerializer(indicator, context={'request': request})
        return Response(serializer.data)


class IndicatorAliasViewSet(viewsets.ModelViewSet):
    """ViewSet for managing indicator aliases."""

    queryset = IndicatorAlias.objects.all()
    serializer_class = IndicatorAliasSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ['indicator', 'is_active']
    search_fields = ['name', 'normalized_name', 'indicator__name', 'indicator__code']
    ordering_fields = ['name', 'created_at', 'updated_at']
    ordering = ['name']

    def get_queryset(self):
        queryset = IndicatorAlias.objects.select_related(
            'indicator', 'created_by'
        )
        user = self.request.user
        if user.is_superuser or user.is_staff or user.role == 'admin':
            return queryset
        elif user.organization:
            return queryset.filter(
                models.Q(indicator__organizations=user.organization)
                | models.Q(indicator__organizations__isnull=True)
            ).distinct()
        return queryset.filter(indicator__organizations__isnull=True)

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)


class AssessmentViewSet(viewsets.ModelViewSet):
    """ViewSet for managing assessments."""
    
    queryset = Assessment.objects.all()
    serializer_class = AssessmentSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = AssessmentPagination
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ['is_active', 'organizations']
    search_fields = ['name', 'description']
    ordering_fields = ['name', 'created_at']
    ordering = ['name']

    def get_serializer_class(self):
        if self.action == 'list':
            return AssessmentListSerializer
        if self.action == 'simple':
            return AssessmentSimpleSerializer
        return AssessmentSerializer
    
    def get_queryset(self):
        queryset = Assessment.objects.annotate(
            questions_count=Count('questions', distinct=True)
        )
        if self.action == 'list':
            queryset = queryset.prefetch_related('organizations')
        else:
            queryset = queryset.select_related('created_by').prefetch_related(
                'organizations',
                Prefetch(
                    'assessmentquestion_set',
                    queryset=AssessmentQuestion.objects.select_related(
                        'question', 'question__indicator', 'depends_on'
                    ).order_by('order'),
                    to_attr='prefetched_questions',
                ),
            )
        user = self.request.user
        if user.is_superuser or user.is_staff or user.role == 'admin':
            return queryset
        elif user.organization:
            return queryset.filter(
                models.Q(organizations=user.organization) | models.Q(organizations__isnull=True)
            ).distinct()
        return queryset.filter(organizations__isnull=True)
    
    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

    def _coerce_bool(self, value, default=True):
        if value is None:
            return default
        if isinstance(value, bool):
            return value
        if isinstance(value, str):
            return value.strip().lower() not in {'false', '0', 'no', 'off', ''}
        return bool(value)

    def _coerce_int(self, value, default=0):
        try:
            return int(value)
        except (TypeError, ValueError):
            return default

    @action(detail=False, methods=['get'])
    def simple(self, request):
        """Get simple list for dropdowns."""
        assessments = self.get_queryset().filter(is_active=True)
        serializer = AssessmentSimpleSerializer(assessments, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=['post'], url_path='add_question')
    def add_question(self, request, pk=None):
        """Attach an existing bank question to this assessment (or update its placement).

        Body:
          question_id   — Question to attach (required when creating a link)
          link_id       — AssessmentQuestion id to update an existing placement
          order, is_required, depends_on, condition_value — placement fields
        """
        assessment = self.get_object()
        from respondents.rollups import sync_question_rollups

        link_id = request.data.get('link_id')
        question_id = request.data.get('question_id')
        order = self._coerce_int(request.data.get('order'), 0)
        is_required = self._coerce_bool(request.data.get('is_required'), True)
        depends_on_id = request.data.get('depends_on')
        condition_value = request.data.get('condition_value')

        if link_id:
            link = AssessmentQuestion.objects.filter(assessment=assessment, id=link_id).first()
            if link is None:
                return Response(
                    {'detail': 'Assessment question not found.'},
                    status=status.HTTP_404_NOT_FOUND,
                )
        else:
            try:
                question = Question.objects.get(id=question_id)
            except (Question.DoesNotExist, ValueError, TypeError):
                return Response({'detail': 'Question not found.'}, status=status.HTTP_404_NOT_FOUND)
            link, _ = AssessmentQuestion.objects.get_or_create(
                assessment=assessment, question=question,
            )

        link.order = order
        link.is_required = is_required
        if 'depends_on' in request.data:
            link.depends_on_id = depends_on_id or None
        if 'condition_value' in request.data:
            link.condition_value = condition_value

        link.save()
        sync_question_rollups(link.question_id)
        return Response(AssessmentQuestionSerializer(link).data)

    @action(detail=True, methods=['post'], url_path='remove_question')
    def remove_question(self, request, pk=None):
        """Remove a question placement from this assessment."""
        assessment = self.get_object()
        from respondents.rollups import sync_question_rollups

        link_id = request.data.get('link_id')
        question_id = request.data.get('question_id')

        queryset = AssessmentQuestion.objects.filter(assessment=assessment)
        if link_id:
            queryset = queryset.filter(id=link_id)
        elif question_id:
            queryset = queryset.filter(question_id=question_id)
        else:
            return Response(
                {'detail': 'link_id or question_id is required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        affected_question_ids = list(queryset.values_list('question_id', flat=True).distinct())
        queryset.delete()
        for qid in affected_question_ids:
            sync_question_rollups(qid)

        return Response({'detail': 'Question removed from assessment.'})


class QuestionViewSet(viewsets.ModelViewSet):
    """ViewSet for the reusable question bank."""

    queryset = Question.objects.all()
    serializer_class = QuestionSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = IndicatorPagination
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ['response_type', 'category', 'is_active', 'indicator', 'organizations']
    search_fields = ['text', 'code']
    ordering_fields = ['text', 'created_at', 'category']
    ordering = ['text']

    def get_serializer_class(self):
        if self.action == 'simple':
            return QuestionSimpleSerializer
        return QuestionSerializer

    def get_queryset(self):
        queryset = Question.objects.select_related('indicator', 'created_by').prefetch_related(
            'organizations'
        ).annotate(
            organizations_count=Count('organizations', distinct=True),
            assessments_count=Count('assessments', distinct=True),
        )
        user = self.request.user
        if user.is_superuser or user.is_staff or user.role == 'admin':
            return queryset
        elif user.organization:
            return queryset.filter(
                models.Q(organizations=user.organization) | models.Q(organizations__isnull=True)
            ).distinct()
        return queryset.filter(organizations__isnull=True)

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

    @action(detail=False, methods=['get'])
    def simple(self, request):
        """Get simple list for question pickers."""
        questions = self.get_queryset().filter(is_active=True)
        serializer = QuestionSimpleSerializer(questions, many=True)
        return Response(serializer.data)

    @action(detail=False, methods=['get'])
    def types(self, request):
        """Get available response types (shared with indicators)."""
        return Response([
            {'value': choice[0], 'label': choice[1]}
            for choice in Indicator.TYPE_CHOICES
        ])

    @action(detail=False, methods=['get'], url_path='aggregate_modes')
    def aggregate_modes(self, request):
        """Get available aggregate (roll-up) modes."""
        return Response([
            {'value': choice[0], 'label': choice[1]}
            for choice in AGGREGATE_MODE_CHOICES
        ])

