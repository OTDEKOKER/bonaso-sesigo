from django.contrib import admin
from .models import Aggregate, ReportingPeriod


@admin.register(Aggregate)
class AggregateAdmin(admin.ModelAdmin):
    list_display = ['indicator', 'project', 'organization', 'status', 'period_start', 'period_end']
    list_filter = ['status', 'project', 'organization', 'indicator']
    ordering = ['-period_start']


@admin.register(ReportingPeriod)
class ReportingPeriodAdmin(admin.ModelAdmin):
    list_display = ['project', 'fiscal_year', 'quarter', 'status',
                    'coverage_start', 'coverage_end', 'submission_opens',
                    'submission_closes', 'allow_late_reporting']
    list_filter = ['status', 'project', 'fiscal_year', 'quarter', 'allow_late_reporting']
    readonly_fields = ['coverage_start', 'coverage_end', 'created_at', 'updated_at']
    ordering = ['-fiscal_year', '-quarter']
