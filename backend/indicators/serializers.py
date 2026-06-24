from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied

from organizations.access import is_organization_admin
from .disaggregation import validate_disaggregation_config
from .models import (
    Indicator, IndicatorAlias, Assessment, AssessmentQuestion, Question,
)


class IndicatorAliasSerializer(serializers.ModelSerializer):
    created_by_name = serializers.CharField(source='created_by.username', read_only=True)
    indicator_name = serializers.CharField(source='indicator.name', read_only=True)
    indicator_code = serializers.CharField(source='indicator.code', read_only=True)

    class Meta:
        model = IndicatorAlias
        fields = [
            'id', 'indicator', 'indicator_name', 'indicator_code', 'name',
            'normalized_name', 'is_active', 'notes', 'created_at', 'updated_at',
            'created_by', 'created_by_name',
        ]
        read_only_fields = [
            'id', 'normalized_name', 'created_at', 'updated_at',
            'created_by', 'created_by_name', 'indicator_name', 'indicator_code',
        ]


class IndicatorSerializer(serializers.ModelSerializer):
    """Serializer for Indicator model."""

    created_by_name = serializers.CharField(source='created_by.username', read_only=True)
    organizations_count = serializers.SerializerMethodField()
    aliases = IndicatorAliasSerializer(many=True, read_only=True)
    canonical_indicator_detail = serializers.SerializerMethodField()
    deprecated_variants_count = serializers.SerializerMethodField()

    class Meta:
        model = Indicator
        fields = [
            'id', 'name', 'code', 'description', 'type', 'category', 'unit',
            'options', 'sub_labels', 'aggregate_disaggregation_config',
            'aggregation_method', 'is_active',
            'is_deprecated', 'canonical_indicator', 'canonical_indicator_detail',
            'deprecated_variants_count',
            'organizations', 'organizations_count', 'aliases',
            'created_at', 'updated_at', 'created_by', 'created_by_name',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at', 'created_by', 'is_deprecated', 'canonical_indicator']

    def validate_aggregate_disaggregation_config(self, value):
        # Structural validation (shape, duplicates, non-empty values, etc.).
        return validate_disaggregation_config(value)

    def _request_user_is_admin(self) -> bool:
        request = self.context.get('request')
        return bool(request and is_organization_admin(getattr(request, 'user', None)))

    def create(self, validated_data):
        # Only admins may set the disaggregation config; for a non-admin we drop
        # it (the indicator is still created — an admin configures it later).
        if 'aggregate_disaggregation_config' in validated_data and not self._request_user_is_admin():
            validated_data.pop('aggregate_disaggregation_config', None)
        return super().create(validated_data)

    def update(self, instance, validated_data):
        # Non-admins cannot CHANGE the config; an unchanged echo is allowed so they
        # can still edit other fields. A real change by a non-admin is rejected.
        if 'aggregate_disaggregation_config' in validated_data:
            incoming = validated_data['aggregate_disaggregation_config'] or {}
            current = instance.aggregate_disaggregation_config or {}
            if incoming != current and not self._request_user_is_admin():
                raise PermissionDenied(
                    'Only administrators may change the indicator disaggregation configuration.'
                )
        return super().update(instance, validated_data)

    def get_organizations_count(self, obj):
        annotated_count = getattr(obj, 'organizations_count', None)
        if annotated_count is not None:
            return annotated_count
        return obj.organizations.count()

    def get_canonical_indicator_detail(self, obj):
        if not obj.canonical_indicator_id:
            return None
        canon = obj.canonical_indicator
        return {'id': canon.id, 'name': canon.name, 'code': canon.code}

    def get_deprecated_variants_count(self, obj):
        variants = getattr(obj, 'deprecated_variants', None)
        if variants is not None:
            try:
                return variants.count()
            except Exception:
                pass
        return 0


class IndicatorListSerializer(serializers.ModelSerializer):
    """Slim serializer for indicator list endpoints."""

    class Meta:
        model = Indicator
        fields = [
            'id', 'name', 'code', 'description', 'type', 'category', 'unit',
            'options', 'sub_labels', 'aggregate_disaggregation_config',
            'aggregation_method', 'is_active',
            'is_deprecated', 'canonical_indicator',
            'organizations', 'created_at', 'updated_at',
        ]
        # Config is editable only via the full IndicatorSerializer (admin-gated);
        # the list endpoint exposes it read-only for capture/analysis/exports.
        read_only_fields = ['id', 'created_at', 'updated_at', 'aggregate_disaggregation_config']


class IndicatorSimpleSerializer(serializers.ModelSerializer):
    """Simple serializer for dropdowns."""
    
    class Meta:
        model = Indicator
        fields = ['id', 'name', 'code', 'type', 'category']


class QuestionSerializer(serializers.ModelSerializer):
    """Full serializer for the reusable question bank."""

    indicator_detail = IndicatorSimpleSerializer(source='indicator', read_only=True)
    organizations_count = serializers.SerializerMethodField()
    assessments_count = serializers.SerializerMethodField()
    created_by_name = serializers.CharField(source='created_by.username', read_only=True)

    class Meta:
        model = Question
        fields = [
            'id', 'text', 'code', 'help_text', 'response_type',
            'options', 'sub_labels', 'category',
            'indicator', 'indicator_detail',
            'aggregate_mode', 'aggregate_match_values',
            'organizations', 'organizations_count', 'assessments_count',
            'is_active', 'created_at', 'updated_at', 'created_by', 'created_by_name',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at', 'created_by']

    def get_organizations_count(self, obj):
        annotated = getattr(obj, 'organizations_count', None)
        if annotated is not None:
            return annotated
        return obj.organizations.count()

    def get_assessments_count(self, obj):
        annotated = getattr(obj, 'assessments_count', None)
        if annotated is not None:
            return annotated
        return obj.assessments.count()


class QuestionSimpleSerializer(serializers.ModelSerializer):
    """Slim serializer for question pickers/dropdowns."""

    indicator_detail = IndicatorSimpleSerializer(source='indicator', read_only=True)

    class Meta:
        model = Question
        fields = [
            'id', 'text', 'code', 'response_type', 'options', 'sub_labels',
            'category', 'indicator', 'indicator_detail',
        ]


class AssessmentQuestionSerializer(serializers.ModelSerializer):
    """Serializer for a question placed on an assessment (AssessmentQuestion).

    Exposes ``*_display`` helpers (sourced from the linked Question) so the
    capture UI can render each question without a second fetch.
    """

    question_detail = QuestionSimpleSerializer(source='question', read_only=True)
    # Backwards-compatible display fields used by the capture form.
    question_text_display = serializers.CharField(source='question.text', read_only=True)
    response_type_display = serializers.CharField(source='question.response_type', read_only=True)
    response_options_display = serializers.JSONField(source='question.options', read_only=True)
    response_sub_labels_display = serializers.JSONField(source='question.sub_labels', read_only=True)
    indicator = serializers.IntegerField(source='question.indicator_id', read_only=True)
    indicator_detail = IndicatorSimpleSerializer(source='question.indicator', read_only=True)

    class Meta:
        model = AssessmentQuestion
        fields = [
            'id', 'assessment', 'question', 'question_detail',
            'question_text_display', 'response_type_display',
            'response_options_display', 'response_sub_labels_display',
            'indicator', 'indicator_detail',
            'order', 'is_required', 'depends_on', 'condition_value',
        ]


class AssessmentSerializer(serializers.ModelSerializer):
    """Serializer for Assessment model."""

    questions_detail = serializers.SerializerMethodField()
    created_by_name = serializers.CharField(source='created_by.username', read_only=True)
    questions_count = serializers.SerializerMethodField()

    class Meta:
        model = Assessment
        fields = [
            'id', 'name', 'description', 'questions', 'questions_detail',
            'questions_count', 'logic_rules', 'is_active', 'organizations',
            'created_at', 'updated_at', 'created_by', 'created_by_name'
        ]
        read_only_fields = ['id', 'created_at', 'updated_at', 'created_by', 'questions']

    def get_questions_detail(self, obj):
        links = getattr(obj, 'prefetched_questions', None)
        if links is None:
            links = AssessmentQuestion.objects.filter(
                assessment=obj
            ).select_related('question', 'question__indicator', 'depends_on').order_by('order')
        return AssessmentQuestionSerializer(links, many=True).data

    def get_questions_count(self, obj):
        annotated_count = getattr(obj, 'questions_count', None)
        if annotated_count is not None:
            return annotated_count
        return obj.questions.count()


class AssessmentListSerializer(serializers.ModelSerializer):
    """Slim serializer for assessment list endpoints."""

    questions_count = serializers.SerializerMethodField()

    class Meta:
        model = Assessment
        fields = [
            'id', 'name', 'description',
            'questions_count', 'logic_rules', 'is_active', 'organizations',
            'created_at', 'updated_at'
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']

    def get_questions_count(self, obj):
        annotated_count = getattr(obj, 'questions_count', None)
        if annotated_count is not None:
            return annotated_count
        return obj.questions.count()


class AssessmentSimpleSerializer(serializers.ModelSerializer):
    """Simple serializer for dropdowns."""
    
    class Meta:
        model = Assessment
        fields = ['id', 'name', 'description']
