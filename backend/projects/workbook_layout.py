"""Workbook Layout resolution + plan ordering.

A :class:`~projects.models.WorkbookLayout` is a coordinator-level template that
is the AUTHORITATIVE definition of the reporting workbook: it determines both
which indicators an organisation reports on AND the order (with optional section
grouping). It is deliberately independent of project, year, quarter, month and
period type — those are supplied at download time to fetch the data, never to
define the saved set/order.

This module is the single source of truth for:

  * resolving which layout applies to an organisation at download time
    (a sub-organisation inherits its coordinator's layout), and
  * filtering + reordering a list of ``IndicatorPlan`` objects by that layout.
    Only indicators placed in the layout appear; an indicator that is assigned
    but not placed means the organisation is not reporting on it, so it is
    excluded (there is no "Unordered Indicators" fallback).
"""
from __future__ import annotations

from collections import defaultdict

from django.db import DatabaseError

from .models import ProjectOrganizationHierarchy, WorkbookLayout


def get_active_layout(coordinator_org_id, mode: str = "live"):
    """Return the active :class:`WorkbookLayout` for a coordinator, or ``None``."""
    if not coordinator_org_id:
        return None
    try:
        return (
            WorkbookLayout.objects.filter(
                coordinator_organization_id=coordinator_org_id,
                mode=mode,
                is_active=True,
            )
            .prefetch_related("items", "items__indicator")
            .first()
        )
    except DatabaseError:
        return None


def get_project_ancestor_org_ids(project, org_id) -> list[int]:
    """``org_id`` plus its ancestors in *this project's* hierarchy, nearest first.

    Mirrors :func:`projects.scope.get_project_subtree_org_ids` but walks the
    parent edges upward. Cycle-safe. The org itself is the first element.
    """
    if project is None or org_id is None:
        return []
    try:
        org_id = int(org_id)
    except (TypeError, ValueError):
        return []

    try:
        edges = list(
            ProjectOrganizationHierarchy.objects.filter(
                project=project, is_active=True,
            ).values_list("parent_organization_id", "child_organization_id")
        )
    except DatabaseError:
        return [org_id]

    parents: dict[int, list[int]] = defaultdict(list)
    for parent_id, child_id in edges:
        parents[child_id].append(parent_id)

    ordered: list[int] = [org_id]
    seen: set[int] = {org_id}
    frontier = [org_id]
    while frontier:
        nxt: list[int] = []
        for cur in frontier:
            for parent_id in parents.get(cur, []):
                if parent_id not in seen:
                    seen.add(parent_id)
                    ordered.append(parent_id)
                    nxt.append(parent_id)
        frontier = nxt
    return ordered


def resolve_layout_for_org(project, organization, mode: str = "live"):
    """The layout that governs ``organization``'s workbook order for ``project``.

    A sub-organisation inherits its coordinator's layout: we walk the org and its
    project-hierarchy ancestors (nearest first) and return the first that has an
    active layout. Returns ``None`` when no ancestor has a layout (→ caller falls
    back to the default ordering).
    """
    org_id = getattr(organization, "id", organization)
    for candidate_id in get_project_ancestor_org_ids(project, org_id):
        layout = get_active_layout(candidate_id, mode=mode)
        if layout is not None:
            return layout
    return None


def order_plans_by_layout(plans, layout):
    """Reorder ``plans`` (a list of ``IndicatorPlan``) by ``layout``.

    The Workbook Builder layout is the single source of truth for *what is
    reported* and in *what order*:
      * Layout items are walked in ``order_index``. Heading items set the current
        section; indicator items emit the matching plan (if applicable) under it.
      * A layout indicator that is NOT in ``plans`` (not applicable to the
        selected project/org) is skipped.
      * A plan whose indicator is NOT placed in the layout is EXCLUDED from the
        workbook. An indicator that is assigned but not arranged means the
        organisation is not reporting on it, so it must not appear in the
        download (no "Unordered Indicators" fallback section).
      * Each returned plan carries its ``section`` so the generator can render
        heading rows.

    ``layout`` may be ``None`` — or contain no indicator rows (an unconfigured
    layout) — in which case ``plans`` are returned unchanged (default ordering)
    rather than producing a blank workbook.
    """
    if layout is None:
        return list(plans)

    items = sorted(layout.items.all(), key=lambda i: (i.order_index, i.id))
    if not any(item.indicator_id is not None for item in items):
        # Unconfigured layout (headings only / empty) → fall back to default
        # ordering instead of emitting an empty workbook.
        return list(plans)

    by_indicator = {}
    for plan in plans:
        ind_id = getattr(plan.indicator, "id", None)
        if ind_id is not None:
            by_indicator.setdefault(ind_id, plan)

    ordered = []
    used: set[int] = set()
    current_section = ""
    for item in items:
        if item.indicator_id is None:
            # Section heading row.
            current_section = (item.section_title or "").strip()
            continue
        plan = by_indicator.get(item.indicator_id)
        if plan is None or item.indicator_id in used:
            continue  # not applicable to this selection, or duplicate guard
        plan.section = current_section
        ordered.append(plan)
        used.add(item.indicator_id)

    # Indicators assigned but NOT placed in the layout are intentionally omitted:
    # "not arranged" means the organisation is not reporting on them.
    return ordered
