from rest_framework import serializers

from .models import (
    ReportTemplate, ReportSection, ReportFigure,
    ReportFigureIndicatorMapping, ReportFigureFilter, ReportFigureSnapshot,
)


class ReportFigureFilterSerializer(serializers.ModelSerializer):
    class Meta:
        model = ReportFigureFilter
        fields = ['id', 'report_figure', 'dimension_name', 'allowed_values',
                  'exclude_values', 'filter_mode']


class ReportFigureIndicatorMappingSerializer(serializers.ModelSerializer):
    indicator_name = serializers.CharField(source='indicator.name', read_only=True)
    indicator_code = serializers.CharField(source='indicator.code', read_only=True)

    class Meta:
        model = ReportFigureIndicatorMapping
        fields = ['id', 'report_figure', 'indicator', 'indicator_name', 'indicator_code',
                  'role', 'label_override', 'display_order', 'include_in_total',
                  'calculation_role']


class ReportFigureSerializer(serializers.ModelSerializer):
    mappings = ReportFigureIndicatorMappingSerializer(many=True, read_only=True)
    filters = ReportFigureFilterSerializer(many=True, read_only=True)

    class Meta:
        model = ReportFigure
        fields = ['id', 'report_section', 'figure_number', 'title', 'description',
                  'chart_type', 'display_order', 'aggregation_method',
                  'grouping_dimension', 'secondary_grouping_dimension', 'target_mode',
                  'calculation_mode', 'narrative_template', 'is_active',
                  'mappings', 'filters']


class ReportSectionSerializer(serializers.ModelSerializer):
    figures = ReportFigureSerializer(many=True, read_only=True)

    class Meta:
        model = ReportSection
        fields = ['id', 'report_template', 'title', 'objective_label', 'description',
                  'display_order', 'figures']


class ReportTemplateSerializer(serializers.ModelSerializer):
    project_name = serializers.CharField(source='project.name', read_only=True)
    created_by_name = serializers.CharField(source='created_by.username', read_only=True)
    owner_name = serializers.CharField(source='owner.username', read_only=True)
    section_count = serializers.IntegerField(source='sections.count', read_only=True)

    class Meta:
        model = ReportTemplate
        fields = ['id', 'name', 'funder', 'project', 'project_name', 'reporting_year',
                  'description', 'is_active', 'section_count',
                  'owner', 'owner_name', 'visibility', 'shared_with_users',
                  'created_by', 'created_by_name', 'created_at', 'updated_at']
        read_only_fields = ['id', 'owner', 'created_by', 'created_at', 'updated_at']


class ReportTemplateDetailSerializer(ReportTemplateSerializer):
    sections = ReportSectionSerializer(many=True, read_only=True)

    class Meta(ReportTemplateSerializer.Meta):
        fields = ReportTemplateSerializer.Meta.fields + ['sections']


class ReportFigureSnapshotSerializer(serializers.ModelSerializer):
    generated_by_name = serializers.CharField(source='generated_by.username', read_only=True)

    class Meta:
        model = ReportFigureSnapshot
        fields = ['id', 'report_figure', 'project', 'period_start', 'period_end',
                  'period_mode', 'generated_by', 'generated_by_name', 'generated_at',
                  'data_json', 'chart_config_json', 'narrative_text',
                  'filters_json', 'scope_json', 'warnings_json',
                  'published_by', 'published_at', 'status']
        read_only_fields = ['id', 'generated_by', 'generated_at', 'published_by', 'published_at']
