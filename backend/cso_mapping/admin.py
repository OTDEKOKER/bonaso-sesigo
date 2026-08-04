from django.contrib import admin

from .models import CsoMappingSubmission


@admin.register(CsoMappingSubmission)
class CsoMappingSubmissionAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "responding_entity",
        "respondent_type",
        "primary_district",
        "submitted_at",
    )
    list_filter = ("respondent_type", "submitted_at")
    search_fields = ("responding_entity", "respondent_name", "primary_district")
    date_hierarchy = "submitted_at"
    ordering = ("-submitted_at",)
    readonly_fields = [f.name for f in CsoMappingSubmission._meta.fields]

    # Submissions are respondent-supplied records — view-only in the admin.
    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False
