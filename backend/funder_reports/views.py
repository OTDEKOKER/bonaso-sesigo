"""Funder Report Builder API.

Config resources (templates / sections / figures / mappings / filters) are
admin-editable and fully audited. Preview/generate/export read EXISTING approved
aggregate data through :func:`funder_reports.generation.generate_figure`, scoped
to the caller's organisation permissions. Nothing here writes aggregate data.
"""
from __future__ import annotations

from datetime import date

from django.http import HttpResponse
from django.utils import timezone
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from audit.recording import record_audit_event
from aggregates import reporting_workbook as rw
from projects.models import Project

from .generation import generate_figure
from .models import (
    ReportTemplate, ReportSection, ReportFigure,
    ReportFigureIndicatorMapping, ReportFigureFilter, ReportFigureSnapshot,
)
from .permissions import (
    ReportBuilderPermission, allowed_org_ids_for_report, build_scoped_filters,
    can_view_unapproved, visible_templates, can_edit_report_object,
)
from .serializers import (
    ReportTemplateSerializer, ReportTemplateDetailSerializer, ReportSectionSerializer,
    ReportFigureSerializer, ReportFigureIndicatorMappingSerializer,
    ReportFigureFilterSerializer, ReportFigureSnapshotSerializer,
)


def resolve_generation_context(request, project):
    """Return (org_ids, filters, include_unapproved, period_mode) — the fully
    scope-safe context for a generation/preview/export. Org/coordinator filters
    are intersected with the caller's allowed scope; unapproved data is only ever
    included for reviewers/approvers, so no request parameter can escalate scope
    or reveal unreviewed data."""
    allowed = allowed_org_ids_for_report(request.user, project)
    filters, org_restrict, want_unapproved = build_scoped_filters(
        request, request.user, project, allowed,
    )
    include_unapproved = bool(want_unapproved and can_view_unapproved(request.user))
    # The effective org scope is the tighter of the allowed scope and any
    # requested org/coordinator filter.
    if org_restrict is not None:
        org_ids = org_restrict if allowed is None else org_restrict
    else:
        org_ids = allowed
    data = {**getattr(request, 'query_params', {}), **getattr(request, 'data', {})}
    period_mode = 'year' if str(data.get('period_type') or 'quarter').lower() in ('year', 'annual', 'yearly') else 'quarter'
    return org_ids, filters, include_unapproved, period_mode


def _audit(request, action_name, obj_type, obj_id, project, description, metadata=None):
    record_audit_event(
        action=action_name, request=request, object_type=obj_type, object_id=obj_id,
        project=project, description=description, metadata=metadata or {},
    )


def _guard_template_edit(request, template):
    """Self-service ownership guard for nested config creates: only an admin or the
    template's owner may add sections/figures/mappings/filters to it."""
    if not can_edit_report_object(request.user, template):
        raise PermissionDenied('You may only edit report figures on templates you own.')


def _figure_config(figure) -> dict:
    """Frozen snapshot of a figure's configuration (so a snapshot reproduces the
    exact chart even if the figure is later edited)."""
    return {
        'figure_id': figure.id, 'figure_number': figure.figure_number,
        'title': figure.title, 'chart_type': figure.chart_type,
        'grouping_dimension': figure.grouping_dimension,
        'secondary_grouping_dimension': figure.secondary_grouping_dimension,
        'target_mode': figure.target_mode, 'calculation_mode': figure.calculation_mode,
        'mappings': [
            {'indicator_id': m.indicator_id, 'role': m.role, 'label_override': m.label_override}
            for m in figure.mappings.all()
        ],
        'filters': [
            {'dimension_name': f.dimension_name, 'allowed_values': f.allowed_values,
             'exclude_values': f.exclude_values, 'filter_mode': f.filter_mode}
            for f in figure.filters.all()
        ],
    }


