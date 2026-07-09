"""Funder Report Builder — configuration-driven report/figure model.

The goal is to render the same visuals the M&E team currently prepares by hand
for funder reports (e.g. "NAHPA Social Contracting 2025/26") straight from
**existing approved aggregate data** — without inventing new indicators or
hard-coding charts in the frontend.

The design is:  report figure = a configurable group of EXISTING indicators +
rules + chart type + narrative template. Nothing here stores indicator data; it
only stores the *mapping* from figures to the indicators/targets that already
live in ``indicators`` / ``aggregates`` / ``projects``. Generation (see
``funder_reports.generation``) reads ``AggregateFact`` (approved) + target
records at request time.
"""
from __future__ import annotations

from django.db import models


# ── Enumerations shared by figures ───────────────────────────────────────────
class ChartType(models.TextChoices):
    ACHIEVED_VS_TARGET = 'achieved_vs_target', 'Achieved vs target bar'
    GROUPED_BAR = 'grouped_bar', 'Grouped bar'
    STACKED_BAR = 'stacked_bar', 'Stacked bar'
    HORIZONTAL_BAR = 'horizontal_bar', 'Horizontal ranked bar'
    LINE = 'line', 'Line (quarterly trend)'
    PIE = 'pie', 'Pie / donut'
    HEATMAP = 'heatmap', 'Heatmap (age × sex)'
    CASCADE = 'cascade', 'Cascade / funnel'
    TABLE = 'table', 'Table'
    COMPLIANCE = 'compliance', 'Reporting-compliance matrix'


class Dimension(models.TextChoices):
    """Grouping dimensions the generator can pivot approved aggregates on. These
    map onto ``AggregateFact`` columns (or a resolved hierarchy)."""
    NONE = 'none', 'None'
    ORGANIZATION = 'organization', 'CSO / organization'
    COORDINATOR = 'coordinator', 'Coordinator organization'
    INDICATOR = 'indicator', 'Indicator (e.g. message type)'
    SEX = 'sex', 'Sex'
    AGE = 'age', 'Age range'
    KEY_POPULATION = 'key_population', 'Key population / category'
    DISTRICT = 'district', 'District'
    PERIOD = 'period', 'Reporting period (trend)'


class AggregationMethod(models.TextChoices):
    SUM = 'sum', 'Sum'
    COUNT = 'count', 'Count of reporting orgs'
    AVERAGE = 'average', 'Average'


class TargetMode(models.TextChoices):
    NONE = 'none', 'No target'
    ORG_QUARTER = 'org_quarter', 'Per-organization quarterly target'
    PROJECT = 'project', 'Project indicator target'


class CalculationMode(models.TextChoices):
    NONE = 'none', 'None'
    ACHIEVEMENT_PERCENT = 'achievement_percent', 'Achievement % (achieved / target × 100)'
    RATIO_PERCENT = 'ratio_percent', 'Ratio % (numerator / denominator × 100)'


class MappingRole(models.TextChoices):
    ACHIEVED = 'achieved', 'Achieved'
    TARGET = 'target', 'Target'
    NUMERATOR = 'numerator', 'Numerator'
    DENOMINATOR = 'denominator', 'Denominator'
    CATEGORY = 'category', 'Category (its own series/bar)'
    COMPARISON = 'comparison', 'Comparison'
    EXCLUDED = 'excluded', 'Excluded'
    SUPPORTING_NARRATIVE = 'supporting_narrative', 'Supporting narrative'


class Visibility(models.TextChoices):
    """Who may SEE a template's config. Data is ALWAYS re-scoped to the viewer's
    own permissions at generation time, so wider visibility never widens data
    access — only who can open/customize the chart definition."""
    PRIVATE = 'private', 'Only me'
    ORGANIZATION = 'organization', 'My organization'
    NETWORK = 'network', 'My hierarchy / network'
    PROJECT = 'project', 'Project network'
    FUNDER = 'funder', 'Funder / client'
    PUBLIC = 'public', 'Everyone (system)'


