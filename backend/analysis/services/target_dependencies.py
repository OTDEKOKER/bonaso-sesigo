"""Dependency-graph validation for dynamic (derived) indicator targets.

A derived target points an indicator at a *source* indicator whose achieved value
drives it. Two configs must be rejected before they are saved:

  * a self-loop   A -> A
  * a cycle       A -> B -> A (any length)

Edges are collected per project from ProjectIndicator (project default) and the
per-coordinator overrides on ProjectIndicatorOrganizationTarget, matched on the
canonical indicator id so alias/deprecated twins can't sneak a cycle in.
"""

from __future__ import annotations

from collections import defaultdict

from rest_framework import serializers

from indicators.models import Indicator
from projects.models import ProjectIndicator, ProjectIndicatorOrganizationTarget

DERIVED_TYPES = {'derived', 'percentage'}


def _canonical(indicator_id):
    if indicator_id is None:
        return None
    ind = Indicator.objects.filter(id=indicator_id).only('id', 'canonical_indicator_id').first()
    return ind.canonical_id if ind is not None else indicator_id


def project_target_edges(project_id, *, exclude_pi_id=None, exclude_pot_id=None):
    """{canonical_indicator_id -> set(source_canonical_id)} for a project."""
    edges: dict[int, set[int]] = defaultdict(set)
    pis = (
        ProjectIndicator.objects
        .filter(project_id=project_id, target_source_type__in=DERIVED_TYPES,
                target_source_indicator__isnull=False)
        .select_related('indicator', 'target_source_indicator')
    )
    for pi in pis:
        if exclude_pi_id is not None and pi.id == exclude_pi_id:
            continue
        a = pi.indicator.canonical_id if pi.indicator_id else None
        b = pi.target_source_indicator.canonical_id
        if a and b:
            edges[a].add(b)
    pots = (
        ProjectIndicatorOrganizationTarget.objects
        .filter(project_indicator__project_id=project_id,
                target_source_type__in=DERIVED_TYPES,
                target_source_indicator__isnull=False)
        .select_related('project_indicator__indicator', 'target_source_indicator')
    )
    for pot in pots:
        if exclude_pot_id is not None and pot.id == exclude_pot_id:
            continue
        a = pot.project_indicator.indicator.canonical_id if pot.project_indicator.indicator_id else None
        b = pot.target_source_indicator.canonical_id
        if a and b:
            edges[a].add(b)
    return edges


def _reaches(edges, start, goal, seen=None):
    """True if `goal` is reachable from `start` following edges."""
    if start == goal:
        return True
    if seen is None:
        seen = set()
    if start in seen:
        return False
    seen.add(start)
    return any(_reaches(edges, nxt, goal, seen) for nxt in edges.get(start, ()))


def find_cycle(edges):
    """Return a list describing a cycle if one exists, else None."""
    WHITE, GREY, BLACK = 0, 1, 2
    color = defaultdict(int)
    stack: list[int] = []

    def dfs(node):
        color[node] = GREY
        stack.append(node)
        for nxt in edges.get(node, ()):
            if color[nxt] == GREY:
                return stack[stack.index(nxt):] + [nxt]
            if color[nxt] == WHITE:
                found = dfs(nxt)
                if found:
                    return found
        stack.pop()
        color[node] = BLACK
        return None

    for start in list(edges.keys()):
        if color[start] == WHITE:
            found = dfs(start)
            if found:
                return found
    return None


def assert_valid_target_source(project_id, indicator_id, source_indicator_id, target_type,
                               *, exclude_pi_id=None, exclude_pot_id=None):
    """Validate a proposed derived-target edge; raise DRF ValidationError on a
    self-loop, a cycle, or a missing source. No-op for fixed/None."""
    if target_type in (None, '', 'fixed'):
        return
    if not source_indicator_id:
        raise serializers.ValidationError(
            {'target_source_indicator': 'A source indicator is required for a derived/percentage target.'}
        )
    a = _canonical(indicator_id)
    b = _canonical(source_indicator_id)
    if a is not None and a == b:
        raise serializers.ValidationError(
            {'target_source_indicator': 'An indicator cannot derive its target from itself.'}
        )
    edges = project_target_edges(project_id, exclude_pi_id=exclude_pi_id, exclude_pot_id=exclude_pot_id)
    # Adding edge a -> b creates a cycle iff a is already reachable from b.
    if a is not None and b is not None and _reaches(edges, b, a):
        raise serializers.ValidationError(
            {'target_source_indicator': 'This target source creates a circular dependency.'}
        )


def project_dependency_report(project_id):
    """Read-only summary for the admin dependency-check endpoint."""
    edges = project_target_edges(project_id)
    cycle = find_cycle(edges)
    return {
        'project_id': int(project_id),
        'edges': {str(k): sorted(v) for k, v in edges.items()},
        'has_cycle': bool(cycle),
        'cycle': cycle or [],
    }
