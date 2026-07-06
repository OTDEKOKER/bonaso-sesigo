from rest_framework import viewsets, status
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework.exceptions import PermissionDenied
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework.filters import SearchFilter, OrderingFilter
from rest_framework.pagination import PageNumberPagination
from django.utils import timezone
from django.db import models, transaction
from django.db.models import Count, Sum, Avg, Q, F
from django.core.cache import cache
from django.utils.text import slugify
from datetime import date
from django.http import HttpResponse
import csv
import json
import re
import hashlib
from collections import defaultdict
from io import BytesIO

from .models import Report, SavedQuery, ScheduledReport, CoordinatorTarget
from indicators.models import Indicator
from indicators.canonical import canonical_id_map
from projects.models import Project
from projects.hierarchy import resolve_organization_scope_with_project_hierarchy
from projects.assignment_rules import (
    count_project_indicators_for_organization_scope,
    project_indicator_ids_for_organization_scope,
)
from projects.scope import (
    get_default_project_id,
    get_user_project_scope,
    user_can_access_project,
    filter_queryset_by_assigned_projects,
)
from .serializers import ReportSerializer, SavedQuerySerializer, ScheduledReportSerializer, CoordinatorTargetSerializer
from .services.coordinator_rollups import get_coordinator_performance, performance_status as coordinator_performance_status
from audit.recording import record_audit_event
from aggregates.models import Aggregate
from organizations.access import get_user_organization_ids, is_organization_admin, filter_queryset_by_org_ids, apply_training_filter, apply_training_filter_to_projects, should_include_training, training_view_mode, is_training_only_request
from users.permissions import HasModulePermission
from organizations.models import Organization


def _month_start(base: date, offset: int) -> date:
    year = base.year
    month = base.month - offset
    while month <= 0:
        month += 12
        year -= 1
    return date(year, month, 1)


def _month_range(start: date, end: date):
    current = date(start.year, start.month, 1)
    last = date(end.year, end.month, 1)
    months = []
    while current <= last:
        months.append(current)
        year = current.year + (current.month // 12)
        month = current.month % 12 + 1
        current = date(year, month, 1)
    return months


def _extract_total(value) -> float:
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, dict):
        if value.get('total') is not None:
            return float(value.get('total') or 0)
        male = float(value.get('male') or 0)
        female = float(value.get('female') or 0)
        return male + female
    return 0.0


def _canonical_indicator_resolver():
    """Return ``(canon_id_for(indicator_id), meta_for(canon_id))`` helpers.

    Rolls duplicate indicators (DI-1/AN-1) up to their canonical row so dashboard
    and report totals reconcile to a single metric instead of being split across
    ``AUTO_*`` / ``NAHPA*`` / ``SC_*`` duplicates. ``meta_for`` yields the
    canonical code/name for labelling. One light query, cached per call.
    """
    id_map = canonical_id_map()
    meta = {
        ind_id: {'indicator_code': code, 'indicator_name': name}
        for ind_id, code, name in Indicator.objects.values_list('id', 'code', 'name')
    }

    def canon_id_for(indicator_id):
        return id_map.get(indicator_id, indicator_id)

    def meta_for(canon_id):
        return meta.get(canon_id, {'indicator_code': '', 'indicator_name': f'Indicator {canon_id}'})

    return canon_id_for, meta_for


def _next_run_for_frequency(frequency: str):
    now = timezone.now()
    if frequency == 'daily':
        return now + timezone.timedelta(days=1)
    if frequency == 'weekly':
        return now + timezone.timedelta(days=7)
    if frequency == 'monthly':
        return now + timezone.timedelta(days=30)
    if frequency == 'quarterly':
        return now + timezone.timedelta(days=90)
    return now + timezone.timedelta(days=7)


def _safe_parse_date(value: str):
    try:
        return date.fromisoformat(value)
    except Exception:
        return None


def _safe_parse_int(value):
    try:
        return int(value)
    except Exception:
        return None


def _organization_scope_with_descendants(org_id: int, project_id: int | None = None):
    return resolve_organization_scope_with_project_hierarchy(org_id, project_id=project_id)


def _restrict_aggregates_to_user_scope(aggregates, user):
    if is_organization_admin(user):
        return aggregates
    org_ids = get_user_organization_ids(user)
    if org_ids:
        return filter_queryset_by_org_ids(aggregates, 'organization_id', org_ids)
    return Aggregate.objects.none()


def _approved_aggregates_only(aggregates, request):
    status_param = request.query_params.get('status')
    if status_param:
        statuses = [value.strip() for value in status_param.split(',') if value.strip()]
        if statuses:
            return aggregates.filter(status__in=statuses)
    return aggregates.filter(status='approved')


def _normalize_dashboard_text(value):
    return re.sub(r'[^a-z0-9]+', ' ', str(value or '').lower()).strip()


_ORG_CANONICAL_ALIASES = {
    'bonela': 'BONELA',
    'mbge': 'MBGE',
    'men boys': 'MBGE',
    'men and boys': 'MBGE',
    'men boys for gender equality': 'MBGE',
    'men and boys for gender equality': 'MBGE',
    'men boys for gender equality mbge': 'MBGE',
    'men and boys for gender equality mbge': 'MBGE',
    'gfc': 'Gende Fountain',
    'gender fountain': 'Gende Fountain',
    'gender fountain center': 'Gende Fountain',
    'gende fountain': 'Gende Fountain',
    'ovajua': 'Ovajuha',
    'ovajhuha': 'Ovajuha',
    'ovajuha': 'Ovajuha',
    'inspired horizons': 'Inpired Horizons',
    'inspired hozirons': 'Inpired Horizons',
    'inpired horizons': 'Inpired Horizons',
    'tebelopele': 'TEBELOPELE',
    'tebe lopele': 'TEBELOPELE',
    'bonepwa': 'BONEPWA',
    'bone pwa': 'BONEPWA',
    'makgabaneng': 'MAKGABANENG',
    'mak gabaneng': 'MAKGABANENG',
    'aheeme': 'AHEEME',
    'a he eme': 'AHEEME',
}

_RECOGNIZED_PARENT_ORGANIZATIONS = {
    'BONELA',
    'MBGE',
    'TEBELOPELE',
    'BONEPWA',
    'MAKGABANENG',
}


def _canonicalize_organization_name(name):
    normalized = _normalize_dashboard_text(name)
    if normalized in _ORG_CANONICAL_ALIASES:
        return _ORG_CANONICAL_ALIASES[normalized]
    return str(name or '').strip()


def _is_bonaso_organization_name(name):
    return _canonicalize_organization_name(name) == 'BONASO'


def _is_seed_coordinator_organization_name(name):
    canonical = _canonicalize_organization_name(name)
    return canonical in _RECOGNIZED_PARENT_ORGANIZATIONS and canonical != 'BONASO'


def _normalize_organization_type(org_type):
    normalized = str(org_type or '').strip().lower()
    if not normalized:
        return ''
    legacy_to_canonical = {
        'headquarters': 'senior_coordinator',
        'regional': 'coordinator',
        'district': 'coordinator',
        'partner': 'subgrantee',
        'ngo': 'senior_coordinator',
        'government': 'funder',
    }
    return legacy_to_canonical.get(normalized, normalized)


def _get_effective_organization_type(name, org_type):
    if _is_bonaso_organization_name(name):
        return 'senior_coordinator'
    if _is_seed_coordinator_organization_name(name):
        return 'coordinator'
    return _normalize_organization_type(org_type)


def _is_coordinator_portfolio_organization(subject):
    return _get_effective_organization_type(subject.get('name'), subject.get('type')) == 'coordinator'


def _resolve_coordinator_rollup_organization(organization_id, fallback_label, organization_by_id):
    if not organization_id:
        return {
            'key': f'name:{fallback_label or "Unassigned org"}',
            'label': fallback_label or 'Unassigned org',
        }

    current = organization_by_id.get(int(organization_id))
    last_known = current
    visited = set()

    while current:
        current_id = current.get('id')
        if not current_id or current_id in visited:
            break
        visited.add(current_id)
        last_known = current

        if _is_coordinator_portfolio_organization(current):
            label = str(current.get('name') or fallback_label or 'Unassigned org')
            return {
                'key': str(current_id),
                'label': label,
            }

        parent_id = current.get('parent_id')
        if not parent_id:
            break
        current = organization_by_id.get(int(parent_id))

    if last_known:
        label = str(last_known.get('name') or fallback_label or 'Unassigned org')
        return {
            'key': str(last_known.get('id') or f'name:{label}'),
            'label': label,
        }

    return {
        'key': str(organization_id),
        'label': fallback_label or 'Unassigned org',
    }


_HIV_PREVENTION_MESSAGE_TYPE_PALETTE = [
    '#4F81BD',
    '#ED7D31',
    '#A5A5A5',
    '#FFC000',
    '#4472C4',
    '#70AD47',
    '#255E91',
    '#9E480E',
]

_EXPLICIT_HIV_MESSAGE_INDICATOR_IDS = {
    321, 322, 323, 324, 325, 326, 327, 328, 329, 330, 522, 523,
}
_HIV_MESSAGE_INDICATOR_CATALOG_CACHE_KEY = 'analysis:dashboard:hiv_message_indicator_catalog:v1'
_HIV_MESSAGE_INDICATOR_CATALOG_CACHE_TTL_SECONDS = 30 * 60
_ORGANIZATION_ROLLUP_CATALOG_CACHE_KEY = 'analysis:dashboard:organization_rollup_catalog:v1'
_ORGANIZATION_ROLLUP_CATALOG_CACHE_TTL_SECONDS = 10 * 60
_MESSAGE_ANALYTICS_RESPONSE_CACHE_TTL_SECONDS = 5 * 60


def _is_hiv_prevention_message_indicator(indicator_id, indicator_name, indicator_code):
    if indicator_id in _EXPLICIT_HIV_MESSAGE_INDICATOR_IDS:
        return True

    match_text = _normalize_dashboard_text(f'{indicator_code or ""} {indicator_name or ""}')
    has_messaging_token = (
        'message' in match_text
        or 'reached' in match_text
        or 'sensitized' in match_text
        or 'sensitised' in match_text
        or 'engaged' in match_text
    )
    has_hiv_program_token = any(
        token in match_text
        for token in ['hiv', 'prep', 'pep', 'gbv', 'condom', 'arv', 'emtct', 'stigma']
    )
    return has_messaging_token and has_hiv_program_token


