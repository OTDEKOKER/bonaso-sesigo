from django.contrib import admin

from .models import IdempotencyKey


@admin.register(IdempotencyKey)
class IdempotencyKeyAdmin(admin.ModelAdmin):
    list_display = ('key', 'user', 'method', 'path', 'status_code', 'completed', 'created_at')
    list_filter = ('completed', 'method', 'created_at')
    search_fields = ('key', 'path', 'user__username')
    readonly_fields = ('created_at', 'updated_at')
