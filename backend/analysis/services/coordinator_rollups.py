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

    # --- Dynamic (derived) target sources — opt-in; default 'fixed' is a no-op.
    # Config lives on ProjectIndicator (project default) with an optional
    # per-coordinator override on ProjectIndicatorOrganizationTarget (POT). A
    # derived target is computed from the CURRENT report's achieved value of the
    # source indicator over the same coordinator scope/quarter; the stored target
    # value is never read for these rows.
    from projects.models import ProjectIndicator, ProjectIndicatorOrganizationTarget

    pi_by_project_canon: dict[tuple[int, int | None], ProjectIndicator] = {}
    pi_ids: list[int] = []
    for pi in (
        ProjectIndicator.objects
        .filter(project_id__in=all_project_ids)
        .select_related('indicator', 'target_source_indicator')
    ):
        canon = pi.indicator.canonical_id if pi.indicator_id else None
        pi_by_project_canon[(pi.project_id, canon)] = pi
        pi_ids.append(pi.id)

    coordinator_ids = {int(t.coordinator_id) for t in targets}
    pot_override: dict[tuple[int, int], ProjectIndicatorOrganizationTarget] = {}
    if pi_ids:
        for pot in (
            ProjectIndicatorOrganizationTarget.objects
            .filter(project_indicator_id__in=pi_ids, organization_id__in=coordinator_ids)
            .exclude(target_source_type__isnull=True)
            .select_related('target_source_indicator')
        ):
            pot_override[(pot.project_indicator_id, int(pot.organization_id))] = pot

    def _config_from(obj):
        src = getattr(obj, 'target_source_indicator', None)
        return {
            'type': obj.target_source_type,
            'source_canon': src.canonical_id if src is not None else None,
            'source_id': getattr(obj, 'target_source_indicator_id', None),
            'source_name': src.name if src is not None else None,
            'pct': float(obj.target_source_percentage) if obj.target_source_percentage is not None else None,
        }

    def resolve_target_config(project_id, coordinator_id, canonical_indicator_id):
        """Effective config: POT override > ProjectIndicator > fixed (None)."""
        pi = pi_by_project_canon.get((int(project_id), canonical_indicator_id))
        if pi is None:
            return None
        pot = pot_override.get((pi.id, int(coordinator_id)))
        if pot is not None and pot.target_source_type:
            # An explicit per-coordinator 'fixed' override forces fixed.
            return _config_from(pot) if pot.target_source_type != 'fixed' else None
        if pi.target_source_type and pi.target_source_type != 'fixed':
            return _config_from(pi)
        return None

    def source_actual(project_id, scope, start, end, canonical):
        """Achieved value of the source indicator over the same scope/quarter.
        Returns (value, has_any_reported) so a real reported 0 is distinguished
        from 'not yet reported' (pending)."""
        if canonical is None:
            return 0.0, False
        total_sum = 0.0
        has_any = False
        for (proj_id, org_id, agg_canonical, p_start, p_end, total) in agg_rows:
            if proj_id != project_id or agg_canonical != canonical:
                continue
            if org_id not in scope:
                continue
            if not (p_start <= end and p_end >= start):
                continue
            has_any = True
            total_sum += total
        return total_sum, has_any

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
        config = resolve_target_config(target.project_id, target.coordinator_id, canonical_indicator)
        target_source_meta = None
        if config is None:
            # Fixed (existing behaviour, byte-for-byte).
            target_value = float(target.target_value or 0)
        else:
            src_val, src_has = source_actual(target.project_id, scope, start, end, config['source_canon'])
            target_source_meta = {
                'type': config['type'],
                'source_indicator_id': config['source_id'],
                'source_indicator_name': config['source_name'],
                'percentage': config['pct'],
            }
            if config['source_canon'] is None or not src_has:
                target_value = None  # pending — source indicator not yet reported
            else:
                factor = (config['pct'] / 100.0) if (config['type'] == 'percentage' and config['pct'] is not None) else 1.0
                target_value = src_val * factor
        if target_value is None:
            achievement = None
            status = 'pending'
            variance = None
        else:
            achievement = (actual / target_value * 100) if target_value > 0 else None
            status = performance_status(target_value, achievement)
            variance = actual - target_value
        results[target.id] = {
            'target_value': target_value,
            'target_source': target_source_meta,
            'target_pending': target_value is None and target_source_meta is not None,
            'own_actual_value': own,
            # The coordinator's own contribution vs everything rolled up from its
            # subgrantees/children. ``own + subgrantee == actual`` by construction.
            'own_contribution': own,
            'subgrantee_contribution': actual - own,
            'actual_value': actual,
            'achievement_percent': achievement,
            'variance': variance,
            'performance_status': status,
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
    """``{target_id: {"target": value}}`` — effective (resolved) target values.
    For derived/percentage rows this is the computed value (or None when pending);
    for fixed rows it equals the stored target."""
    return {
        target_id: {'target': payload['target_value']}
        for target_id, payload in compute_target_actuals(targets).items()
    }


def compute_actuals_for_specs(specs) -> dict[tuple, float]:
    """Achieved (actual) value for arbitrary
    ``(project_id, coordinator_id, canonical_indicator_id, year, quarter)`` tuples
    — independent of whether a ``CoordinatorTarget`` exists for them.

    Uses the SAME coordinator-scope resolution, approved-aggregate source,
    canonical-indicator match and period-overlap rule as
    :func:`compute_target_actuals`, so the achieved numbers are identical to the
    certified per-target engine. Intended for surfaces (e.g. the targets-vs-
    achieved export) that need achieved for every assigned/workbook indicator,
    including those not yet targeted.

    Returns ``{(project_id, coordinator_id, canonical_id, year, quarter): actual}``
    keyed by the normalised spec (ints; quarter upper-cased). Specs with a missing
    project/coordinator/canonical are skipped.
    """
    specs = list(specs)
    if not specs:
        return {}

    scope_cache: dict[tuple[int, int], set[int]] = {}

    def scope_for(coordinator_id, project_id) -> set[int]:
        key = (int(coordinator_id), int(project_id))
        if key not in scope_cache:
            scope_cache[key] = resolve_organization_scope_with_project_hierarchy(
                int(coordinator_id), project_id=int(project_id)
            ) or {int(coordinator_id)}
        return scope_cache[key]

    meta = []  # (out_key, project_id, scope, canonical_id, start, end)
    all_org_ids: set[int] = set()
    all_project_ids: set[int] = set()
    min_start: date | None = None
    max_end: date | None = None
    seen_keys: set[tuple] = set()
    for spec in specs:
        project_id, coordinator_id, canonical_id, year, quarter = spec
        if project_id is None or coordinator_id is None or canonical_id is None:
            continue
        out_key = (int(project_id), int(coordinator_id), int(canonical_id), int(year), str(quarter).upper())
        if out_key in seen_keys:
            continue
        seen_keys.add(out_key)
        scope = scope_for(coordinator_id, project_id)
        start, end = fiscal_quarter_range(year, quarter)
        meta.append((out_key, int(project_id), scope, int(canonical_id), start, end))
        all_org_ids |= scope
        all_project_ids.add(int(project_id))
        min_start = start if min_start is None or start < min_start else min_start
        max_end = end if max_end is None or end > max_end else max_end

    # One aggregate query for the whole batch, indexed by (project, canonical) so
    # each spec only scans its own rows.
    by_pc: dict[tuple[int, int], list[tuple]] = {}
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
            canon = aggregate.indicator.canonical_id if aggregate.indicator_id else None
            if canon is None:
                continue
            by_pc.setdefault((aggregate.project_id, canon), []).append((
                aggregate.organization_id,
                aggregate.period_start,
                aggregate.period_end,
                aggregate_total(aggregate.value),
            ))

    results: dict[tuple, float] = {}
    for (out_key, project_id, scope, canonical_id, start, end) in meta:
        total_sum = 0.0
        for (org_id, p_start, p_end, total) in by_pc.get((project_id, canonical_id), ()):  # overlap
            if org_id in scope and p_start <= end and p_end >= start:
                total_sum += total
        results[out_key] = total_sum
    return results