class ReportTemplate(models.Model):
    name = models.CharField(max_length=255)
    funder = models.CharField(max_length=255, blank=True, default='')
    project = models.ForeignKey(
        'projects.Project', on_delete=models.CASCADE, related_name='funder_report_templates',
    )
    reporting_year = models.CharField(
        max_length=16, blank=True, default='',
        help_text='e.g. "2025/26" (Botswana fiscal year label).',
    )
    description = models.TextField(blank=True, default='')
    is_active = models.BooleanField(default=True)

    # Self-service ownership + sharing. ``owner`` is the user who created a
    # personal template (null = a system/seeded template such as NAHPA, editable
    # only by admins). ``visibility`` + ``shared_with_users`` decide who can SEE
    # and open the config; generation re-scopes the data to each viewer.
    owner = models.ForeignKey(
        'users.User', on_delete=models.CASCADE, null=True, blank=True,
        related_name='owned_report_templates',
    )
    visibility = models.CharField(
        max_length=16, choices=Visibility.choices, default=Visibility.PRIVATE,
    )
    shared_with_users = models.ManyToManyField(
        'users.User', blank=True, related_name='shared_report_templates',
    )
    created_by = models.ForeignKey(
        'users.User', on_delete=models.SET_NULL, null=True, blank=True,
        related_name='created_report_templates',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-reporting_year', 'name']
        indexes = [
            models.Index(fields=['project', 'is_active'], name='frt_project_active_idx'),
            models.Index(fields=['owner', 'visibility'], name='frt_owner_vis_idx'),
        ]

    def __str__(self):
        return f"{self.name} ({self.reporting_year})"


class ReportSection(models.Model):
    report_template = models.ForeignKey(
        ReportTemplate, on_delete=models.CASCADE, related_name='sections',
    )
    title = models.CharField(max_length=255)
    objective_label = models.CharField(max_length=255, blank=True, default='')
    description = models.TextField(blank=True, default='')
    display_order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ['display_order', 'id']
        indexes = [models.Index(fields=['report_template', 'display_order'], name='frs_tmpl_order_idx')]

    def __str__(self):
        return f"{self.report_template_id}:{self.title}"


class ReportFigure(models.Model):
    report_section = models.ForeignKey(
        ReportSection, on_delete=models.CASCADE, related_name='figures',
    )
    figure_number = models.CharField(max_length=32, blank=True, default='')
    title = models.CharField(max_length=512)
    description = models.TextField(blank=True, default='')
    chart_type = models.CharField(max_length=32, choices=ChartType.choices, default=ChartType.GROUPED_BAR)
    display_order = models.PositiveIntegerField(default=0)
    aggregation_method = models.CharField(
        max_length=16, choices=AggregationMethod.choices, default=AggregationMethod.SUM,
    )
    grouping_dimension = models.CharField(
        max_length=24, choices=Dimension.choices, default=Dimension.ORGANIZATION,
    )
    secondary_grouping_dimension = models.CharField(
        max_length=24, choices=Dimension.choices, default=Dimension.NONE,
    )
    target_mode = models.CharField(max_length=16, choices=TargetMode.choices, default=TargetMode.NONE)
    calculation_mode = models.CharField(max_length=24, choices=CalculationMode.choices, default=CalculationMode.NONE)
    narrative_template = models.TextField(
        blank=True, default='',
        help_text='Optional templated narrative. Placeholders: {total}, {target}, '
                  '{achievement_percent}, {top_org}, {org_count}.',
    )
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ['display_order', 'id']
        indexes = [models.Index(fields=['report_section', 'display_order'], name='frf_section_order_idx')]

    def __str__(self):
        return f"{self.figure_number} {self.title}"[:80]


class ReportFigureIndicatorMapping(models.Model):
    report_figure = models.ForeignKey(
        ReportFigure, on_delete=models.CASCADE, related_name='mappings',
    )
    indicator = models.ForeignKey(
        'indicators.Indicator', on_delete=models.CASCADE, related_name='report_figure_mappings',
    )
    role = models.CharField(max_length=24, choices=MappingRole.choices, default=MappingRole.ACHIEVED)
    label_override = models.CharField(max_length=255, blank=True, default='')
    display_order = models.PositiveIntegerField(default=0)
    include_in_total = models.BooleanField(default=True)
    calculation_role = models.CharField(
        max_length=24, blank=True, default='',
        help_text='Free-form tag used by calculation_mode (e.g. which side of a ratio).',
    )

    class Meta:
        ordering = ['display_order', 'id']
        constraints = [
            models.UniqueConstraint(
                fields=['report_figure', 'indicator', 'role'],
                name='uniq_figure_indicator_role',
            ),
        ]
        indexes = [models.Index(fields=['report_figure', 'role'], name='frim_figure_role_idx')]

    def __str__(self):
        return f"{self.report_figure_id}:{self.indicator_id}:{self.role}"


class ReportFigureFilter(models.Model):
    FILTER_INCLUDE = 'include'
    FILTER_EXCLUDE = 'exclude'
    FILTER_MODES = [(FILTER_INCLUDE, 'Include only'), (FILTER_EXCLUDE, 'Exclude')]

    report_figure = models.ForeignKey(
        ReportFigure, on_delete=models.CASCADE, related_name='filters',
    )
    dimension_name = models.CharField(max_length=24, choices=Dimension.choices)
    allowed_values = models.JSONField(default=list, blank=True)
    exclude_values = models.JSONField(default=list, blank=True)
    filter_mode = models.CharField(max_length=8, choices=FILTER_MODES, default=FILTER_INCLUDE)

    class Meta:
        indexes = [models.Index(fields=['report_figure'], name='frff_figure_idx')]

    def __str__(self):
        return f"{self.report_figure_id}:{self.dimension_name}:{self.filter_mode}"


class ReportFigureSnapshot(models.Model):
    STATUS_DRAFT = 'draft'
    STATUS_FINAL = 'final'
    STATUS_PUBLISHED = 'published'
    STATUS_CHOICES = [
        (STATUS_DRAFT, 'Draft'), (STATUS_FINAL, 'Final'), (STATUS_PUBLISHED, 'Published'),
    ]

    report_figure = models.ForeignKey(
        ReportFigure, on_delete=models.CASCADE, related_name='snapshots',
    )
    project = models.ForeignKey('projects.Project', on_delete=models.CASCADE, related_name='+')
    period_start = models.DateField(null=True, blank=True)
    period_end = models.DateField(null=True, blank=True)
    generated_by = models.ForeignKey(
        'users.User', on_delete=models.SET_NULL, null=True, blank=True, related_name='+',
    )
    generated_at = models.DateTimeField(auto_now_add=True)
    data_json = models.JSONField(default=dict, blank=True)
    chart_config_json = models.JSONField(default=dict, blank=True)
    narrative_text = models.TextField(blank=True, default='')
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default=STATUS_DRAFT)

    # Reproducibility context — everything needed to regenerate exactly what was
    # shown/exported to the funder (requirement: snapshots preserve filter/config/
    # data/scope so an M&E officer can reproduce an export).
    period_mode = models.CharField(max_length=16, blank=True, default='quarter')
    filters_json = models.JSONField(default=dict, blank=True)
    scope_json = models.JSONField(default=dict, blank=True)
    warnings_json = models.JSONField(default=list, blank=True)
    published_by = models.ForeignKey(
        'users.User', on_delete=models.SET_NULL, null=True, blank=True, related_name='+',
    )
    published_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-generated_at']
        indexes = [
            models.Index(fields=['report_figure', '-generated_at'], name='frsn_figure_time_idx'),
            models.Index(fields=['project', 'period_start', 'period_end'], name='frsn_scope_idx'),
        ]

    def __str__(self):
        return f"snapshot[{self.report_figure_id}] {self.period_start}..{self.period_end}"
