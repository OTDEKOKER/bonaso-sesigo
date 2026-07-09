"""Figure generation service — turns a configured ``ReportFigure`` into
chart-ready JSON from EXISTING approved aggregate data.

Source of truth: ``aggregates.AggregateFact`` (the flattened, indexed projection
of approved ``Aggregate.value`` — one row per numeric disaggregate leaf, carrying
``canonical_indicator`` (alias-safe), ``organization``, ``period``, ``primary``
(KVP/category), ``secondary`` (sex), ``band`` (age) and ``value``). Targets come
from ``projects.ProjectIndicatorOrganizationTarget``. Nothing is invented here —
the service only groups/filters/compares what has already been reported and
approved.

The output is a normalized, frontend-agnostic dict so any chart library can
render it, plus warnings + a completeness snapshot so M&E officers see gaps.
"""
from __future__ import annotations

from collections import defaultdict
from decimal import Decimal

from django.db.models import Sum

from aggregates.models import AggregateFact
from aggregates import reporting_workbook as rw
from indicators.models import Indicator
from organizations.models import Organization
from projects.models import (
    ProjectIndicator, ProjectIndicatorOrganizationTarget,
    ProjectIndicatorAssignment, ProjectOrganization,
)

from .models import Dimension, CalculationMode, TargetMode, MappingRole

# Roles that contribute a positive "achieved" value.
ACHIEVED_ROLES = {
    MappingRole.ACHIEVED, MappingRole.CATEGORY, MappingRole.NUMERATOR,
    MappingRole.DENOMINATOR, MappingRole.COMPARISON,
}

# How each grouping dimension maps onto an AggregateFact column. ``period`` and
# ``coordinator`` are resolved specially.
_DIM_FIELD = {
    Dimension.ORGANIZATION: 'organization_id',
    Dimension.INDICATOR: 'canonical_indicator_id',
    Dimension.SEX: 'secondary',
    Dimension.AGE: 'band',
    Dimension.KEY_POPULATION: 'primary',
    Dimension.PERIOD: 'period_start',
}


def _f(value) -> float:
    if value is None:
        return 0.0
    if isinstance(value, Decimal):
        return float(value)
    return float(value)


# Request filter keys → AggregateFact columns. ``district`` is intentionally
# absent (not carried on aggregate facts) and is reported as unsupported.
_FILTER_FIELD = {
    'organization': 'organization_id',
    'coordinator': 'organization_id',   # pre-expanded to descendant org ids
    'indicator': 'canonical_indicator_id',
    'message_type': 'canonical_indicator_id',
    'service_category': 'canonical_indicator_id',
    'indicator_group': 'canonical_indicator_id',
    'sex': 'secondary',
    'age': 'band',
    'age_range': 'band',
    'key_population': 'primary',
    'kvp': 'primary',
}


