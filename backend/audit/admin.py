from django.contrib import admin

from .models import AuditEvent


@admin.register(AuditEvent)
class AuditEventAdmin(admin.ModelAdmin):
    list_display = [
        'created_at', 'actor_username', 'action', 'object_type', 'object_id',
        'organization', 'project', 'ip_address',
    ]
    list_filter = ['action', 'object_type', 'organization', 'project', 'created_at']
    search_fields = ['actor_username', 'object_id', 'description']
    date_hierarchy = 'created_at'
    readonly_fields = [
        'actor', 'actor_username', 'action', 'object_type', 'object_id',
        'organization', 'project', 'ip_address', 'description', 'metadata',
        'created_at',
    ]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
