from rest_framework import viewsets, status
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework.exceptions import PermissionDenied
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework.filters import SearchFilter, OrderingFilter
from django.utils import timezone
from django.db import models, transaction
from django.db.models import Count, Sum, Avg, Q
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
from projects.models import Project
from projects.hierarchy import resolve_organization_scope_with_project_hierarchy
from projects.assignment_rules import count_project_indicators_for_organization_scope
from .serializers import ReportSerializer, SavedQuerySerializer, ScheduledReportSerializer, CoordinatorTargetSerializer
from aggregates.models import Aggregate
from organizations.access import get_user_organization_ids, is_organization_admin, filter_queryset_by_org_ids, apply_training_filter, apply_training_filter_to_projects, should_include_training, training_view_mode
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
        ]
    )
    digest = hashlib.sha1(key_source.encode('utf-8')).hexdigest()
    return f'analysis:dashboard:message_analytics:v2:{digest}'


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

    data = [
        {
            'month': month_start.strftime('%b %Y'),
            'value': totals[month_start],
            'target': 0,
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
    aggregates = Aggregate.objects.filter(indicator_id__in=indicator_ids, status='approved')
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
        indicator_totals = totals_by_indicator.get(agg.indicator_id)
        if indicator_totals is not None and month_start in indicator_totals:
            indicator_totals[month_start] += _extract_total(agg.value)

    indicator_lookup = {
        indicator.id: indicator.name
        for indicator in Indicator.objects.filter(id__in=indicator_ids)
    }

    series = []
    for indicator_id in indicator_ids:
        totals = totals_by_indicator.get(indicator_id, {})
        data = [
            {
                'month': month_start.strftime('%b %Y'),
                'value': totals.get(month_start, 0.0),
                'target': 0,
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




class CoordinatorTargetViewSet(viewsets.ModelViewSet):
    """Coordinator target CRUD API backed by the live coordinator target table."""

    queryset = CoordinatorTarget.objects.select_related('project', 'coordinator', 'indicator').all()
    serializer_class = CoordinatorTargetSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [SearchFilter, OrderingFilter]
    search_fields = ['project__name', 'coordinator__name', 'indicator__name', 'notes']
    ordering_fields = ['year', 'quarter', 'target_value', 'updated_at', 'created_at']
    ordering = ['-updated_at']

    def get_queryset(self):
        qs = self.queryset
        qs = apply_training_filter(qs, self.request, project_lookup='project')
        user = self.request.user
        if not (user.is_superuser or user.is_staff or getattr(user, 'role', None) == 'admin'):
            if getattr(user, 'organization', None):
                qs = qs.filter(
                    models.Q(coordinator=user.organization) |
                    models.Q(coordinator__parent=user.organization) |
                    models.Q(project__organizations=user.organization)
                ).distinct()
            else:
                return qs.none()

        params = self.request.query_params
        if params.get('project_id'):
            qs = qs.filter(project_id=params.get('project_id'))
        if params.get('coordinator_id'):
            qs = qs.filter(coordinator_id=params.get('coordinator_id'))
        if params.get('indicator_id'):
            qs = qs.filter(indicator_id=params.get('indicator_id'))
        if params.get('year'):
            qs = qs.filter(year=params.get('year'))
        if params.get('quarter'):
            qs = qs.filter(quarter=params.get('quarter'))
        if params.get('is_active') in {'true', 'false'}:
            qs = qs.filter(is_active=(params.get('is_active') == 'true'))
        return qs

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

    def perform_create(self, serializer):
        project = serializer.validated_data.get('project')
        coordinator = serializer.validated_data.get('coordinator')
        self._assert_can_write_target(project=project, coordinator=coordinator)
        serializer.save()

    def perform_update(self, serializer):
        project = serializer.validated_data.get('project', serializer.instance.project)
        coordinator = serializer.validated_data.get('coordinator', serializer.instance.coordinator)
        self._assert_can_write_target(project=project, coordinator=coordinator)
        serializer.save()

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

        return Response({'created': created, 'updated': updated, 'skipped': skipped})

class ReportViewSet(viewsets.ModelViewSet):
    """ViewSet for managing reports."""
    
    queryset = Report.objects.all()
    serializer_class = ReportSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ['report_type', 'organization', 'is_public']
    search_fields = ['name', 'description']
    ordering = ['-created_at']
    
    def get_queryset(self):
        user = self.request.user
        if is_organization_admin(user):
            return Report.objects.all()
        org_ids = get_user_organization_ids(user)
        return Report.objects.filter(
            models.Q(organization_id__in=org_ids) |
            models.Q(is_public=True) |
            models.Q(created_by=user)
        )
    
    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)
    
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
        if report.report_type == 'indicator':
            totals = {}
            for agg in aggregates.select_related('indicator'):
                row = totals.setdefault(
                    agg.indicator_id,
                    {
                        'indicator_id': agg.indicator_id,
                        'indicator_code': agg.indicator.code,
                        'indicator_name': agg.indicator.name,
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
                cached_rows.append({
                    'indicator_id': agg.indicator_id,
                    'indicator_code': agg.indicator.code,
                    'indicator_name': agg.indicator.name,
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
    permission_classes = [IsAuthenticated]
    
    def get_queryset(self):
        return SavedQuery.objects.filter(user=self.request.user)
    
    def perform_create(self, serializer):
        serializer.save(user=self.request.user)


class ScheduledReportViewSet(viewsets.ModelViewSet):
    """ViewSet for scheduled reports."""

    queryset = ScheduledReport.objects.all()
    serializer_class = ScheduledReportSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ['frequency', 'is_active']
    search_fields = ['report_name', 'report_type']
    ordering = ['-created_at']

    def get_queryset(self):
        user = self.request.user
        if is_organization_admin(user):
            return ScheduledReport.objects.all()
        return ScheduledReport.objects.filter(created_by=user)

    def perform_create(self, serializer):
        data = serializer.validated_data
        next_run = data.get('next_run') or _next_run_for_frequency(data.get('frequency'))
        serializer.save(created_by=self.request.user, next_run=next_run)


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
            return Response(
                {
                    'total_respondents': 0,
                    'total_assessments': 0,
                    'active_projects': 0,
                    'total_indicators': 0,
                    'indicators_behind': 0,
                    'recent_activity': [],
                }
            )

        user_scope_ids = None if is_organization_admin(user) else set(get_user_organization_ids(user) or [])
        effective_org_ids = requested_org_ids
        if user_scope_ids is not None:
            effective_org_ids = (
                user_scope_ids
                if effective_org_ids is None
                else effective_org_ids.intersection(user_scope_ids)
            )
            if len(effective_org_ids) == 0:
                return Response(
                    {
                        'total_respondents': 0,
                        'total_assessments': 0,
                        'active_projects': 0,
                        'total_indicators': 0,
                        'indicators_behind': 0,
                        'recent_activity': [],
                    }
                )

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

        if project_id is not None:
            selected_project = projects.filter(id=project_id).first()
            total_indicators = (
                count_project_indicators_for_organization_scope(
                    project=selected_project,
                    organization_ids=effective_org_ids,
                )
                if selected_project is not None
                else 0
            )
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
            'indicators_behind': 0,  # Calculate based on project targets
            'recent_activity': recent_activity,
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

