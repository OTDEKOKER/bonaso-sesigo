"""Server-side coordinator target rollup (rollout readiness R3).

Computes each coordinator target's actuals by summing **approved** aggregate
totals over the coordinator's organization subtree (resolved via the project
hierarchy), within the target's fiscal quarter. This moves the calculation off
the client so coordinator totals can no longer drift between browsers or partial
data loads.

Parity with the prior client logic is deliberate and exact:
  * Botswana fiscal year, Apr-Mar (Q1 Apr-Jun … Q4 Jan-Mar of the next year).
  * Period **overlap** (not containment) against the quarter window.
  * Approved aggregates only (the client fetched ``status=approved``).
  * Indicator matched on canonical id (alias/deprecated-duplicate safe).
  * ``actual`` split into the coordinator's own org vs each child org.
  * Status thresholds: met ≥ 100, on_track ≥ 80, else behind; no_target when
    target ≤ 0.
"""
from __future__ import annotations

from datetime import date

from aggregates.models import Aggregate
from organizations.models import Organization
from projects.hierarchy import resolve_organization_scope_with_project_hierarchy


def fiscal_quarter_range(year, quarter) -> tuple[date, date]:
    year = int(year)
    q = str(quarter or '').upper()
    if q == 'Q1':
        return date(year, 4, 1), date(year, 6, 30)
    if q == 'Q2':
        return date(year, 7, 1), date(year, 9, 30)
    if q == 'Q3':
        return date(year, 10, 1), date(year, 12, 31)
    return date(year + 1, 1, 1), date(year + 1, 3, 31)  # Q4


def _is_number(value) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _sum_numeric_leaves(node) -> float:
    if isinstance(node, dict):
        return sum(_sum_numeric_leaves(child) for child in node.values())
    return float(node) if _is_number(node) else 0.0


def aggregate_total(value) -> float:
    """Mirror of the frontend ``getAggregateTotal``: prefer total>0, else
    male+female, else the sum of numeric disaggregate leaves."""
    if _is_number(value):
        return float(value)
    if not isinstance(value, dict):
        return 0.0
    total = value.get('total')
    if _is_number(total) and total > 0:
        return float(total)
    male, female = value.get('male'), value.get('female')
    if _is_number(male) or _is_number(female):
        return (float(male) if _is_number(male) else 0.0) + (float(female) if _is_number(female) else 0.0)
    if _is_number(total):
        return float(total)  # total == 0
    disaggregates = value.get('disaggregates')
    if isinstance(disaggregates, dict):
        return _sum_numeric_leaves(disaggregates)
    return 0.0


def performance_status(target_value: float, achievement_percent) -> str:
    if target_value <= 0 or achievement_percent is None:
        return 'no_target'
    if achievement_percent >= 100:
        return 'met'
    if achievement_percent >= 80:
        return 'on_track'
    return 'behind'


def compute_target_actuals(targets) -> dict[int, dict]:
    """Return ``{target_id: actuals_dict}`` for an iterable of CoordinatorTarget."""
    targets = list(targets)
    if not targets:
        return {}

    scope_cache: dict[tuple[int, int], set[int]] = {}

    def scope_for(coordinator_id, project_id) -> set[int]:
        key = (int(coordinator_id), int(project_id))
        if key not in scope_cache:
            scope_cache[key] = resolve_organization_scope_with_project_hierarchy(
                int(coordinator_id), project_id=int(project_id)
            ) or {int(coordinator_id)}
        return scope_cache[key]

    meta = []
    all_org_ids: set[int] = set()
    all_project_ids: set[int] = set()
    min_start: date | None = None
    max_end: date | None = None
    for target in targets:
        scope = scope_for(target.coordinator_id, target.project_id)
        start, end = fiscal_quarter_range(target.year, target.quarter)
        canonical_indicator = target.indicator.canonical_id if target.indicator_id else None
        meta.append((target, scope, start, end, canonical_indicator))
        all_org_ids |= scope
        all_project_ids.add(target.project_id)
        min_start = start if min_start is None or start < min_start else min_start
        max_end = end if max_end is None or end > max_end else max_end

    agg_rows: list[tuple] = []
    if all_org_ids and all_project_ids:
        for aggregate in (
            Aggregate.objects.filter(
                status='approved',
                project_id__in=all_project_ids,
                organization_id__in=all_org_ids,
                period_start__lte=max_end,
                period_end__gte=min_start,
            ).select_related('indicator')
        ):
            agg_rows.append((
                aggregate.project_id,
                aggregate.organization_id,
                aggregate.indicator.canonical_id if aggregate.indicator_id else None,
                aggregate.period_start,
                aggregate.period_end,
                aggregate_total(aggregate.value),
            ))

    results: dict[int, dict] = {}
    child_org_ids: set[int] = set()
    for (target, scope, start, end, canonical_indicator) in meta:
        own = 0.0
        actual = 0.0
        child_by_org: dict[int, float] = {}
        for (proj_id, org_id, agg_canonical, p_start, p_end, total) in agg_rows:
            if proj_id != target.project_id:
                continue
            if canonical_indicator is not None and agg_canonical != canonical_indicator:
                continue
            if org_id not in scope:
                continue
            if not (p_start <= end and p_end >= start):  # overlap
                continue
            actual += total
            if org_id == target.coordinator_id:
                own += total
            else:
                child_by_org[org_id] = child_by_org.get(org_id, 0.0) + total
        child_org_ids |= set(child_by_org.keys())
        target_value = float(target.target_value or 0)
        achievement = (actual / target_value * 100) if target_value > 0 else None
        results[target.id] = {
            'own_actual_value': own,
            'actual_value': actual,
            'achievement_percent': achievement,
            'variance': actual - target_value,
            'performance_status': performance_status(target_value, achievement),
            '_child_by_org': child_by_org,
        }

    names = (
        dict(Organization.objects.filter(id__in=child_org_ids).values_list('id', 'name'))
        if child_org_ids
        else {}
    )

    for target_id, payload in results.items():
        child_by_org = payload.pop('_child_by_org')
        actual = payload['actual_value']
        payload['child_contributions'] = sorted(
            (
                {
                    'organization_id': org_id,
                    'organization_name': names.get(org_id, f'Organization {org_id}'),
                    'actual_value': value,
                    'share_percent': (value / actual * 100) if actual > 0 else 0.0,
                }
                for org_id, value in child_by_org.items()
            ),
            key=lambda row: row['actual_value'],
            reverse=True,
        )
    return results
