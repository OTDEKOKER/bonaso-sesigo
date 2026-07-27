from rest_framework import serializers

from .models import SupportTicket, SupportTicketComment


class SupportTicketCommentSerializer(serializers.ModelSerializer):
    created_by_name = serializers.CharField(source='created_by.username', read_only=True)

    class Meta:
        model = SupportTicketComment
        fields = [
            'id', 'ticket', 'content', 'is_internal',
            'created_by', 'created_by_name', 'created_by_username', 'created_at',
        ]
        read_only_fields = ['id', 'ticket', 'created_by', 'created_by_username', 'created_at']


class SupportTicketSerializer(serializers.ModelSerializer):
    reporter_name = serializers.CharField(source='reporter.username', read_only=True)
    assigned_to_name = serializers.CharField(source='assigned_to.username', read_only=True)
    resolved_by_name = serializers.CharField(source='resolved_by.username', read_only=True)
    affected_organization_name = serializers.CharField(
        source='affected_organization.name', read_only=True)
    affected_project_name = serializers.CharField(
        source='affected_project.name', read_only=True)

    category_display = serializers.CharField(source='get_category_display', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    severity_display = serializers.CharField(source='get_severity_display', read_only=True)
    priority_display = serializers.CharField(source='get_priority_display', read_only=True)

    is_open = serializers.BooleanField(read_only=True)
    is_overdue = serializers.SerializerMethodField()
    resolution_target_at = serializers.SerializerMethodField()
    comments_count = serializers.SerializerMethodField()

    class Meta:
        model = SupportTicket
        fields = [
            'id', 'title', 'description',
            'category', 'category_display',
            'severity', 'severity_display',
            'priority', 'priority_display',
            'status', 'status_display',
            'affected_organization', 'affected_organization_name',
            'affected_project', 'affected_project_name',
            'reporting_period', 'reporting_period_label',
            'reporter', 'reporter_name', 'reporter_username',
            'assigned_to', 'assigned_to_name',
            'resolution_notes', 'resolved_at', 'resolved_by', 'resolved_by_name',
            'related_aggregate', 'related_upload', 'related_reference',
            'metadata',
            'is_open', 'is_overdue', 'resolution_target_at', 'comments_count',
            'created_at', 'updated_at',
        ]
        # status / assignment / resolution move ONLY through the lifecycle actions
        # (assign / set_status / set_priority / resolve / reopen), never a blind
        # PATCH — so the transition and permission rules cannot be bypassed.
        read_only_fields = [
            'id', 'status', 'reporter', 'reporter_username',
            'assigned_to', 'resolution_notes', 'resolved_at', 'resolved_by',
            'created_at', 'updated_at',
        ]

    def get_is_overdue(self, obj):
        return obj.is_overdue()

    def get_resolution_target_at(self, obj):
        target = obj.resolution_target_at()
        return target.isoformat() if target else None

    def get_comments_count(self, obj):
        return obj.comments.count()
