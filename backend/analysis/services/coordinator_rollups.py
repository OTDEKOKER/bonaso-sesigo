"""Certified server-side coordinator rollup engine (rollout readiness R3).

This is the **single authoritative source of truth** for coordinator target
actuals, achievement, and performance status. Every coordinator surface — the
Targets page, analytics, dashboards, exports, and any future reporting API —
must derive its totals from this module. No screen may recompute them.

It computes each coordinator target's actuals by summing **approved** aggregate
totals over the coordinator's organization subtree (resolved via the project
hierarchy), within the target's fiscal quarter.

Parity with the prior client logic is deliberate and exact:
  * Botswana fiscal year, Apr-Mar (Q1 Apr-Jun … Q4 Jan-Mar of the next year).
  * Period **overlap** (not containment) against the quarter window.
  * Approved aggregates only (the client fetched ``status=approved``).
  * Indicator matched on canonical id (alias/deprecated-duplicate safe).
  * ``actual`` split into the coordinator's own org vs each child org.
  * Status thresholds: met >= 100, on_track >= 80, else behind; no_target when
    target <= 0.

Public API
----------
``get_coordinator_performance(targets)``
    Full computed record per target (target, actual, achievement_percent,
    status, own/subgrantee contributions, per-child breakdown). This is what
    the API serializer and exports consume.
``get_coordinator_actuals(targets)``
    ``{target_id: {"actual": value}}`` — actuals only.
``get_coordinator_targets(targets)``
    ``{target_id: {"target": value}}`` — target values only.

``compute_target_actuals`` is retained as the underlying engine (and the name
used by older imports / the test-suite).
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
    """Return ``{target_id: actuals_dict}`` for an iterable of CoordinatorTarget.

    A single pass: every distinct ``(coordinator, project)`` hierarchy scope is
    resolved once (cached for the request), and a single aggregate query covers
    every target in the batch — so list endpoints stay O(1) in queries rather
    than N+1 per row.
    """
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
            'target_value': target_value,
            'own_actual_value': own,
            # The coordinator's own contribution vs everything rolled up from its
            # subgrantees/children. ``own + subgrantee == actual`` by construction.
            'own_contribution': own,
            'subgrantee_contribution': actual - own,
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


# --- Named public API (single source of truth) -----------------------------

def get_coordinator_performance(targets) -> dict[int, dict]:
    """Full computed performance record per target id. The authoritative payload
    consumed by the API serializer and CSV exports."""
    return compute_target_actuals(targets)


def get_coordinator_actuals(targets) -> dict[int, dict]:
    """``{target_id: {"actual": value}}`` — actuals only."""
    return {
        target_id: {'actual': payload['actual_value']}
        for target_id, payload in compute_target_actuals(targets).items()
    }


def get_coordinator_targets(targets) -> dict[int, dict]:
    """``{target_id: {"target": value}}`` — configured target values only."""
    return {target.id: {'target': float(target.target_value or 0)} for target in targets}