def _get_hiv_prevention_message_type(indicator_name, indicator_code):
    match_text = _normalize_dashboard_text(f'{indicator_code or ""} {indicator_name or ""}')

    if 'prep' in match_text:
        return 'PrEP'
    if 'pep' in match_text:
        return 'PEP'
    if 'gbv' in match_text:
        return 'GBV'
    if 'emtct' in match_text:
        return 'EMTCT'
    if 'condom' in match_text:
        return 'Condom Use'
    if 'treatment' in match_text:
        return 'HIV Treatment'
    if 'arv' in match_text:
        return 'ARV Based Prevention'
    if 'stigma' in match_text:
        return 'Stigma Reduction'
    if 'testing' in match_text:
        return 'HIV Testing'
    if 'hiv' in match_text:
        return 'HIV Messages'

    label = str(indicator_name or '').strip()
    return label or 'Other HIV Messaging'


def _to_series_key(value):
    normalized = _normalize_dashboard_text(value).replace(' ', '_')
    return normalized or 'other'


def _build_hiv_message_indicator_catalog():
    name_filter = (
        models.Q(name__icontains='message')
        & (
            models.Q(name__icontains='hiv')
            | models.Q(name__icontains='prep')
            | models.Q(name__icontains='pep')
            | models.Q(name__icontains='gbv')
            | models.Q(name__icontains='arv')
            | models.Q(name__icontains='emtct')
            | models.Q(name__icontains='stigma')
        )
    )
    indicator_rows = Indicator.objects.filter(
        models.Q(id__in=_EXPLICIT_HIV_MESSAGE_INDICATOR_IDS) | name_filter
    ).values_list('id', 'name', 'code')

    catalog = {}
    for indicator_id, indicator_name, indicator_code in indicator_rows.iterator(chunk_size=500):
        parsed_indicator_id = int(indicator_id or 0)
        if parsed_indicator_id <= 0:
            continue
        if not _is_hiv_prevention_message_indicator(
            indicator_id=parsed_indicator_id,
            indicator_name=indicator_name,
            indicator_code=indicator_code,
        ):
            continue
        catalog[parsed_indicator_id] = _get_hiv_prevention_message_type(
            indicator_name=indicator_name,
            indicator_code=indicator_code,
        )
    return catalog


def _get_hiv_message_indicator_catalog():
    cached = cache.get(_HIV_MESSAGE_INDICATOR_CATALOG_CACHE_KEY)
    if isinstance(cached, dict):
        return cached
    catalog = _build_hiv_message_indicator_catalog()
    cache.set(
        _HIV_MESSAGE_INDICATOR_CATALOG_CACHE_KEY,
        catalog,
        timeout=_HIV_MESSAGE_INDICATOR_CATALOG_CACHE_TTL_SECONDS,
    )
    return catalog


def _get_organization_rollup_catalog():
    cached = cache.get(_ORGANIZATION_ROLLUP_CATALOG_CACHE_KEY)
    if isinstance(cached, dict):
        return cached

    organization_by_id = {
        organization.id: {
            'id': organization.id,
            'name': organization.name,
            'type': organization.type,
            'parent_id': organization.parent_id,
        }
        for organization in Organization.objects.only('id', 'name', 'type', 'parent_id')
    }
    cache.set(
        _ORGANIZATION_ROLLUP_CATALOG_CACHE_KEY,
        organization_by_id,
        timeout=_ORGANIZATION_ROLLUP_CATALOG_CACHE_TTL_SECONDS,
    )
    return organization_by_id


def _message_analytics_effective_scope_signature(effective_org_ids):
    if effective_org_ids is None:
        return 'all'
    if len(effective_org_ids) == 0:
        return 'none'
    sorted_ids = ','.join(str(org_id) for org_id in sorted(effective_org_ids))
    return hashlib.sha1(sorted_ids.encode('utf-8')).hexdigest()