def _resolve_period(request):
    """(project, period_start, period_end, label) from request data/params.

    Accepts explicit period_start/period_end, or quarter+fiscal_year (Botswana FY),
    or period_type=year+fiscal_year for the annual view."""
    data = {**getattr(request, 'query_params', {}), **getattr(request, 'data', {})}
    project_id = data.get('project') or data.get('project_id')
    if not project_id:
        raise ValidationError('project is required.')
    try:
        project = Project.objects.get(pk=project_id)
    except (Project.DoesNotExist, ValueError, TypeError):
        raise ValidationError('Unknown project.')

    ps, pe = data.get('period_start'), data.get('period_end')
    if ps and pe:
        try:
            return project, date.fromisoformat(str(ps)[:10]), date.fromisoformat(str(pe)[:10]), f'{ps} – {pe}'
        except ValueError:
            raise ValidationError('Invalid period_start/period_end.')

    period_type = str(data.get('period_type') or 'quarter').lower()
    fy = data.get('fiscal_year') or data.get('fiscal_start_year')
    try:
        fy = int(fy)
    except (TypeError, ValueError):
        raise ValidationError('fiscal_year is required (or pass period_start & period_end).')

    if period_type in ('year', 'annual', 'yearly'):
        s, e = rw.year_period_range(fy)
        return project, s, e, rw.year_label(fy)
    quarter = str(data.get('quarter') or '').lstrip('Qq')
    try:
        quarter = int(quarter)
    except (TypeError, ValueError):
        raise ValidationError('quarter (1-4) or period dates are required.')
    s, e = rw.quarter_period_range(quarter, fy)
    return project, s, e, rw.quarter_label(quarter, fy)


