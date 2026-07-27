from django.contrib import admin

from .models import SupportTicket, SupportTicketComment


class SupportTicketCommentInline(admin.TabularInline):
    model = SupportTicketComment
    extra = 0
    readonly_fields = ('created_by', 'created_by_username', 'created_at')


@admin.register(SupportTicket)
class SupportTicketAdmin(admin.ModelAdmin):
    list_display = ('id', 'title', 'status', 'category', 'severity', 'priority',
                    'affected_organization', 'assigned_to', 'created_at')
    list_filter = ('status', 'category', 'severity', 'priority')
    search_fields = ('title', 'description', 'related_reference', 'reporter_username')
    raw_id_fields = ('affected_organization', 'affected_project', 'reporting_period',
                     'reporter', 'assigned_to', 'resolved_by',
                     'related_aggregate', 'related_upload')
    readonly_fields = ('created_at', 'updated_at', 'reporter_username')
    inlines = [SupportTicketCommentInline]


@admin.register(SupportTicketComment)
class SupportTicketCommentAdmin(admin.ModelAdmin):
    list_display = ('id', 'ticket', 'is_internal', 'created_by', 'created_at')
    list_filter = ('is_internal',)
    raw_id_fields = ('ticket', 'created_by')
