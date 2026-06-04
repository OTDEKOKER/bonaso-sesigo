from rest_framework import serializers
from .models import Respondent, Interaction, Response


class ResponseSerializer(serializers.ModelSerializer):
    """Serializer for Response model."""

    question_text = serializers.CharField(source='question.text', read_only=True)
    response_type = serializers.CharField(source='question.response_type', read_only=True)
    indicator_name = serializers.CharField(source='indicator.name', read_only=True)
    indicator_code = serializers.CharField(source='indicator.code', read_only=True)
    indicator_type = serializers.CharField(source='indicator.type', read_only=True)

    class Meta:
        model = Response
        fields = [
            'id', 'interaction', 'question', 'question_text', 'response_type',
            'indicator', 'indicator_name', 'indicator_code', 'indicator_type',
            'value', 'created_at', 'updated_at'
        ]
        read_only_fields = ['id', 'indicator', 'created_at', 'updated_at']


class InteractionResponseInputSerializer(serializers.Serializer):
    """Minimal response payload expected during interaction create."""

    question = serializers.IntegerField(required=False)
    # Legacy/back-compat: accept an indicator id if no question is supplied.
    indicator = serializers.IntegerField(required=False)
    value = serializers.JSONField()

    def validate(self, attrs):
        if not attrs.get('question') and not attrs.get('indicator'):
            raise serializers.ValidationError('Each response requires a question id.')
        return attrs


class InteractionSerializer(serializers.ModelSerializer):
    """Serializer for Interaction model."""
    
    respondent_name = serializers.CharField(source='respondent.full_name', read_only=True)
    assessment_name = serializers.CharField(source='assessment.name', read_only=True)
    project_name = serializers.CharField(source='project.name', read_only=True)
    event_name = serializers.CharField(source='event.title', read_only=True)
    created_by_name = serializers.CharField(source='created_by.username', read_only=True)
    responses = ResponseSerializer(many=True, read_only=True)
    responses_count = serializers.SerializerMethodField()
    
    class Meta:
        model = Interaction
        fields = [
            'id', 'respondent', 'respondent_name', 'assessment', 'assessment_name',
            'project', 'project_name', 'event', 'event_name', 'date', 'notes', 'responses', 'responses_count',
            'created_at', 'updated_at', 'created_by', 'created_by_name'
        ]
        read_only_fields = ['id', 'created_at', 'updated_at', 'created_by']
    
    def get_responses_count(self, obj):
        annotated_count = getattr(obj, 'responses_count', None)
        if annotated_count is not None:
            return annotated_count
        return obj.responses.count()


class InteractionCreateSerializer(serializers.ModelSerializer):
    """Serializer for creating interactions with responses."""
    
    responses = InteractionResponseInputSerializer(many=True, required=False)
    
    class Meta:
        model = Interaction
        fields = ['respondent', 'assessment', 'project', 'event', 'date', 'notes', 'responses']
    
    def create(self, validated_data):
        responses_data = validated_data.pop('responses', [])
        interaction = Interaction.objects.create(**validated_data)

        for response_data in responses_data:
            question_id = response_data.get('question')
            indicator_id = response_data.get('indicator')
            Response.objects.create(
                interaction=interaction,
                question_id=question_id,
                indicator_id=indicator_id if not question_id else None,
                value=response_data.get('value'),
            )

        return interaction


class RespondentSerializer(serializers.ModelSerializer):
    """Serializer for Respondent model."""
    
    full_name = serializers.CharField(read_only=True)
    organization_name = serializers.CharField(source='organization.name', read_only=True)
    created_by_name = serializers.CharField(source='created_by.username', read_only=True)
    interactions_count = serializers.SerializerMethodField()
    last_interaction = serializers.SerializerMethodField()
    
    class Meta:
        model = Respondent
        fields = [
            'id', 'unique_id', 'first_name', 'last_name', 'full_name',
            'gender', 'date_of_birth', 'phone', 'email', 'address',
            'organization', 'organization_name', 'demographics', 'is_active',
            'interactions_count', 'last_interaction', 'created_at', 'updated_at',
            'created_by', 'created_by_name'
        ]
        read_only_fields = ['id', 'created_at', 'updated_at', 'created_by']
    
    def get_interactions_count(self, obj):
        annotated_count = getattr(obj, 'interactions_count', None)
        if annotated_count is not None:
            return annotated_count
        return obj.interactions.count()
    
    def get_last_interaction(self, obj):
        annotated_date = getattr(obj, 'last_interaction_date', None)
        if annotated_date is not None:
            return annotated_date.isoformat()
        last = obj.interactions.first()
        return last.date.isoformat() if last else None


class RespondentProfileSerializer(RespondentSerializer):
    """Detailed serializer with interaction history."""
    
    interactions = InteractionSerializer(many=True, read_only=True)
    
    class Meta(RespondentSerializer.Meta):
        fields = RespondentSerializer.Meta.fields + ['interactions']