class ReportTemplateViewSet(viewsets.ModelViewSet):
    queryset = ReportTemplate.objects.select_related('project', 'created_by').all()
    permission_classes = [ReportBuilderPermission]

    def get_serializer_class(self):
        return ReportTemplateDetailSerializer if self.action == 'retrieve' else ReportTemplateSerializer

    def get_queryset(self):
        qs = visible_templates(super().get_queryset(), self.request.user)
        p = self.request.query_params
        for field in ('project', 'funder', 'reporting_year'):
            if p.get(field):
                qs = qs.filter(**{field: p[field]})
        if p.get('is_active') in ('true', 'false'):
            qs = qs.filter(is_active=(p['is_active'] == 'true'))
        if p.get('mine') == 'true':
            qs = qs.filter(owner=self.request.user)
        return qs

    def perform_create(self, serializer):
        # Self-service: a template belongs to whoever created it. Non-admins
        # default to a PRIVATE personal template unless they pick a wider scope.
        obj = serializer.save(created_by=self.request.user, owner=self.request.user)
        _audit(self.request, 'reporting_period_created', 'report_template', obj.id,
               obj.project, f'Created funder report template "{obj.name}" (visibility={obj.visibility}).')

    def perform_update(self, serializer):
        obj = serializer.save()
        _audit(self.request, 'update', 'report_template', obj.id, obj.project,
               f'Updated funder report template "{obj.name}".')

    @action(detail=True, methods=['get'])
    def sections(self, request, pk=None):
        template = self.get_object()
        ser = ReportSectionSerializer(template.sections.all(), many=True)
        return Response(ser.data)

    @action(detail=True, methods=['post'])
    def generate(self, request, pk=None):
        """Generate EVERY active figure in the template, in report order, for a
        project + period. Returns the whole funder-ready dashboard payload."""
        template = self.get_object()
        project, ps, pe, label = _resolve_period(request)
        org_ids, filters, include_unapproved, _mode = resolve_generation_context(request, project)

        sections_out = []
        for section in template.sections.prefetch_related('figures__mappings', 'figures__filters').all():
            figures_out = [
                generate_figure(fig, project=project, period_start=ps, period_end=pe,
                                org_ids=org_ids, include_unapproved=include_unapproved, filters=filters)
                for fig in section.figures.all() if fig.is_active
            ]
            sections_out.append({
                'id': section.id, 'title': section.title,
                'objective_label': section.objective_label, 'figures': figures_out,
            })
        _audit(request, 'export', 'report_template', template.id, project,
               f'Generated funder report dashboard for {label}.',
               {'period_start': str(ps), 'period_end': str(pe)})
        return Response({
            'template': {'id': template.id, 'name': template.name},
            'project': project.id, 'period_start': str(ps), 'period_end': str(pe),
            'period_label': label, 'sections': sections_out,
        })

    @action(detail=True, methods=['post'], url_path='export-word')
    def export_word(self, request, pk=None):
        """Export the WHOLE report as a Word (.docx) document — sections + every
        active figure (data table, narrative, warnings) — using the SAME
        scope-safe filters and permissions as the on-screen dashboard. (PDF is the
        documented next step; see docs.)"""
        from .export import report_to_docx
        template = self.get_object()
        project, ps, pe, label = _resolve_period(request)
        org_ids, filters, include_unapproved, _mode = resolve_generation_context(request, project)

        sections_out = []
        for section in template.sections.prefetch_related('figures__mappings', 'figures__filters').all():
            figures_out = [
                generate_figure(fig, project=project, period_start=ps, period_end=pe,
                                org_ids=org_ids, include_unapproved=include_unapproved, filters=filters)
                for fig in section.figures.all() if fig.is_active
            ]
            sections_out.append({'title': section.title, 'objective_label': section.objective_label,
                                 'figures': figures_out})
        _audit(request, 'export', 'report_template', template.id, project,
               f'Exported full Word report for {label}.', {'format': 'docx', 'filters': filters})
        content = report_to_docx(template_name=template.name, period_label=label,
                                 sections=sections_out, user=request.user)
        resp = HttpResponse(
            content,
            content_type='application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        )
        safe = ''.join(c for c in template.name if c.isalnum() or c in ' -_').strip().replace(' ', '_')
        resp['Content-Disposition'] = f'attachment; filename="{safe or "report"}_{ps}_{pe}.docx"'
        return resp


class ReportSectionViewSet(viewsets.ModelViewSet):
    queryset = ReportSection.objects.select_related('report_template__project').all()
    serializer_class = ReportSectionSerializer
    permission_classes = [ReportBuilderPermission]

    def get_queryset(self):
        qs = super().get_queryset()
        if self.request.query_params.get('report_template'):
            qs = qs.filter(report_template_id=self.request.query_params['report_template'])
        return qs

    def perform_create(self, serializer):
        _guard_template_edit(self.request, serializer.validated_data['report_template'])
        obj = serializer.save()
        _audit(self.request, 'update', 'report_section', obj.id,
               obj.report_template.project, f'Added section "{obj.title}".')


class ReportFigureViewSet(viewsets.ModelViewSet):
    queryset = ReportFigure.objects.select_related('report_section__report_template__project').all()
    serializer_class = ReportFigureSerializer
    permission_classes = [ReportBuilderPermission]

    def get_queryset(self):
        qs = super().get_queryset()
        if self.request.query_params.get('report_section'):
            qs = qs.filter(report_section_id=self.request.query_params['report_section'])
        return qs

    def _project(self, figure):
        return figure.report_section.report_template.project

    def perform_create(self, serializer):
        _guard_template_edit(self.request, serializer.validated_data['report_section'].report_template)
        obj = serializer.save()
        _audit(self.request, 'update', 'report_figure', obj.id, self._project(obj),
               f'Added figure "{obj.title}".')

    def perform_update(self, serializer):
        obj = serializer.save()
        _audit(self.request, 'update', 'report_figure', obj.id, self._project(obj),
               f'Edited figure "{obj.title}".')

    @action(detail=True, methods=['post'])
    def mappings(self, request, pk=None):
        """Attach an indicator mapping to this figure."""
        figure = self.get_object()
        data = {**request.data, 'report_figure': figure.id}
        ser = ReportFigureIndicatorMappingSerializer(data=data)
        ser.is_valid(raise_exception=True)
        obj = ser.save()
        _audit(request, 'assign', 'report_figure_mapping', obj.id, self._project(figure),
               f'Mapped indicator {obj.indicator_id} to figure "{figure.title}" as {obj.role}.')
        return Response(ser.data, status=201)

    @action(detail=True, methods=['post'])
    def preview(self, request, pk=None):
        """Generate just this figure for a project + period, honouring the same
        scope-safe filters as generate/export (real approved data by default)."""
        figure = self.get_object()
        project, ps, pe, label = _resolve_period(request)
        org_ids, filters, include_unapproved, _mode = resolve_generation_context(request, project)
        payload = generate_figure(figure, project=project, period_start=ps, period_end=pe,
                                  org_ids=org_ids, include_unapproved=include_unapproved, filters=filters)
        payload['period_label'] = label
        return Response(payload)

    @action(detail=True, methods=['post'])
    def duplicate(self, request, pk=None):
        """Clone a figure (config + mappings + filters) within its section."""
        figure = self.get_object()
        clone = ReportFigure.objects.create(
            report_section=figure.report_section,
            figure_number=f'{figure.figure_number} (copy)', title=f'{figure.title} (copy)',
            description=figure.description, chart_type=figure.chart_type,
            display_order=figure.display_order + 1, aggregation_method=figure.aggregation_method,
            grouping_dimension=figure.grouping_dimension,
            secondary_grouping_dimension=figure.secondary_grouping_dimension,
            target_mode=figure.target_mode, calculation_mode=figure.calculation_mode,
            narrative_template=figure.narrative_template, is_active=figure.is_active,
        )
        for m in figure.mappings.all():
            ReportFigureIndicatorMapping.objects.create(
                report_figure=clone, indicator_id=m.indicator_id, role=m.role,
                label_override=m.label_override, display_order=m.display_order,
                include_in_total=m.include_in_total, calculation_role=m.calculation_role,
            )
        for f in figure.filters.all():
            ReportFigureFilter.objects.create(
                report_figure=clone, dimension_name=f.dimension_name,
                allowed_values=f.allowed_values, exclude_values=f.exclude_values,
                filter_mode=f.filter_mode,
            )
        _audit(request, 'update', 'report_figure', clone.id, self._project(clone),
               f'Duplicated figure "{figure.title}".')
        return Response(self.get_serializer(clone).data, status=201)

    @action(detail=True, methods=['post'], url_path='set-active')
    def set_active(self, request, pk=None):
        """Enable/disable a figure's visibility in generated reports."""
        figure = self.get_object()
        figure.is_active = str(request.data.get('is_active', 'true')).lower() in ('true', '1', 'yes')
        figure.save(update_fields=['is_active'])
        _audit(request, 'update', 'report_figure', figure.id, self._project(figure),
               f'{"Enabled" if figure.is_active else "Disabled"} figure "{figure.title}".')
        return Response(self.get_serializer(figure).data)

    @action(detail=True, methods=['post'], url_path='save-snapshot')
    def save_snapshot(self, request, pk=None):
        figure = self.get_object()
        project, ps, pe, label = _resolve_period(request)
        org_ids, filters, include_unapproved, mode = resolve_generation_context(request, project)
        payload = generate_figure(figure, project=project, period_start=ps, period_end=pe,
                                  org_ids=org_ids, include_unapproved=include_unapproved, filters=filters)
        snap = ReportFigureSnapshot.objects.create(
            report_figure=figure, project=project, period_start=ps, period_end=pe,
            generated_by=request.user, data_json=payload,
            chart_config_json=_figure_config(figure),
            narrative_text=payload.get('narrative', ''),
            period_mode=mode, filters_json=payload.get('applied_filters', {}),
            scope_json=payload.get('scope', {}), warnings_json=payload.get('warnings', []),
            status=ReportFigureSnapshot.STATUS_DRAFT,
        )
        _audit(request, 'export', 'report_figure_snapshot', snap.id, project,
               f'Saved snapshot of figure "{figure.title}" for {label}.',
               {'filters': payload.get('applied_filters', {}), 'period_mode': mode})
        return Response(ReportFigureSnapshotSerializer(snap).data, status=201)

    @action(detail=True, methods=['post'])
    def export(self, request, pk=None):
        """Export this figure as an .xlsx workbook using the SAME filters and
        permission scope as the preview — data table + applied filters + narrative
        + warnings + who/when metadata. Never exports data outside scope."""
        from .export import figure_to_xlsx
        figure = self.get_object()
        project, ps, pe, label = _resolve_period(request)
        org_ids, filters, include_unapproved, mode = resolve_generation_context(request, project)
        payload = generate_figure(figure, project=project, period_start=ps, period_end=pe,
                                  org_ids=org_ids, include_unapproved=include_unapproved, filters=filters)
        payload['period_label'] = label
        _audit(request, 'export', 'report_figure', figure.id, project,
               f'Exported figure "{figure.title}" for {label}.',
               {'filters': payload.get('applied_filters', {})})
        content = figure_to_xlsx(payload, figure=figure, user=request.user)
        resp = HttpResponse(
            content,
            content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        )
        resp['Content-Disposition'] = f'attachment; filename="figure_{figure.id}_{ps}_{pe}.xlsx"'
        return resp


class ReportFigureIndicatorMappingViewSet(viewsets.ModelViewSet):
    queryset = ReportFigureIndicatorMapping.objects.select_related(
        'indicator', 'report_figure__report_section__report_template__project').all()
    serializer_class = ReportFigureIndicatorMappingSerializer
    permission_classes = [ReportBuilderPermission]
    edit_permission = 'mappings'  # admin or manager may curate mappings

    def get_queryset(self):
        qs = super().get_queryset()
        if self.request.query_params.get('report_figure'):
            qs = qs.filter(report_figure_id=self.request.query_params['report_figure'])
        return qs

    def perform_create(self, serializer):
        figure = serializer.validated_data['report_figure']
        _guard_template_edit(self.request, figure.report_section.report_template)
        serializer.save()

    def perform_destroy(self, instance):
        project = instance.report_figure.report_section.report_template.project
        _audit(self.request, 'update', 'report_figure_mapping', instance.id, project,
               f'Removed indicator {instance.indicator_id} from figure {instance.report_figure_id}.')
        instance.delete()


class ReportFigureFilterViewSet(viewsets.ModelViewSet):
    queryset = ReportFigureFilter.objects.all()
    serializer_class = ReportFigureFilterSerializer
    permission_classes = [ReportBuilderPermission]
    edit_permission = 'mappings'

    def get_queryset(self):
        qs = super().get_queryset()
        if self.request.query_params.get('report_figure'):
            qs = qs.filter(report_figure_id=self.request.query_params['report_figure'])
        return qs

    def perform_create(self, serializer):
        figure = serializer.validated_data['report_figure']
        _guard_template_edit(self.request, figure.report_section.report_template)
        serializer.save()


class ReportFigureSnapshotViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = ReportFigureSnapshot.objects.select_related('report_figure', 'project').all()
    serializer_class = ReportFigureSnapshotSerializer
    permission_classes = [ReportBuilderPermission]

    def get_queryset(self):
        qs = super().get_queryset()
        p = self.request.query_params
        if p.get('report_figure'):
            qs = qs.filter(report_figure_id=p['report_figure'])
        if p.get('project'):
            qs = qs.filter(project_id=p['project'])
        if p.get('status'):
            qs = qs.filter(status=p['status'])
        return qs

    @action(detail=True, methods=['post'])
    def publish(self, request, pk=None):
        """Finalize/publish a snapshot. Its stored data/config/filters are frozen,
        so the funder-facing output stays stable even if the figure is later
        reconfigured."""
        snap = self.get_object()
        snap.status = ReportFigureSnapshot.STATUS_PUBLISHED
        snap.published_by = request.user
        snap.published_at = timezone.now()
        snap.save(update_fields=['status', 'published_by', 'published_at'])
        _audit(request, 'update', 'report_figure_snapshot', snap.id,
               snap.project, f'Published snapshot {snap.id} (finalized for funder).')
        return Response(ReportFigureSnapshotSerializer(snap).data)