class FigureGenerator:
    def __init__(self, figure, *, project, period_start, period_end, org_ids=None,
                 include_unapproved=False, filters=None):
        self.figure = figure
        self.project = project
        self.period_start = period_start
        self.period_end = period_end
        self.org_ids = set(org_ids) if org_ids is not None else None
        self.include_unapproved = include_unapproved
        # ``filters`` is the caller's already-scope-safe request filter dict
        # (the view intersects any org/coordinator filter with the user's
        # allowed scope before we see it — see permissions.scoped_filters).
        self.filters = filters or {}
        self.warnings: list[str] = []

    # ── public ────────────────────────────────────────────────────────────────
    def build(self) -> dict:
        fig = self.figure
        mappings = list(fig.mappings.select_related('indicator').all())
        achieved = [m for m in mappings if m.role in ACHIEVED_ROLES]
        if not achieved:
            self.warnings.append('Figure has no mapped indicators.')

        indicator_ids = [m.indicator_id for m in achieved]
        label_by_indicator = {
            m.indicator_id: (m.label_override or m.indicator.name) for m in achieved
        }

        base = self._base_facts(indicator_ids)
        primary_dim = fig.grouping_dimension
        secondary_dim = fig.secondary_grouping_dimension

        categories, series, category_keys = self._pivot(
            base, primary_dim, secondary_dim, label_by_indicator,
        )

        result = {
            'figure_id': fig.id,
            'figure_number': fig.figure_number,
            'title': fig.title,
            'description': fig.description,
            'chart_type': fig.chart_type,
            'grouping_dimension': primary_dim,
            'secondary_grouping_dimension': secondary_dim,
            'categories': categories,
            'series': series,
            'warnings': self.warnings,
        }

        total_achieved = sum(sum(s['data']) for s in series)
        if not indicator_ids:
            pass
        elif total_achieved == 0:
            self.warnings.append('Mapped indicators have no approved data for the selected period.')

        # Targets + achievement %.
        target_values = None
        totals = {'total': round(total_achieved, 2)}
        if fig.target_mode != TargetMode.NONE and primary_dim == Dimension.ORGANIZATION:
            target_values = self._targets_by_org(indicator_ids, category_keys)
            result['target'] = target_values
            total_target = sum(target_values)
            totals['target'] = round(total_target, 2)
            if total_target <= 0:
                self.warnings.append('Target required for this figure but none is configured.')
            if fig.calculation_mode == CalculationMode.ACHIEVEMENT_PERCENT:
                result['achievement_percent'] = [
                    round(100 * self._series_total_at(series, i) / t, 1) if t else None
                    for i, t in enumerate(target_values)
                ]
                totals['achievement_percent'] = (
                    round(100 * total_achieved / total_target, 1) if total_target else None
                )
        elif fig.target_mode != TargetMode.NONE:
            self.warnings.append(
                'Achieved-vs-target is only computed when grouping by organization; '
                'target skipped for this grouping.'
            )

        # Ratio (numerator / denominator × 100), e.g. referral rates.
        if fig.calculation_mode == CalculationMode.RATIO_PERCENT:
            result['ratio_percent'] = self._ratio(mappings, base)

        result['totals'] = totals
        result['completeness'] = self._completeness(indicator_ids)
        result['narrative'] = self._narrative(totals, categories, series)
        # Context echoed for display, snapshotting and export parity.
        result['applied_filters'] = {k: v for k, v in self.filters.items() if v not in (None, '', [])}
        result['scope'] = {
            'unrestricted': self.org_ids is None,
            'organization_ids': sorted(self.org_ids) if self.org_ids is not None else None,
            'approved_only': not self.include_unapproved,
        }
        result['period_start'] = str(self.period_start)
        result['period_end'] = str(self.period_end)
        if not result['categories']:
            self.warnings.append('No data matches the selected filters for this figure.')
        return result

    # ── data access ────────────────────────────────────────────────────────────
    def _base_facts(self, indicator_ids):
        qs = AggregateFact.objects.filter(
            project=self.project,
            canonical_indicator_id__in=indicator_ids or [0],
            is_training=False,
            period_start__gte=self.period_start,
            period_end__lte=self.period_end,
        )
        if not self.include_unapproved:
            qs = qs.filter(status='approved')
        if self.org_ids is not None:
            qs = qs.filter(organization_id__in=self.org_ids or [0])
        qs = self._apply_request_filters(qs)
        qs = self._apply_filters(qs)
        return qs

    def _apply_request_filters(self, qs):
        """Apply the caller's dashboard filters (sex/age/KVP/indicator/org/…).
        These NARROW within the already-enforced org scope; they can never widen
        it (the view has intersected org/coordinator filters with the user's
        allowed scope). ``status`` is honoured only when ``include_unapproved``
        was already granted by the view's permission check."""
        for key, value in self.filters.items():
            if key in ('status', 'approval_status'):
                continue
            field = _FILTER_FIELD.get(key)
            values = value if isinstance(value, (list, tuple, set)) else [value]
            values = [v for v in values if v not in (None, '')]
            if not values:
                continue
            if field is None:
                if key in ('district', 'districts'):
                    self.warnings.append(
                        'District filtering is not available from aggregate facts; '
                        'the district filter was ignored for this figure.'
                    )
                continue
            qs = qs.filter(**{f'{field}__in': values})
        return qs

    def _apply_filters(self, qs):
        for flt in self.figure.filters.all():
            field = _DIM_FIELD.get(flt.dimension_name)
            if field is None:
                continue
            if flt.filter_mode == flt.FILTER_INCLUDE and flt.allowed_values:
                qs = qs.filter(**{f'{field}__in': flt.allowed_values})
            if flt.exclude_values:
                qs = qs.exclude(**{f'{field}__in': flt.exclude_values})
        return qs

    # ── pivot ───────────────────────────────────────────────────────────────────
    def _pivot(self, base, primary_dim, secondary_dim, label_by_indicator):
        """Return (category_labels, series, category_keys). Categories are the
        primary-dimension buckets (x-axis); series are secondary-dimension splits.
        When there is no secondary dimension a single 'Value' series is returned."""
        p_field = _DIM_FIELD.get(primary_dim)
        s_field = _DIM_FIELD.get(secondary_dim) if secondary_dim != Dimension.NONE else None

        if p_field is None:  # NONE / unsupported (e.g. district/coordinator)
            if primary_dim in (Dimension.DISTRICT, Dimension.COORDINATOR):
                self.warnings.append(
                    f'Grouping by {primary_dim} is not available from aggregate '
                    f'facts; showing an overall total instead.'
                )
            total = _f(base.aggregate(s=Sum('value'))['s'])
            return ['Total'], [{'name': 'Value', 'data': [round(total, 2)]}], ['Total']

        group_fields = [p_field] + ([s_field] if s_field else [])
        rows = base.values(*group_fields).annotate(v=Sum('value'))

        cat_totals: dict = defaultdict(float)
        cell: dict = defaultdict(float)
        series_keys: list = []
        for r in rows:
            pk = r[p_field]
            cat_totals[pk] += _f(r['v'])
            if s_field:
                sk = r[s_field]
                cell[(pk, sk)] += _f(r['v'])
                if sk not in series_keys:
                    series_keys.append(sk)
            else:
                cell[(pk, '_')] += _f(r['v'])

        # Order categories: for indicator grouping keep mapping order; else by value desc.
        category_keys = sorted(cat_totals, key=lambda k: -cat_totals[k])
        p_labels = self._labels_for(primary_dim, category_keys, label_by_indicator)

        if s_field:
            series = []
            s_labels = self._labels_for(secondary_dim, series_keys, label_by_indicator)
            for sk, sname in zip(series_keys, s_labels):
                series.append({
                    'name': sname,
                    'data': [round(cell[(pk, sk)], 2) for pk in category_keys],
                })
        else:
            series = [{'name': 'Value', 'data': [round(cell[(pk, '_')], 2) for pk in category_keys]}]

        return p_labels, series, category_keys

    def _labels_for(self, dim, keys, label_by_indicator):
        if dim == Dimension.ORGANIZATION:
            names = dict(Organization.objects.filter(id__in=keys).values_list('id', 'name'))
            return [names.get(k, f'Org {k}') for k in keys]
        if dim == Dimension.INDICATOR:
            names = dict(Indicator.objects.filter(id__in=keys).values_list('id', 'name'))
            return [label_by_indicator.get(k) or names.get(k, f'Indicator {k}') for k in keys]
        if dim == Dimension.PERIOD:
            return [str(k) for k in keys]
        # sex / age / kvp are already the stored label strings.
        return [str(k) for k in keys]

    @staticmethod
    def _series_total_at(series, index):
        return sum(s['data'][index] for s in series if index < len(s['data']))

    # ── targets ────────────────────────────────────────────────────────────────
    def _targets_by_org(self, indicator_ids, org_keys):
        """Sum of quarterly (or annual) targets across mapped indicators, per org,
        aligned to ``org_keys``."""
        quarter_info = rw.quarter_of_period(self.period_start, self.period_end)
        pis = ProjectIndicator.objects.filter(
            project=self.project, indicator_id__in=indicator_ids,
        ).values_list('id', flat=True)
        rows = ProjectIndicatorOrganizationTarget.objects.filter(
            project_indicator_id__in=list(pis), organization_id__in=list(org_keys) or [0],
        ).values('organization_id', 'q1_target', 'q2_target', 'q3_target', 'q4_target', 'target_value')
        by_org: dict = defaultdict(float)
        for r in rows:
            if quarter_info is not None:
                q, _fy = quarter_info
                by_org[r['organization_id']] += _f(r[f'q{q}_target'])
            else:
                # Annual (or non-canonical window): prefer target_value, else sum q1..q4.
                annual = _f(r['target_value'])
                if annual == 0:
                    annual = sum(_f(r[f'q{i}_target']) for i in (1, 2, 3, 4))
                by_org[r['organization_id']] += annual
        return [round(by_org.get(k, 0.0), 2) for k in org_keys]

    # ── ratio calc ───────────────────────────────────────────────────────────────
    def _ratio(self, mappings, base):
        num_ids = [m.indicator_id for m in mappings if m.role == MappingRole.NUMERATOR]
        den_ids = [m.indicator_id for m in mappings if m.role == MappingRole.DENOMINATOR]
        if not num_ids or not den_ids:
            self.warnings.append('Ratio calculation needs both numerator and denominator indicators.')
            return None
        num = _f(base.filter(canonical_indicator_id__in=num_ids).aggregate(s=Sum('value'))['s'])
        den = _f(base.filter(canonical_indicator_id__in=den_ids).aggregate(s=Sum('value'))['s'])
        return round(100 * num / den, 1) if den else None

    # ── completeness ─────────────────────────────────────────────────────────────
    def _completeness(self, indicator_ids):
        """Which eligible orgs reported for this figure's indicators this period."""
        if not indicator_ids:
            return {'expected': 0, 'reporting': 0, 'missing': 0, 'missing_organization_ids': []}
        expected = set(
            ProjectIndicatorAssignment.objects.filter(
                project_indicator__project=self.project,
                project_indicator__indicator_id__in=indicator_ids,
                is_active=True,
            ).values_list('organization_id', flat=True)
        )
        if self.org_ids is not None:
            expected &= self.org_ids
        reporting = set(
            self._base_facts(indicator_ids).values_list('organization_id', flat=True).distinct()
        )
        missing = expected - reporting
        if missing:
            self.warnings.append(f'{len(missing)} expected organisation(s) have not reported for this figure.')
        return {
            'expected': len(expected), 'reporting': len(reporting & expected),
            'missing': len(missing), 'missing_organization_ids': sorted(missing),
        }

    # ── narrative ─────────────────────────────────────────────────────────────────
    def _narrative(self, totals, categories, series):
        tmpl = self.figure.narrative_template
        if not tmpl:
            return ''
        top_org = ''
        if categories and series:
            idx = max(range(len(categories)), key=lambda i: self._series_total_at(series, i))
            top_org = categories[idx]
        try:
            return tmpl.format(
                total=totals.get('total', 0),
                target=totals.get('target', ''),
                achievement_percent=totals.get('achievement_percent', ''),
                top_org=top_org,
                org_count=len(categories),
            )
        except (KeyError, IndexError, ValueError):
            return tmpl


def generate_figure(figure, *, project, period_start, period_end, org_ids=None,
                    include_unapproved=False, filters=None) -> dict:
    return FigureGenerator(
        figure, project=project, period_start=period_start, period_end=period_end,
        org_ids=org_ids, include_unapproved=include_unapproved, filters=filters,
    ).build()
