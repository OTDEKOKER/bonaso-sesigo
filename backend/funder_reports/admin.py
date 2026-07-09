from django.contrib import admin

from .models import (
    ReportTemplate, ReportSection, ReportFigure,
    ReportFigureIndicatorMapping, ReportFigureFilter, ReportFigureSnapshot,
)


class ReportSectionInline(admin.TabularInline):
    model = ReportSection
    extra = 0


class ReportFigureInline(admin.TabularInline):
    model = ReportFigure
    extra = 0


class ReportFigureMappingInline(admin.TabularInline):
    model = ReportFigureIndicatorMapping
    extra = 0


@admin.register(ReportTemplate)
class ReportTemplateAdmin(admin.ModelAdmin):
    list_display = ['name', 'funder', 'project', 'reporting_year', 'is_active']
    list_filter = ['funder', 'reporting_year', 'is_active', 'project']
    inlines = [ReportSectionInline]


@admin.register(ReportSection)
class ReportSectionAdmin(admin.ModelAdmin):
    list_display = ['title', 'report_template', 'display_order']
    inlines = [ReportFigureInline]


@admin.register(ReportFigure)
class ReportFigureAdmin(admin.ModelAdmin):
    list_display = ['figure_number', 'title', 'chart_type', 'grouping_dimension', 'target_mode']
    list_filter = ['chart_type', 'grouping_dimension', 'target_mode', 'is_active']
    inlines = [ReportFigureMappingInline]


@admin.register(ReportFigureSnapshot)
class ReportFigureSnapshotAdmin(admin.ModelAdmin):
    list_display = ['report_figure', 'project', 'period_start', 'period_end', 'status', 'generated_at']
    list_filter = ['status', 'project']