def _build_message_analytics_cache_key(
    user_id,
    project_id,
    coordinator_id,
    organization_id,
    date_from,
    date_to,
    effective_org_ids,
    mode='live',
):
    key_source = '|'.join(
        [
            f'user:{user_id or 0}',
            f'project:{project_id or 0}',
            f'coordinator:{coordinator_id or 0}',
            f'organization:{organization_id or 0}',
            f'date_from:{date_from.isoformat() if date_from else "none"}',
            f'date_to:{date_to.isoformat() if date_to else "none"}',
            f'scope:{_message_analytics_effective_scope_signature(effective_org_ids)}',
            # Separate cache entries per data-isolation mode so a live request
            # can never be served a training-cached payload (or vice versa).
            f'mode:{mode}',
        ]
    )
    digest = hashlib.sha1(key_source.encode('utf-8')).hexdigest()
    return f'analysis:dashboard:message_analytics:v2:{digest}'


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def chart_export_excel(request):
    """Render a portal chart spec to a native Excel chart workbook.

    The frontend posts the already-rendered chart data (categories + series +
    palette colours + source filters); we echo it into an .xlsx with a real
    Excel chart so the download matches the on-screen chart, colours included.
    No DB query happens here — the data was already mode/permission filtered by
    whichever endpoint produced the chart.
    """
    from django.utils.text import slugify
    from .chart_export import build_chart_workbook

    spec = dict(request.data) if isinstance(request.data, dict) else {}
    series = spec.get('series') or []
    categories = spec.get('categories') or []
    if not series or not categories:
        return Response(
            {'detail': 'chart export requires non-empty categories and series.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # Stamp the workbook server-side (never trust the client for these): the
    # environment comes from the request's resolved mode, the user from the
    # authenticated request, and the timestamp from the server clock. This keeps
    # a training-mode export from ever being mislabelled as live.
    spec['environment'] = 'TRAINING' if is_training_only_request(request) else 'LIVE'
    spec['exported_by'] = getattr(request.user, 'username', None) or getattr(request.user, 'email', '') or '—'
    spec['exported_at'] = timezone.now().strftime('%Y-%m-%d %H:%M:%S %Z') or timezone.now().isoformat()

    content = build_chart_workbook(spec)
    env_tag = 'training' if spec['environment'] == 'TRAINING' else 'live'
    safe_name = f"{slugify(str(spec.get('title') or 'chart')) or 'chart'}-{env_tag}"
    response = HttpResponse(
        content,
        content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )
    response['Content-Disposition'] = f'attachment; filename="{safe_name}.xlsx"'
    return response


def _fiscal_year_quarter_for_month(month_start):
    """(fiscal_year, 'Q1'..'Q4') for a month. Botswana FY: Apr-Mar; Jan-Mar
    belongs to the PREVIOUS fiscal year's Q4."""
    m, y = month_start.month, month_start.year
    if 4 <= m <= 6:
        return (y, 'Q1')
    if 7 <= m <= 9:
        return (y, 'Q2')
    if 10 <= m <= 12:
        return (y, 'Q3')
    return (y - 1, 'Q4')


def compute_trend_targets(indicator_ids, month_starts, *, project_id, org_scope, request):
    """Effective (or configured) target per (indicator_id, month_start) for the
    dashboard trend charts, quarter-aligned.

    Targets are quarterly; the trend axis is monthly, and the frontend SUMS the
    per-month ``target`` within each quarter — so we place a quarter's whole
    target on the FIRST in-range month of that quarter and leave the other months
    at 0 (no triple-counting). Fixed indicators use the summed POT quarterly
    targets over the requested org scope; derived/percentage indicators use the
    source indicator's ACHIEVED value over the same scope/quarter (× percent) —
    the Effective Target — computed at read time. Stored targets are never
    modified. Missing source => 0 (no target line; pending is surfaced on the
    Coordinator Targets page).
    """
    from projects.models import ProjectIndicator, ProjectIndicatorOrganizationTarget
    from analysis.services.coordinator_rollups import fiscal_quarter_range

    result = {iid: {ms: 0.0 for ms in month_starts} for iid in indicator_ids}
    if project_id is None or not month_starts:
        return result

    q_field = {'Q1': 'q1_target', 'Q2': 'q2_target', 'Q3': 'q3_target', 'Q4': 'q4_target'}

    # Earliest in-range month per (fiscal_year, quarter) carries that quarter's target.
    anchor = {}
    for ms in month_starts:
        key = _fiscal_year_quarter_for_month(ms)
        if key not in anchor or ms < anchor[key]:
            anchor[key] = ms

    inds = {i.id: i for i in Indicator.objects.filter(id__in=indicator_ids).select_related('canonical_indicator')}
    canon_of = {iid: (inds[iid].canonical_id if iid in inds else iid) for iid in indicator_ids}

    pi_by_canon = {}
    for pi in (
        ProjectIndicator.objects.filter(project_id=project_id)
        .select_related('indicator', 'target_source_indicator')
    ):
        c = pi.indicator.canonical_id if pi.indicator_id else pi.indicator_id
        pi_by_canon[c] = pi

    # Precompute source achieved per (source_canonical, fiscal_year, quarter).
    source_canons = set()
    for iid in indicator_ids:
        pi = pi_by_canon.get(canon_of[iid])
        if pi and pi.target_source_type in ('derived', 'percentage') and pi.target_source_indicator_id:
            source_canons.add(pi.target_source_indicator.canonical_id)

    source_achieved = {}
    if source_canons:
        src_ids = list(
            Indicator.objects.filter(
                models.Q(id__in=source_canons) | models.Q(canonical_indicator_id__in=source_canons)
            ).values_list('id', flat=True)
        )
        src_canon_of = dict(Indicator.objects.filter(id__in=src_ids).values_list('id', 'canonical_indicator_id'))
        aq = Aggregate.objects.filter(indicator_id__in=src_ids, status='approved', project_id=project_id)
        aq = apply_training_filter(aq, request, project_lookup='project')
        aq = _restrict_aggregates_to_user_scope(aq, request.user)
        if org_scope is not None:
            aq = aq.filter(organization_id__in=org_scope)
        q_ranges = {q: fiscal_quarter_range(q[0], q[1]) for q in anchor}
        for agg in aq:
            c = src_canon_of.get(agg.indicator_id) or agg.indicator_id
            for q, (start, end) in q_ranges.items():
                if agg.period_start <= end and agg.period_end >= start:
                    k = (c, q[0], q[1])
                    source_achieved[k] = source_achieved.get(k, 0.0) + _extract_total(agg.value)

    # Configured (fixed) targets: summed POT quarterly targets over the scope.
    pot_qs = ProjectIndicatorOrganizationTarget.objects.filter(project_indicator__project_id=project_id)
    if org_scope is not None:
        pot_qs = pot_qs.filter(organization_id__in=org_scope)
    pot_sum = {}
    for pot in pot_qs.select_related('project_indicator__indicator'):
        pi = pot.project_indicator
        c = pi.indicator.canonical_id if pi.indicator_id else pi.indicator_id
        for q in ('Q1', 'Q2', 'Q3', 'Q4'):
            pot_sum[(c, q)] = pot_sum.get((c, q), 0.0) + float(getattr(pot, q_field[q]) or 0)

    for iid in indicator_ids:
        c = canon_of[iid]
        pi = pi_by_canon.get(c)
        derived = bool(pi and pi.target_source_type in ('derived', 'percentage') and pi.target_source_indicator_id)
        for (fy, q), anchor_month in anchor.items():
            if derived:
                src_c = pi.target_source_indicator.canonical_id
                achieved = source_achieved.get((src_c, fy, q))
                if achieved is None:
                    target_value = 0.0  # pending source — no target line here
                elif pi.target_source_type == 'percentage' and pi.target_source_percentage is not None:
                    target_value = achieved * float(pi.target_source_percentage) / 100.0
                else:
                    target_value = achieved
            else:
                target_value = pot_sum.get((c, q), 0.0)
            result[iid][anchor_month] = target_value
    return result


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def indicator_trends(request, indicator_id: int):
    months = int(request.query_params.get('months', 12))
    months = max(1, min(months, 36))
    org_id = request.query_params.get('organization')
    coordinator_id = request.query_params.get('coordinator')
    project_param = request.query_params.get('project')
    date_from = request.query_params.get('date_from')
    date_to = request.query_params.get('date_to')

    user = request.user
    aggregates = Aggregate.objects.filter(indicator_id=indicator_id, status='approved')
    # Isolate Sesigo Live System / Training Mode trend data.
    aggregates = apply_training_filter(aggregates, request, project_lookup='project')
    parsed_org_id = _safe_parse_int(org_id) if org_id not in (None, "") else None
    parsed_coordinator_id = _safe_parse_int(coordinator_id) if coordinator_id not in (None, "") else None
    parsed_project_id = _safe_parse_int(project_param) if project_param not in (None, "") else None
    if org_id not in (None, "") and parsed_org_id is None:
        return Response({'detail': 'organization must be a valid numeric id.'}, status=400)
    if coordinator_id not in (None, "") and parsed_coordinator_id is None:
        return Response({'detail': 'coordinator must be a valid numeric id.'}, status=400)
    if project_param not in (None, "") and parsed_project_id is None:
        return Response({'detail': 'project must be a valid numeric id.'}, status=400)

    requested_org_scope = None
    if parsed_coordinator_id is not None:
        requested_org_scope = _organization_scope_with_descendants(parsed_coordinator_id, project_id=parsed_project_id)
    if parsed_org_id is not None:
        organization_scope = _organization_scope_with_descendants(parsed_org_id, project_id=parsed_project_id)
        requested_org_scope = (
            organization_scope
            if requested_org_scope is None
            else requested_org_scope.intersection(organization_scope)
        )
    if requested_org_scope is not None:
        if len(requested_org_scope) == 0:
            return Response({
                'data': [],
                'trend': 'stable',
                'forecast': 0,
            })
        aggregates = aggregates.filter(organization_id__in=requested_org_scope)

    if parsed_project_id is not None:
        aggregates = aggregates.filter(project_id=parsed_project_id)
    if date_from:
        aggregates = aggregates.filter(period_start__gte=date_from)
    if date_to:
        aggregates = aggregates.filter(period_end__lte=date_to)
    aggregates = _restrict_aggregates_to_user_scope(aggregates, user)

    if date_from and date_to:
        start = _safe_parse_date(date_from)
        end = _safe_parse_date(date_to)
        if not start or not end:
            return Response({'detail': 'Invalid date_from/date_to. Expected YYYY-MM-DD.'}, status=400)
        if start > end:
            return Response({'detail': 'date_from must be before date_to.'}, status=400)
        month_starts = _month_range(start, end)
    else:
        base = timezone.now().date().replace(day=1)
        month_starts = [_month_start(base, offset) for offset in reversed(range(months))]
    totals = {month_start: 0.0 for month_start in month_starts}
    earliest = month_starts[0]

    for agg in aggregates.filter(period_start__gte=earliest):
        month_start = agg.period_start.replace(day=1)
        if month_start in totals:
            totals[month_start] += _extract_total(agg.value)

    trend_targets = compute_trend_targets(
        [indicator_id], month_starts,
        project_id=parsed_project_id, org_scope=requested_org_scope, request=request,
    ).get(indicator_id, {})

    data = [
        {
            'month': month_start.strftime('%b %Y'),
            'value': totals[month_start],
            'target': trend_targets.get(month_start, 0.0),
        }
        for month_start in month_starts
    ]

    return Response({
        'data': data,
        'trend': 'stable',
        'forecast': data[-1]['value'] if data else 0,
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def indicator_trends_bulk(request):
    ids_param = request.query_params.get('indicator_ids', '')
    indicator_ids = [int(value) for value in ids_param.split(',') if value.strip().isdigit()]
    if not indicator_ids:
        return Response({'series': []})

    months = int(request.query_params.get('months', 12))
    months = max(1, min(months, 36))
    org_id = request.query_params.get('organization')
    coordinator_id = request.query_params.get('coordinator')
    project_param = request.query_params.get('project')
    date_from = request.query_params.get('date_from')
    date_to = request.query_params.get('date_to')

    user = request.user
    # AN-1: if a requested indicator is canonical, also pull aggregates stranded
    # on its deprecated duplicates so the trend reflects the full metric. Data
    # is attributed back to the requested (canonical) id; series shape unchanged.
    requested_set = set(indicator_ids)
    variant_ids = list(
        Indicator.objects.filter(canonical_indicator_id__in=requested_set)
        .values_list('id', flat=True)
    )
    variant_to_canonical = dict(
        Indicator.objects.filter(canonical_indicator_id__in=requested_set)
        .values_list('id', 'canonical_indicator_id')
    )
    source_ids = list(requested_set.union(variant_ids))
    aggregates = Aggregate.objects.filter(indicator_id__in=source_ids, status='approved')
    # Isolate Sesigo Live System / Training Mode trend data.
    aggregates = apply_training_filter(aggregates, request, project_lookup='project')
    parsed_org_id = _safe_parse_int(org_id) if org_id not in (None, "") else None
    parsed_coordinator_id = _safe_parse_int(coordinator_id) if coordinator_id not in (None, "") else None
    parsed_project_id = _safe_parse_int(project_param) if project_param not in (None, "") else None
    if org_id not in (None, "") and parsed_org_id is None:
        return Response({'detail': 'organization must be a valid numeric id.'}, status=400)
    if coordinator_id not in (None, "") and parsed_coordinator_id is None:
        return Response({'detail': 'coordinator must be a valid numeric id.'}, status=400)
    if project_param not in (None, "") and parsed_project_id is None:
        return Response({'detail': 'project must be a valid numeric id.'}, status=400)

    requested_org_scope = None
    if parsed_coordinator_id is not None:
        requested_org_scope = _organization_scope_with_descendants(parsed_coordinator_id, project_id=parsed_project_id)
    if parsed_org_id is not None:
        organization_scope = _organization_scope_with_descendants(parsed_org_id, project_id=parsed_project_id)
        requested_org_scope = (
            organization_scope
            if requested_org_scope is None
            else requested_org_scope.intersection(organization_scope)
        )
    if requested_org_scope is not None:
        if len(requested_org_scope) == 0:
            return Response({'series': []})
        aggregates = aggregates.filter(organization_id__in=requested_org_scope)

    if parsed_project_id is not None:
        aggregates = aggregates.filter(project_id=parsed_project_id)
    if date_from:
        aggregates = aggregates.filter(period_start__gte=date_from)
    if date_to:
        aggregates = aggregates.filter(period_end__lte=date_to)
    aggregates = _restrict_aggregates_to_user_scope(aggregates, user)

    if date_from and date_to:
        start = _safe_parse_date(date_from)
        end = _safe_parse_date(date_to)
        if not start or not end:
            return Response({'detail': 'Invalid date_from/date_to. Expected YYYY-MM-DD.'}, status=400)
        if start > end:
            return Response({'detail': 'date_from must be before date_to.'}, status=400)
        month_starts = _month_range(start, end)
    else:
        base = timezone.now().date().replace(day=1)
        month_starts = [_month_start(base, offset) for offset in reversed(range(months))]

    earliest = month_starts[0]
    totals_by_indicator = {
        indicator_id: {month_start: 0.0 for month_start in month_starts}
        for indicator_id in indicator_ids
    }

    for agg in aggregates.filter(period_start__gte=earliest):
        month_start = agg.period_start.replace(day=1)
        # Attribute a deprecated variant's data to its canonical (requested) id.
        target_id = variant_to_canonical.get(agg.indicator_id, agg.indicator_id)
        indicator_totals = totals_by_indicator.get(target_id)
        if indicator_totals is not None and month_start in indicator_totals:
            indicator_totals[month_start] += _extract_total(agg.value)

    indicator_lookup = {
        indicator.id: indicator.name
        for indicator in Indicator.objects.filter(id__in=indicator_ids)
    }

    # Effective Target per (indicator, month), quarter-aligned. Fixed => configured
    # POT targets; derived/percentage => source achieved (× percent) at read time.
    trend_targets = compute_trend_targets(
        indicator_ids, month_starts,
        project_id=parsed_project_id, org_scope=requested_org_scope, request=request,
    )

    series = []
    for indicator_id in indicator_ids:
        totals = totals_by_indicator.get(indicator_id, {})
        targets = trend_targets.get(indicator_id, {})
        data = [
            {
                'month': month_start.strftime('%b %Y'),
                'value': totals.get(month_start, 0.0),
                'target': targets.get(month_start, 0.0),
            }
            for month_start in month_starts
        ]
        series.append({
            'indicator_id': indicator_id,
            'indicator_name': indicator_lookup.get(indicator_id, f'Indicator {indicator_id}'),
            'data': data,
        })

    return Response({
        'series': series,
    })




class CoordinatorTargetPagination(PageNumberPagination):
    """Honour a client-supplied page_size so the targets page can fetch the full
    set (e.g. to build the coordinator/indicator filter dropdowns)."""
    page_size = 20
    page_size_query_param = 'page_size'
    max_page_size = 2000


class CoordinatorTargetViewSet(viewsets.ModelViewSet):
    """Coordinator target CRUD API backed by the live coordinator target table."""

    queryset = CoordinatorTarget.objects.select_related('project', 'coordinator', 'indicator').all()
    serializer_class = CoordinatorTargetSerializer
    required_module = 'targets'
    permission_classes = [IsAuthenticated, HasModulePermission]
    pagination_class = CoordinatorTargetPagination
    filter_backends = [SearchFilter, OrderingFilter]
    search_fields = ['project__name', 'coordinator__name', 'indicator__name', 'notes']
    ordering_fields = ['year', 'quarter', 'target_value', 'updated_at', 'created_at']
    ordering = ['-updated_at']

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context['target_actuals'] = getattr(self, '_target_actuals', {})
        return context

    @staticmethod
    def _collapse_deprecated_twins(queryset):
        """Display-only de-duplication: collapse a deprecated indicator twin and its
        canonical into ONE row per (coordinator, project, canonical indicator, year,
        quarter), preferring the canonical (non-deprecated) row. Rows that exist only
        on a deprecated indicator (orphans) are kept and shown under their canonical.
        Removes NO data — purely a listing concern (targets stay in the DB, editable).
        Preserves the queryset ordering.
        """
        rows = list(queryset.select_related('indicator'))
        best = {}
        for r in rows:
            canon = r.indicator.canonical_id if r.indicator_id else r.indicator_id
            key = (r.coordinator_id, r.project_id, canon, r.year, r.quarter)
            current = best.get(key)
            if current is None:
                best[key] = r
                continue
            cur_dep = bool(current.indicator and current.indicator.is_deprecated)
            new_dep = bool(r.indicator and r.indicator.is_deprecated)
            if cur_dep and not new_dep:
                best[key] = r            # prefer the canonical (non-deprecated) row
            elif cur_dep == new_dep and r.id < current.id:
                best[key] = r            # deterministic tiebreak
        chosen_ids = {r.id for r in best.values()}
        return [r for r in rows if r.id in chosen_ids]

    def list(self, request, *args, **kwargs):
        queryset = self.filter_queryset(self.get_queryset())
        collapsed = self._collapse_deprecated_twins(queryset)
        page = self.paginate_queryset(collapsed)
        targets = page if page is not None else collapsed
        # Single certified server-side rollup (analysis.services.coordinator_rollups)
        # — the same engine that backs retrieve(), export(), and any future API.
        self._target_actuals = get_coordinator_performance(targets)
        serializer = self.get_serializer(targets, many=True)
        if page is not None:
            return self.get_paginated_response(serializer.data)
        return Response(serializer.data)

    def retrieve(self, request, *args, **kwargs):
        instance = self.get_object()
        self._target_actuals = get_coordinator_performance([instance])
        serializer = self.get_serializer(instance)
        return Response(serializer.data)

    def get_queryset(self):
        qs = self.queryset
        qs = apply_training_filter(qs, self.request, project_lookup='project')
        user = self.request.user
        if not (user.is_superuser or user.is_staff or getattr(user, 'role', None) == 'admin'):
            # Project-assignment gate first: only targets for assigned projects.
            qs = filter_queryset_by_assigned_projects(qs, user, 'project_id')
            if getattr(user, 'organization', None):
                qs = qs.filter(
                    models.Q(coordinator=user.organization) |
                    models.Q(coordinator__parent=user.organization) |
                    models.Q(project__organizations=user.organization)
                ).distinct()
            else:
                return qs.none()

        params = self.request.query_params

        def _val(key):
            # Ignore empty/"all" sentinels so they never filter to nothing.
            v = (params.get(key) or '').strip()
            return v if v and v.lower() != 'all' else None

        if _val('project_id'):
            qs = qs.filter(project_id=_val('project_id'))
        if _val('coordinator_id'):
            qs = qs.filter(coordinator_id=_val('coordinator_id'))
        if _val('indicator_id'):
            qs = qs.filter(indicator_id=_val('indicator_id'))
        if _val('year'):
            qs = qs.filter(year=_val('year'))
        if _val('quarter'):
            qs = qs.filter(quarter=_val('quarter'))
        if params.get('is_active') in {'true', 'false'}:
            qs = qs.filter(is_active=(params.get('is_active') == 'true'))
        return qs

    @action(detail=False, methods=['get'])
    def coordinators(self, request):
        """Return the project's coordinator organizations, per the project
        hierarchy (ProjectOrganization.is_coordinator). The targets filter uses
        this to list only actual coordinators, not every organization that
        happens to have a coordinator target assigned to it."""
        from projects.models import ProjectOrganization

        project_id = (request.query_params.get('project_id') or '').strip()
        if not project_id or project_id.lower() == 'all':
            return Response([])

        rows = ProjectOrganization.objects.filter(
            project_id=project_id,
            is_coordinator=True,
            is_active=True,
        )

        # Same project-assignment gate as the target list: non-admins only see
        # coordinators for projects they are assigned to.
        user = request.user
        if not (user.is_superuser or user.is_staff or getattr(user, 'role', None) == 'admin'):
            rows = filter_queryset_by_assigned_projects(rows, user, 'project_id')

        rows = rows.select_related('organization').order_by('organization__name')
        seen = set()
        coordinators = []
        for row in rows:
            org = row.organization
            if not org or org.id in seen:
                continue
            seen.add(org.id)
            coordinators.append({'id': str(org.id), 'name': org.name or f'Coordinator {org.id}'})
        return Response(coordinators)

    @action(detail=False, methods=['get'], url_path='dependency-check')
    def dependency_check(self, request):
        """Report the derived-target dependency graph for a project and flag any
        circular dependency so admins are warned immediately."""
        project_id = (request.query_params.get('project_id') or '').strip()
        if not project_id or project_id.lower() == 'all':
            return Response({'detail': 'project_id is required.'}, status=status.HTTP_400_BAD_REQUEST)
        from analysis.services.target_dependencies import project_dependency_report
        return Response(project_dependency_report(project_id))

    def _project_coordinator_ids(self, project_id):
        """The org ids that are coordinators in this project (project hierarchy
        role, ProjectOrganization.is_coordinator)."""
        from projects.models import ProjectOrganization

        return set(
            ProjectOrganization.objects.filter(
                project_id=project_id,
                is_coordinator=True,
                is_active=True,
            ).values_list('organization_id', flat=True)
        )

    def _is_rollup_request(self):
        """True when the caller is viewing "All coordinators" within a single
        project (project set, no specific coordinator) — the on-screen state
        that collapses to one row per indicator."""
        params = self.request.query_params
        project_id = (params.get('project_id') or '').strip()
        coordinator_id = (params.get('coordinator_id') or '').strip().lower()
        return bool(project_id) and project_id.lower() != 'all' and coordinator_id in ('', 'all')

    def _coordinator_rollup_rows(self):
        """Per-indicator rollup rows across the project's coordinators.

        Collapse every coordinator's targets into one row per (indicator, year,
        quarter), summing the configured targets and the certified server-side
        actuals across the project's coordinators (project hierarchy).
        Coordinator subtrees are disjoint by construction, so summing does not
        double-count. Each coordinator appears as a contribution entry on the
        rolled-up row. Shared by the ``rollup`` action and the CSV export so the
        two can never disagree.
        """
        project_id = (self.request.query_params.get('project_id') or '').strip()
        if not project_id or project_id.lower() == 'all':
            return []

        coordinator_ids = self._project_coordinator_ids(project_id)
        if not coordinator_ids:
            return []

        # Reuse the scoped/training/permission-filtered queryset, then narrow to
        # this project's coordinators only.
        qs = self.filter_queryset(self.get_queryset()).filter(coordinator_id__in=coordinator_ids)
        qs = qs.select_related('project', 'coordinator', 'indicator')

        # Collapse deprecated twins per (coordinator, canonical indicator, year,
        # quarter) so a coordinator's target isn't summed twice into the canonical
        # rollup row. Display de-duplication only — no data changed.
        targets = self._collapse_deprecated_twins(qs)
        actuals = get_coordinator_performance(targets)

        groups = {}
        order = []
        for target in targets:
            # Group on the CANONICAL indicator so a deprecated twin doesn't produce
            # a second rollup row (display de-duplication; no data changed).
            canonical_id = target.indicator.canonical_id if target.indicator_id else target.indicator_id
            canonical_meta = target.indicator.canonical_or_self if target.indicator_id else None
            key = (canonical_id, target.year, target.quarter)
            if key not in groups:
                groups[key] = {
                    'indicator_id': canonical_id,
                    'indicator_name': (getattr(canonical_meta, 'name', None)
                                       or getattr(target.indicator, 'name', None)
                                       or f'Indicator {canonical_id}'),
                    'project_id': target.project_id,
                    'project_name': getattr(target.project, 'name', None) or f'Project {target.project_id}',
                    'year': target.year,
                    'quarter': target.quarter,
                    'target_value': 0.0,
                    'actual_value': 0.0,
                    'own_actual_value': 0.0,
                    'contributions': [],
                }
                order.append(key)
            g = groups[key]
            perf = actuals.get(target.id, {})
            # Use the EFFECTIVE target (derived/percentage resolved at runtime),
            # not the stored configured value. None = pending source => contributes 0.
            effective_target = perf.get('target_value')
            g['target_value'] += float(effective_target) if effective_target is not None else 0.0
            g['actual_value'] += float(perf.get('actual_value', 0.0) or 0.0)
            g['own_actual_value'] += float(perf.get('own_actual_value', 0.0) or 0.0)
            g['contributions'].append({
                'organization_id': target.coordinator_id,
                'organization_name': getattr(target.coordinator, 'name', None) or f'Coordinator {target.coordinator_id}',
                'actual_value': float(perf.get('actual_value', 0.0) or 0.0),
            })

        results = []
        for key in order:
            g = groups[key]
            target_value = g['target_value']
            actual_value = g['actual_value']
            own_value = g['own_actual_value']
            achievement = (actual_value / target_value * 100) if target_value > 0 else None
            contributions = sorted(g['contributions'], key=lambda row: row['actual_value'], reverse=True)
            for entry in contributions:
                entry['share_percent'] = (entry['actual_value'] / actual_value * 100) if actual_value > 0 else 0.0
            results.append({
                'id': f"rollup-{g['indicator_id']}-{g['year']}-{g['quarter']}",
                'project_id': g['project_id'],
                'project_name': g['project_name'],
                'coordinator_id': None,
                'coordinator_name': 'All coordinators',
                'indicator_id': g['indicator_id'],
                'indicator_name': g['indicator_name'],
                'year': g['year'],
                'quarter': g['quarter'],
                'target_value': target_value,
                'is_active': True,
                'own_actual_value': own_value,
                'own_contribution': own_value,
                'subgrantee_contribution': actual_value - own_value,
                'actual_value': actual_value,
                'achievement_percent': achievement,
                'variance': actual_value - target_value,
                'performance_status': coordinator_performance_status(target_value, achievement),
                'child_contributions': contributions,
            })

        return results

    @action(detail=False, methods=['get'])
    def rollup(self, request):
        """Per-indicator rollup across the project's coordinators (the "All
        coordinators" view). See ``_coordinator_rollup_rows`` for the mechanics."""
        results = self._coordinator_rollup_rows()
        return Response({'count': len(results), 'next': None, 'previous': None, 'results': results})

    @action(detail=False, methods=['get'])
    def options(self, request):
        """Distinct indicators + coordinators (id + name) that have a target
        under the scoped filters — used to populate the filter/dialog dropdowns.

        This deliberately avoids the full list endpoint's per-row rollup-actuals
        computation + heavy serialization, which is the page's slowest call. One
        flat ``values_list`` query, no actuals.
        """
        qs = self.filter_queryset(self.get_queryset())
        indicators: dict[int, str] = {}
        coordinators: dict[int, str] = {}
        for indicator_id, indicator_name, coordinator_id, coordinator_name in qs.values_list(
            'indicator_id', 'indicator__name', 'coordinator_id', 'coordinator__name'
        ):
            if indicator_id and indicator_id not in indicators:
                indicators[indicator_id] = indicator_name or f'Indicator {indicator_id}'
            if coordinator_id and coordinator_id not in coordinators:
                coordinators[coordinator_id] = coordinator_name or f'Coordinator {coordinator_id}'
        return Response({
            'indicators': [{'id': str(k), 'name': v} for k, v in indicators.items()],
            'coordinators': [{'id': str(k), 'name': v} for k, v in coordinators.items()],
        })

    def _allowed_org_ids_for_user(self):
        if is_organization_admin(self.request.user):
            return None
        return set(get_user_organization_ids(self.request.user) or [])

    def _assert_can_write_target(self, *, project: Project, coordinator: Organization):
        allowed_org_ids = self._allowed_org_ids_for_user()
        if allowed_org_ids is None:
            return

        if not coordinator or coordinator.id not in allowed_org_ids:
            raise PermissionDenied('You do not have permission to manage targets for this coordinator.')

        project_org_ids = set(project.organizations.values_list('id', flat=True))
        if project_org_ids and not project_org_ids.intersection(allowed_org_ids):
            raise PermissionDenied('You do not have permission to manage targets for this project.')

        if project_org_ids and coordinator.id not in project_org_ids:
            ancestor_ids = {ancestor.id for ancestor in coordinator.get_ancestors()}
            if not project_org_ids.intersection(ancestor_ids):
                raise PermissionDenied('Selected coordinator is not within the selected project scope.')

    def _audit_target(self, action, target, *, description):
        record_audit_event(
            action=action,
            request=self.request,
            object_type='coordinator_target',
            object_id=target.id,
            organization=getattr(target, 'coordinator', None),
            project=getattr(target, 'project', None),
            description=description,
            metadata={
                'indicator_id': target.indicator_id,
                'year': target.year,
                'quarter': target.quarter,
                'target_value': str(target.target_value),
            },
        )

    def perform_create(self, serializer):
        project = serializer.validated_data.get('project')
        coordinator = serializer.validated_data.get('coordinator')
        self._assert_can_write_target(project=project, coordinator=coordinator)
        target = serializer.save()
        self._audit_target('create', target, description=f'Coordinator target {target.id} created.')

    def perform_update(self, serializer):
        project = serializer.validated_data.get('project', serializer.instance.project)
        coordinator = serializer.validated_data.get('coordinator', serializer.instance.coordinator)
        self._assert_can_write_target(project=project, coordinator=coordinator)
        target = serializer.save()
        self._audit_target('update', target, description=f'Coordinator target {target.id} updated.')

    def perform_destroy(self, instance):
        # Authorise the same way as create/update before removing the row.
        self._assert_can_write_target(project=instance.project, coordinator=instance.coordinator)
        target_id = instance.id
        self._audit_target('delete', instance, description=f'Coordinator target {target_id} deleted.')
        instance.delete()

    @action(detail=False, methods=['post'], url_path='bulk-assign')
    def bulk_assign(self, request):
        project_id = request.data.get('project_id')
        coordinator_ids = request.data.get('coordinator_ids') or []
        indicator_ids = request.data.get('indicator_ids') or []
        year = request.data.get('year')
        quarter = request.data.get('quarter')
        target_value = request.data.get('target_value', 0)
        notes = request.data.get('notes')
        is_active = request.data.get('is_active', True)

        if not project_id or not coordinator_ids or not indicator_ids or not year or not quarter:
            return Response({'detail': 'project_id, coordinator_ids, indicator_ids, year, and quarter are required.'}, status=400)
        if quarter not in {'Q1', 'Q2', 'Q3', 'Q4'}:
            return Response({'detail': 'quarter must be one of Q1, Q2, Q3, or Q4.'}, status=400)

        year_value = _safe_parse_int(year)
        if year_value is None:
            return Response({'detail': 'year must be a valid integer.'}, status=400)

        is_active_value = str(is_active).strip().lower() not in {'false', '0', 'no', 'off', ''}

        project_id_value = _safe_parse_int(project_id)
        if project_id_value is None:
            return Response({'detail': 'project_id must be a valid integer.'}, status=400)

        coordinator_id_values = []
        for raw in coordinator_ids:
            value = _safe_parse_int(raw)
            if value is None:
                return Response({'detail': 'coordinator_ids must contain valid integers.'}, status=400)
            coordinator_id_values.append(value)

        indicator_id_values = []
        for raw in indicator_ids:
            value = _safe_parse_int(raw)
            if value is None:
                return Response({'detail': 'indicator_ids must contain valid integers.'}, status=400)
            indicator_id_values.append(value)

        project = Project.objects.filter(id=project_id_value).first()
        if not project:
            return Response({'detail': 'project_id must reference an existing project.'}, status=400)

        coordinator_map = {
            coordinator.id: coordinator
            for coordinator in Organization.objects.filter(id__in=coordinator_id_values)
        }
        if len(coordinator_map) != len(set(coordinator_id_values)):
            return Response({'detail': 'coordinator_ids contains one or more invalid organizations.'}, status=400)

        if Indicator.objects.filter(id__in=indicator_id_values).count() != len(set(indicator_id_values)):
            return Response({'detail': 'indicator_ids contains one or more invalid indicators.'}, status=400)

        for coordinator in coordinator_map.values():
            self._assert_can_write_target(project=project, coordinator=coordinator)

        created = 0
        updated = 0
        skipped = 0
        with transaction.atomic():
            for coordinator_id in coordinator_id_values:
                for indicator_id in indicator_id_values:
                    target, target_created = CoordinatorTarget.objects.get_or_create(
                        project_id=project_id_value,
                        coordinator_id=coordinator_id,
                        indicator_id=indicator_id,
                        year=year_value,
                        quarter=quarter,
                        defaults={
                            'target_value': target_value,
                            'notes': notes,
                            'is_active': is_active_value,
                        },
                    )
                    if target_created:
                        created += 1
                        continue

                    dirty = []
                    if str(target.target_value) != str(target_value):
                        target.target_value = target_value
                        dirty.append('target_value')
                    next_notes = notes if notes not in ('', None) else None
                    if (target.notes if target.notes not in ('', None) else None) != next_notes:
                        target.notes = next_notes
                        dirty.append('notes')
                    if bool(target.is_active) != bool(is_active_value):
                        target.is_active = is_active_value
                        dirty.append('is_active')

                    if dirty:
                        target.save(update_fields=dirty + ['updated_at'])
                        updated += 1
                    else:
                        skipped += 1

        record_audit_event(
            action='assign',
            request=request,
            object_type='coordinator_target',
            project=project,
            description=(
                f'Bulk-assigned coordinator targets for project {project.id}: '
                f'{created} created, {updated} updated, {skipped} skipped.'
            ),
            metadata={
                'project_id': project.id,
                'coordinator_ids': coordinator_id_values,
                'indicator_ids': indicator_id_values,
                'year': year_value,
                'quarter': quarter,
                'created': created,
                'updated': updated,
                'skipped': skipped,
            },
        )
        return Response({'created': created, 'updated': updated, 'skipped': skipped})

    @action(detail=False, methods=['get'], url_path='export')
    def export(self, request):
        """CSV export of coordinator performance.

        Export certification (readiness R3): values come from the SAME
        ``get_coordinator_performance`` engine and the SAME scoped queryset as
        the list endpoint, so an exported file can never disagree with the
        dashboard. No rollup math is duplicated here. When the caller is viewing
        "All coordinators" the file mirrors the on-screen per-indicator rollup.
        """
        response = HttpResponse(content_type='text/csv')
        response['Content-Disposition'] = 'attachment; filename="coordinator-targets.csv"'
        writer = csv.writer(response)
        writer.writerow([
            'project', 'coordinator', 'indicator', 'year', 'quarter',
            'target_value', 'actual_value', 'own_contribution',
            'subgrantee_contribution', 'achievement_percent', 'performance_status',
        ])

        if self._is_rollup_request():
            rows = self._coordinator_rollup_rows()
            for row in rows:
                achievement = row.get('achievement_percent')
                writer.writerow([
                    row.get('project_name', ''),
                    row.get('coordinator_name', 'All coordinators'),
                    row.get('indicator_name', ''),
                    row.get('year', ''),
                    row.get('quarter', ''),
                    row.get('target_value', 0.0),
                    row.get('actual_value', 0.0),
                    row.get('own_contribution', 0.0),
                    row.get('subgrantee_contribution', 0.0),
                    '' if achievement is None else round(achievement, 2),
                    row.get('performance_status', 'no_target'),
                ])
            record_audit_event(
                action='export',
                request=request,
                object_type='coordinator_target',
                description=f'Exported {len(rows)} coordinator rollup row(s) to CSV.',
                metadata={'count': len(rows), 'mode': 'rollup'},
            )
            return response

        queryset = self.filter_queryset(self.get_queryset())
        targets = self._collapse_deprecated_twins(queryset)
        actuals = get_coordinator_performance(targets)
        for target in targets:
            payload = actuals.get(target.id, {})
            achievement = payload.get('achievement_percent')
            writer.writerow([
                target.project.name if target.project_id else '',
                target.coordinator.name if target.coordinator_id else '',
                target.indicator.name if target.indicator_id else '',
                target.year,
                target.quarter,
                target.target_value,
                payload.get('actual_value', 0.0),
                payload.get('own_contribution', 0.0),
                payload.get('subgrantee_contribution', 0.0),
                '' if achievement is None else round(achievement, 2),
                payload.get('performance_status', 'no_target'),
            ])

        record_audit_event(
            action='export',
            request=request,
            object_type='coordinator_target',
            description=f'Exported {len(targets)} coordinator target(s) to CSV.',
            metadata={'count': len(targets)},
        )
        return response

    @action(detail=False, methods=['get'], url_path='export-targets')
    def export_targets(self, request):
        """Pivoted CSV of assigned indicators with their quarterly targets:
        one row per indicator, columns Q1..Q4. Respects the current filters
        (project, coordinator, indicator, year). A Coordinator/Year column is
        added only when that filter isn't pinned, so the file stays unambiguous.
        Deprecated indicator twins are collapsed onto their canonical.
        """
        params = request.query_params
        single_coord = bool((params.get('coordinator_id') or '').strip() and params.get('coordinator_id') != 'all')
        single_year = bool((params.get('year') or '').strip() and params.get('year') != 'all')

        targets = self._collapse_deprecated_twins(self.filter_queryset(self.get_queryset()))
        pivot: dict = {}
        for t in targets:
            canonical = t.indicator.canonical_or_self if t.indicator_id else None
            canon_id = canonical.id if canonical else t.indicator_id
            key = (t.coordinator_id, canon_id, t.year)
            row = pivot.setdefault(key, {
                'coordinator': t.coordinator.name if t.coordinator_id else '',
                'indicator': (canonical.name if canonical else '') or f'Indicator {canon_id}',
                'year': t.year,
                'Q1': '', 'Q2': '', 'Q3': '', 'Q4': '',
            })
            if t.quarter in ('Q1', 'Q2', 'Q3', 'Q4'):
                row[t.quarter] = t.target_value

        header = []
        if not single_coord:
            header.append('coordinator')
        header.append('indicator')
        if not single_year:
            header.append('year')
        header += ['Q1', 'Q2', 'Q3', 'Q4']

        response = HttpResponse(content_type='text/csv')
        response['Content-Disposition'] = 'attachment; filename="assigned-indicator-targets.csv"'
        writer = csv.writer(response)
        writer.writerow(header)
        for _key, row in sorted(pivot.items(), key=lambda kv: (kv[1]['coordinator'], kv[1]['indicator'], kv[1]['year'])):
            writer.writerow([row[col] for col in header])

        record_audit_event(
            action='export', request=request, object_type='coordinator_target',
            description=f'Exported {len(pivot)} assigned-indicator target row(s) (pivoted Q1-Q4).',
            metadata={'count': len(pivot), 'mode': 'indicator_quarters'},
        )
        return response


class ReportViewSet(viewsets.ModelViewSet):
    """ViewSet for managing reports."""
    
    queryset = Report.objects.all()
    serializer_class = ReportSerializer
    required_module = 'reports'
    permission_classes = [IsAuthenticated, HasModulePermission]
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ['report_type', 'organization', 'is_public']
    search_fields = ['name', 'description']
    ordering = ['-created_at']
    
    def get_queryset(self):
        from organizations.access import apply_mode_field_filter
        user = self.request.user
        # Environment isolation first: live never shows training reports and
        # vice versa (admin include_training opt-in shows all).
        base = apply_mode_field_filter(Report.objects.all(), self.request)
        if is_organization_admin(user):
            return base
        org_ids = get_user_organization_ids(user)
        return base.filter(
            models.Q(organization_id__in=org_ids) |
            models.Q(is_public=True) |
            models.Q(created_by=user)
        )

    def perform_create(self, serializer):
        from organizations.access import request_mode_value
        serializer.save(created_by=self.request.user, mode=request_mode_value(self.request))

    @action(detail=False, methods=['get', 'post'], url_path='home')
    def home(self, request):
        """Get-or-create the per-organization "home" dashboard.

        The home dashboard is a normal Report marked with parameters.is_home=True
        and shared (is_public) within its organization, so any member of that org
        sees the same charts and can edit them (add/remove charts via the existing
        saveChart/removeChart -> update path). Charts built in the Analysis
        Visualizer are shared to the home page by saving onto this Report.
        """
        org_id = request.query_params.get('organization') or request.data.get('organization')
        if not org_id:
            user_org_ids = list(get_user_organization_ids(request.user) or [])
            org_id = user_org_ids[0] if user_org_ids else None
        if not org_id:
            return Response(
                {'detail': 'No organization in scope for a home dashboard.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Restrict to organizations the requester can actually see, mirroring
        # get_queryset scoping (admins see all).
        if not is_organization_admin(request.user):
            allowed = set(get_user_organization_ids(request.user) or [])
            if int(org_id) not in allowed:
                raise PermissionDenied('You do not have access to this organization.')

        from organizations.access import request_mode_value
        mode = request_mode_value(request)
        # Keep live and training home dashboards separate per organization.
        report = (
            Report.objects.filter(organization_id=org_id, parameters__is_home=True, mode=mode)
            .order_by('id')
            .first()
        )
        if report is None:
            org = Organization.objects.filter(id=org_id).first()
            report = Report.objects.create(
                name=f"{org.name} Home Dashboard" if org else "Home Dashboard",
                report_type='dashboard',
                organization_id=org_id,
                is_public=True,
                parameters={'is_home': True, 'charts': []},
                created_by=request.user,
                mode=mode,
            )
        return Response(ReportSerializer(report).data)

    @action(detail=True, methods=['post'])
    def generate(self, request, pk=None):
        """Generate/refresh report data."""
        report = self.get_object()

        params = report.parameters or {}
        project_id = params.get('project_id') or params.get('project')
        organization_id = params.get('organization_id') or params.get('organization')
        indicator_ids = params.get('indicator_ids') or params.get('indicators') or []
        date_from = params.get('date_from')
        date_to = params.get('date_to')

        aggregates = Aggregate.objects.all()
        if project_id:
            aggregates = aggregates.filter(project_id=project_id)
        if organization_id:
            aggregates = aggregates.filter(organization_id=organization_id)
        if indicator_ids:
            aggregates = aggregates.filter(indicator_id__in=indicator_ids)
        if date_from:
            aggregates = aggregates.filter(period_start__gte=date_from)
        if date_to:
            aggregates = aggregates.filter(period_end__lte=date_to)

        aggregates = _restrict_aggregates_to_user_scope(aggregates, request.user)
        aggregates = _approved_aggregates_only(aggregates, request)
        aggregates = apply_training_filter(aggregates, request, project_lookup="project")

        cached_rows = []
        canon_id_for, canon_meta_for = _canonical_indicator_resolver()
        if report.report_type == 'indicator':
            totals = {}
            for agg in aggregates.select_related('indicator'):
                # AN-1: roll duplicate indicators up to their canonical row so a
                # single metric is not split across AUTO_/NAHPA/SC duplicates.
                canon_id = canon_id_for(agg.indicator_id)
                meta = canon_meta_for(canon_id)
                row = totals.setdefault(
                    canon_id,
                    {
                        'indicator_id': canon_id,
                        'indicator_code': meta['indicator_code'],
                        'indicator_name': meta['indicator_name'],
                        'total_value': 0.0,
                        'entries': 0,
                    },
                )
                row['total_value'] += _extract_total(agg.value)
                row['entries'] += 1
            cached_rows = sorted(totals.values(), key=lambda item: item['total_value'], reverse=True)
        elif report.report_type == 'project':
            totals = {}
            for agg in aggregates.select_related('project'):
                row = totals.setdefault(
                    agg.project_id,
                    {
                        'project_id': agg.project_id,
                        'project_name': agg.project.name,
                        'total_value': 0.0,
                        'entries': 0,
                    },
                )
                row['total_value'] += _extract_total(agg.value)
                row['entries'] += 1
            cached_rows = sorted(totals.values(), key=lambda item: item['total_value'], reverse=True)
        else:
            # Default "custom" report is a raw aggregate export based on parameters.
            for agg in aggregates.select_related('indicator', 'project', 'organization'):
                canon_id = canon_id_for(agg.indicator_id)
                meta = canon_meta_for(canon_id)
                cached_rows.append({
                    'indicator_id': canon_id,
                    'indicator_code': meta['indicator_code'],
                    'indicator_name': meta['indicator_name'],
                    'project_id': agg.project_id,
                    'project_name': agg.project.name,
                    'organization_id': agg.organization_id,
                    'organization_name': agg.organization.name,
                    'period_start': agg.period_start.isoformat(),
                    'period_end': agg.period_end.isoformat(),
                    'value': _extract_total(agg.value),
                })
            cached_rows = cached_rows

        report.cached_data = cached_rows
        report.last_generated = timezone.now()
        report.save(update_fields=['cached_data', 'last_generated', 'updated_at'])
        return Response(ReportSerializer(report).data)
    
    @action(detail=True, methods=['get'])
    def download(self, request, pk=None):
        """Download report as CSV/XLSX."""
        report = self.get_object()

        export_format = (request.query_params.get('format') or (report.parameters or {}).get('format') or 'csv')
        export_format = str(export_format).lower()

        safe_name = slugify(report.name) or f'report-{report.id}'

        cached_data = report.cached_data if isinstance(report.cached_data, list) else []
        if not cached_data:
            cached_data = []

        if export_format in ('excel', 'xlsx'):
            try:
                from openpyxl import Workbook
            except ImportError:
                export_format = 'csv'
            else:
                workbook = Workbook()
                sheet = workbook.active
                sheet.title = 'Report'

                if cached_data:
                    headers = list(cached_data[0].keys())
                    sheet.append(headers)
                    for row in cached_data:
                        values = []
                        for key in headers:
                            value = row.get(key)
                            if isinstance(value, (dict, list)):
                                value = json.dumps(value)
                            values.append(value)
                        sheet.append(values)
                else:
                    sheet.append(['No data'])

                output = BytesIO()
                workbook.save(output)
                output.seek(0)
                response = HttpResponse(
                    output.getvalue(),
                    content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                )
                response['Content-Disposition'] = f'attachment; filename=\"{safe_name}.xlsx\"'
                return response

        # Default: CSV
        response = HttpResponse(content_type='text/csv')
        response['Content-Disposition'] = f'attachment; filename=\"{safe_name}.csv\"'

        writer = csv.writer(response)
        if cached_data:
            headers = list(cached_data[0].keys())
            writer.writerow(headers)
            for row in cached_data:
                writer.writerow([row.get(key) for key in headers])
        else:
            writer.writerow(['No data'])

        return response


class SavedQueryViewSet(viewsets.ModelViewSet):
    """ViewSet for saved queries."""
    
    queryset = SavedQuery.objects.all()
    serializer_class = SavedQuerySerializer
    # Saved queries are part of the reports/analysis module; honour explicit
    # deny. (get_queryset already restricts to the requesting user's own rows.)
    required_module = 'reports'
    permission_classes = [IsAuthenticated, HasModulePermission]

    def get_queryset(self):
        from organizations.access import apply_mode_field_filter
        return apply_mode_field_filter(
            SavedQuery.objects.filter(user=self.request.user), self.request
        )

    def perform_create(self, serializer):
        from organizations.access import request_mode_value
        serializer.save(user=self.request.user, mode=request_mode_value(self.request))


class ScheduledReportViewSet(viewsets.ModelViewSet):
    """ViewSet for scheduled reports."""

    queryset = ScheduledReport.objects.all()
    serializer_class = ScheduledReportSerializer
    # Scheduled reports are part of the reports/analysis module; honour explicit
    # deny. (get_queryset already restricts non-admins to their own rows.)
    required_module = 'reports'
    permission_classes = [IsAuthenticated, HasModulePermission]
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ['frequency', 'is_active']
    search_fields = ['report_name', 'report_type']
    ordering = ['-created_at']

    def get_queryset(self):
        from organizations.access import apply_mode_field_filter
        user = self.request.user
        base = apply_mode_field_filter(ScheduledReport.objects.all(), self.request)
        if is_organization_admin(user):
            return base
        return base.filter(created_by=user)

    def perform_create(self, serializer):
        from organizations.access import request_mode_value
        data = serializer.validated_data
        next_run = data.get('next_run') or _next_run_for_frequency(data.get('frequency'))
        serializer.save(
            created_by=self.request.user, next_run=next_run,
            mode=request_mode_value(self.request),
        )


def _empty_overview_payload(*, selected_project_id=None, default_project_id=None, code=None):
    """Shared empty/no-data dashboard overview shape (keeps the response schema
    stable for the frontend). ``code='no_project'`` tells the frontend to show
    the "No assigned project" state."""
    payload = {
        'total_respondents': 0,
        'total_assessments': 0,
        'active_projects': 0,
        'total_indicators': 0,
        'indicators_behind': 0,
        'recent_activity': [],
        'selected_project_id': selected_project_id,
        'default_project_id': default_project_id,
    }
    if code:
        payload['code'] = code
        if code == 'no_project':
            payload['detail'] = 'No assigned project.'
    return payload


class DashboardView(viewsets.ViewSet):
    """Dashboard analytics endpoints."""

    permission_classes = [IsAuthenticated]

    def list(self, request):
        """Alias for /overview/ so the bare /api/analysis/dashboard/ URL returns useful data."""
        return self.overview(request)

    @action(detail=False, methods=['get'])
    def overview(self, request):
        """Get dashboard overview stats."""
        from respondents.models import Respondent, Interaction
        from projects.models import Project

        user = request.user
        project_param = request.query_params.get('project')
        coordinator_param = request.query_params.get('coordinator')
        organization_param = request.query_params.get('organization')
        date_from_param = request.query_params.get('date_from')
        date_to_param = request.query_params.get('date_to')

        project_id = _safe_parse_int(project_param) if project_param not in (None, "") else None
        coordinator_id = _safe_parse_int(coordinator_param) if coordinator_param not in (None, "") else None
        organization_id = _safe_parse_int(organization_param) if organization_param not in (None, "") else None

        if project_param not in (None, "") and project_id is None:
            return Response(
                {'detail': 'project must be a valid numeric id.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if coordinator_param not in (None, "") and coordinator_id is None:
            return Response(
                {'detail': 'coordinator must be a valid numeric id.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if organization_param not in (None, "") and organization_id is None:
            return Response(
                {'detail': 'organization must be a valid numeric id.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        date_from = _safe_parse_date(date_from_param) if date_from_param else None
        date_to = _safe_parse_date(date_to_param) if date_to_param else None
        if date_from_param and not date_from:
            return Response(
                {'detail': 'Invalid date_from. Expected YYYY-MM-DD.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if date_to_param and not date_to:
            return Response(
                {'detail': 'Invalid date_to. Expected YYYY-MM-DD.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if date_from and date_to and date_from > date_to:
            return Response(
                {'detail': 'date_from must be before date_to.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # The dashboard always operates within a single selected project. When
        # none is supplied we fall back to the user's default/current project.
        # Organization visibility is then resolved from the PROJECT HIERARCHY
        # (ProjectOrganizationHierarchy) + the user's project assignment — never
        # the global Organization.parent tree.
        include_training = is_training_only_request(request)
        resolved_default_project_id = get_default_project_id(user, include_training=include_training)
        if project_id is None:
            project_id = resolved_default_project_id
        if project_id is None:
            return Response(_empty_overview_payload(default_project_id=None, code='no_project'))

        project_obj = Project.objects.filter(id=project_id).first()
        if project_obj is None or not user_can_access_project(user, project_obj):
            return Response(_empty_overview_payload(
                selected_project_id=None,
                default_project_id=resolved_default_project_id,
                code='no_project',
            ))

        requested_org_ids = None
        if coordinator_id is not None:
            requested_org_ids = _organization_scope_with_descendants(coordinator_id, project_id=project_id)
        if organization_id is not None:
            organization_scope = _organization_scope_with_descendants(organization_id, project_id=project_id)
            requested_org_ids = (
                organization_scope
                if requested_org_ids is None
                else requested_org_ids.intersection(organization_scope)
            )

        if requested_org_ids is not None and len(requested_org_ids) == 0:
            return Response(_empty_overview_payload(
                selected_project_id=project_id,
                default_project_id=resolved_default_project_id,
            ))

        # Non-admin visibility comes from the project hierarchy + assignment,
        # NOT the global organization tree.
        user_scope_ids = None if is_organization_admin(user) else get_user_project_scope(user, project_obj)
        effective_org_ids = requested_org_ids
        if user_scope_ids is not None:
            effective_org_ids = (
                user_scope_ids
                if effective_org_ids is None
                else effective_org_ids.intersection(user_scope_ids)
            )
            if len(effective_org_ids) == 0:
                return Response(_empty_overview_payload(
                    selected_project_id=project_id,
                    default_project_id=resolved_default_project_id,
                ))

        # Build base querysets based on user role
        respondents = Respondent.objects.all()
        interactions = Interaction.objects.all()
        projects = Project.objects.all()

        # Isolate Sesigo Live System and Sesigo Training Mode dashboard data.
        interactions = apply_training_filter(interactions, request, project_lookup="project")
        projects = apply_training_filter_to_projects(projects, request)

        if effective_org_ids is not None:
            respondents = respondents.filter(organization_id__in=effective_org_ids)
            interactions = interactions.filter(respondent__organization_id__in=effective_org_ids)
            projects = projects.filter(organizations__id__in=effective_org_ids).distinct()

        if project_id is not None:
            projects = projects.filter(id=project_id)
            interactions = interactions.filter(project_id=project_id)

        if date_from:
            interactions = interactions.filter(date__gte=date_from)
        if date_to:
            interactions = interactions.filter(date__lte=date_to)

        if project_id is not None or date_from or date_to:
            respondent_ids = interactions.values_list('respondent_id', flat=True).distinct()
            respondents = respondents.filter(id__in=respondent_ids)
        else:
            # Isolate respondent counts by mode. Respondent has no direct project
            # FK, so training/live is derived from the respondent's interactions.
            # Live: drop respondents that appear in any training-project
            # interaction (keeps respondents with no interactions). Training:
            # keep only respondents seen in a training-project interaction.
            dashboard_mode = training_view_mode(request)
            if dashboard_mode != 'all':
                training_respondent_ids = (
                    Interaction.objects.filter(project__is_training=True)
                    .values_list('respondent_id', flat=True)
                    .distinct()
                )
                if dashboard_mode == 'training':
                    respondents = respondents.filter(id__in=training_respondent_ids)
                else:  # live
                    respondents = respondents.exclude(id__in=training_respondent_ids)

        indicators_behind = 0
        if project_id is not None:
            selected_project = projects.filter(id=project_id).first()
            if selected_project is not None:
                scope_indicator_ids = project_indicator_ids_for_organization_scope(
                    project=selected_project,
                    organization_ids=effective_org_ids,
                )
                total_indicators = len(scope_indicator_ids)
                # "Behind" = an indicator in scope whose synced achievement
                # (ProjectIndicator.current_value, kept in step with approved
                # aggregates) has not reached its project target. Only indicators
                # carrying a positive target are eligible — an unset target is not
                # "behind". current_value/target_value are project-wide rollups,
                # so this answers "of the indicators this scope reports on, how
                # many are behind at the project level".
                if scope_indicator_ids:
                    from projects.models import ProjectIndicator
                    indicators_behind = (
                        ProjectIndicator.objects.filter(
                            project_id=project_id,
                            indicator_id__in=scope_indicator_ids,
                            target_value__gt=0,
                            current_value__lt=F('target_value'),
                        ).count()
                    )
            else:
                total_indicators = 0
        else:
            indicators = Indicator.objects.filter(is_active=True)
            if effective_org_ids is not None:
                indicators = indicators.filter(organizations__id__in=effective_org_ids)
            # Isolate indicator counts by mode. Live: indicators tied to at least
            # one non-training project or to no project at all; Training: only
            # indicators tied to a training project.
            indicator_mode = training_view_mode(request)
            if indicator_mode == 'training':
                indicators = indicators.filter(projects__is_training=True)
            elif indicator_mode == 'live':
                indicators = indicators.filter(
                    Q(projects__is_training=False) | Q(projects__isnull=True)
                )
            total_indicators = indicators.distinct().count()

        recent_activity = []
        for interaction in interactions.select_related('respondent').order_by('-date', '-created_at')[:10]:
            respondent_name = (
                interaction.respondent.full_name
                if getattr(interaction, 'respondent_id', None)
                else 'Respondent'
            )
            recent_activity.append({
                'type': 'interaction',
                'description': f'Interaction recorded for {respondent_name}',
                'timestamp': interaction.created_at.isoformat(),
            })
        
        return Response({
            'total_respondents': respondents.count(),
            'total_assessments': interactions.count(),
            'active_projects': projects.filter(status='active').count(),
            'total_indicators': total_indicators,
            'indicators_behind': indicators_behind,
            'recent_activity': recent_activity,
            'selected_project_id': project_id,
            'default_project_id': resolved_default_project_id,
        })

    @action(detail=False, methods=['get'])
    def message_analytics(self, request):
        """Get HIV prevention message-type matrix by organization for dashboard widgets."""
        user = request.user
        project_param = request.query_params.get('project')
        coordinator_param = request.query_params.get('coordinator')
        organization_param = request.query_params.get('organization')
        date_from_param = request.query_params.get('date_from')
        date_to_param = request.query_params.get('date_to')

        project_id = _safe_parse_int(project_param) if project_param not in (None, "") else None
        coordinator_id = _safe_parse_int(coordinator_param) if coordinator_param not in (None, "") else None
        organization_id = _safe_parse_int(organization_param) if organization_param not in (None, "") else None

        if project_param not in (None, "") and project_id is None:
            return Response(
                {'detail': 'project must be a valid numeric id.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if coordinator_param not in (None, "") and coordinator_id is None:
            return Response(
                {'detail': 'coordinator must be a valid numeric id.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if organization_param not in (None, "") and organization_id is None:
            return Response(
                {'detail': 'organization must be a valid numeric id.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        date_from = _safe_parse_date(date_from_param) if date_from_param else None
        date_to = _safe_parse_date(date_to_param) if date_to_param else None
        if date_from_param and not date_from:
            return Response(
                {'detail': 'Invalid date_from. Expected YYYY-MM-DD.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if date_to_param and not date_to:
            return Response(
                {'detail': 'Invalid date_to. Expected YYYY-MM-DD.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if date_from and date_to and date_from > date_to:
            return Response(
                {'detail': 'date_from must be before date_to.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        requested_org_ids = None
        if coordinator_id is not None:
            requested_org_ids = _organization_scope_with_descendants(coordinator_id, project_id=project_id)
        if organization_id is not None:
            organization_scope = _organization_scope_with_descendants(organization_id, project_id=project_id)
            requested_org_ids = (
                organization_scope
                if requested_org_ids is None
                else requested_org_ids.intersection(organization_scope)
            )

        if requested_org_ids is not None and len(requested_org_ids) == 0:
            return Response({'rows': [], 'series': []})

        user_scope_ids = None if is_organization_admin(user) else set(get_user_organization_ids(user) or [])
        effective_org_ids = requested_org_ids
        if user_scope_ids is not None:
            effective_org_ids = (
                user_scope_ids
                if effective_org_ids is None
                else effective_org_ids.intersection(user_scope_ids)
            )
            if len(effective_org_ids) == 0:
                return Response({'rows': [], 'series': []})

        cache_key = _build_message_analytics_cache_key(
            user_id=getattr(user, 'id', None),
            project_id=project_id,
            coordinator_id=coordinator_id,
            organization_id=organization_id,
            date_from=date_from,
            date_to=date_to,
            effective_org_ids=effective_org_ids,
            mode=training_view_mode(request),
        )
        cached_payload = cache.get(cache_key)
        if isinstance(cached_payload, dict):
            return Response(cached_payload)

        indicator_catalog = _get_hiv_message_indicator_catalog()
        indicator_ids = [indicator_id for indicator_id in indicator_catalog.keys()]
        if len(indicator_ids) == 0:
            payload = {'rows': [], 'series': []}
            cache.set(
                cache_key,
                payload,
                timeout=_MESSAGE_ANALYTICS_RESPONSE_CACHE_TTL_SECONDS,
            )
            return Response(payload)

        aggregates = Aggregate.objects.filter(
            status='approved',
            indicator_id__in=indicator_ids,
        )

        if effective_org_ids is not None:
            aggregates = aggregates.filter(organization_id__in=effective_org_ids)
        if project_id is not None:
            aggregates = aggregates.filter(project_id=project_id)
        if date_from:
            aggregates = aggregates.filter(period_start__gte=date_from)
        if date_to:
            aggregates = aggregates.filter(period_end__lte=date_to)
        aggregates = apply_training_filter(aggregates, request, project_lookup="project")

        organization_by_id = _get_organization_rollup_catalog()

        coordinator_rollup_organizations = [
            {
                'key': str(organization.get('id')),
                'label': str(organization.get('name') or 'Unassigned org'),
            }
            for organization in organization_by_id.values()
            if _is_coordinator_portfolio_organization(organization)
            and (
                effective_org_ids is None
                or int(organization.get('id') or 0) in effective_org_ids
            )
        ]
        coordinator_rollup_organizations = sorted(
            coordinator_rollup_organizations,
            key=lambda item: item['label'],
        )
        coordinator_rollup_keys = {item['key'] for item in coordinator_rollup_organizations}

        totals_by_series_key = defaultdict(float)
        series_label_by_key = {}
        organization_rows = {}
        rollup_by_organization_id = {}

        aggregate_rows = aggregates.values_list('organization_id', 'indicator_id', 'value')
        for organization_id_value, indicator_id_value, aggregate_value in aggregate_rows.iterator(chunk_size=2000):
            indicator_id_int = int(indicator_id_value or 0)
            message_type_label = indicator_catalog.get(indicator_id_int)
            if not message_type_label:
                continue

            total_value = _extract_total(aggregate_value)
            if total_value <= 0:
                continue

            organization_id_int = int(organization_id_value or 0)
            organization_payload = organization_by_id.get(organization_id_int)
            organization_label = str(
                (organization_payload or {}).get('name') or 'Unassigned org'
            )

            rollup = rollup_by_organization_id.get(organization_id_int)
            if not rollup:
                rollup = _resolve_coordinator_rollup_organization(
                    organization_id=organization_id_int,
                    fallback_label=organization_label,
                    organization_by_id=organization_by_id,
                )
                rollup_by_organization_id[organization_id_int] = rollup
            organization_key = rollup['key']
            organization_label = rollup['label']

            if coordinator_rollup_keys and organization_key not in coordinator_rollup_keys:
                continue

            series_key = _to_series_key(message_type_label)
            totals_by_series_key[series_key] += float(total_value)
            if series_key not in series_label_by_key:
                series_label_by_key[series_key] = message_type_label

            current_row = organization_rows.get(organization_key)
            if not current_row:
                current_row = {
                    'label': organization_label,
                    'totals_by_series': defaultdict(float),
                    'total': 0.0,
                }
            current_row['totals_by_series'][series_key] += float(total_value)
            current_row['total'] += float(total_value)
            organization_rows[organization_key] = current_row

        sorted_series = sorted(
            totals_by_series_key.items(),
            key=lambda item: item[1],
            reverse=True,
        )[:8]
        series_keys = [series_key for series_key, _ in sorted_series]
        series = [
            {
                'key': series_key,
                'label': series_label_by_key.get(series_key, series_key.replace('_', ' ').title()),
                'color': _HIV_PREVENTION_MESSAGE_TYPE_PALETTE[index % len(_HIV_PREVENTION_MESSAGE_TYPE_PALETTE)],
            }
            for index, series_key in enumerate(series_keys)
        ]

        # Preserve stable row ordering by known coordinator portfolio labels when available.
        if coordinator_rollup_organizations:
            ordered_rows = [
                (item['key'], organization_rows.get(item['key']))
                for item in coordinator_rollup_organizations
            ]
            ordered_rows = [(key, row) for key, row in ordered_rows if row]
        else:
            ordered_rows = sorted(
                organization_rows.items(),
                key=lambda item: item[1]['total'],
                reverse=True,
            )[:8]

        rows = []
        for _, row_payload in ordered_rows:
            row = {'cso': row_payload['label']}
            for series_key in series_keys:
                row[series_key] = float(row_payload['totals_by_series'].get(series_key, 0.0))
            rows.append(row)

        # Normalize series labels for common abbreviations.
        for item in series:
            label_value = str(item.get('label') or '')
            if 'Hiv' in label_value:
                item['label'] = label_value.replace('Hiv', 'HIV')
                label_value = item['label']
            if 'Arv' in item['label']:
                item['label'] = item['label'].replace('Arv', 'ARV')
            if item['label'] == 'Prep':
                item['label'] = 'PrEP'
            if item['label'] == 'Pep':
                item['label'] = 'PEP'
            if item['label'] == 'Gbv':
                item['label'] = 'GBV'
            if item['label'] == 'Emtct':
                item['label'] = 'EMTCT'

        payload = {
            'rows': rows,
            'series': series,
        }
        cache.set(
            cache_key,
            payload,
            timeout=_MESSAGE_ANALYTICS_RESPONSE_CACHE_TTL_SECONDS,
        )
        return Response(payload)

