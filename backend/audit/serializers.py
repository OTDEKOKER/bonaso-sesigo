from rest_framework import serializers

from .models import AuditEvent


class AuditEventSerializer(serializers.ModelSerializer):
    actor_display = serializers.SerializerMethodField()
    organization_name = serializers.CharField(source='organization.name', read_only=True, default='')
    project_name = serializers.CharField(source='project.name', read_only=True, default='')

    class Meta:
        model = AuditEvent
        fields = [
            'id', 'actor', 'actor_username', 'actor_display', 'action',
            'object_type', 'object_id', 'organization', 'organization_name',
            'project', 'project_name', 'ip_address', 'description', 'metadata',
            'created_at',
        ]
        read_only_fields = fields

    def get_actor_display(self, obj):
        return obj.actor_username or (obj.actor_id and f'user {obj.actor_id}') or 'system'
