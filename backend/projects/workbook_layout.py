"""Workbook Layout resolution + plan ordering.

A :class:`~projects.models.WorkbookLayout` is a coordinator-level template that
defines ONLY the order (and optional section grouping) of indicators in a
generated reporting workbook. It is deliberately independent of project, year,
quarter, month and period type — those are supplied at download time to fetch
the data, never to define the saved order.

This module is the single source of truth for:

  * resolving which layout applies to an organisation at download time
    (a sub-organisation inherits its coordinator's layout), and
  * reordering a list of ``IndicatorPlan`` objects by that layout, skipping
    layout indicators that are not applicable to the current selection and
    appending newly-applicable indicators under an "Unordered Indicators"
    section so workbook generation never breaks when indicators are added.
"""
from __future__ import annotations

from collections import defaultdict

from django.db import DatabaseError

from .models import ProjectOrganizationHierarchy, WorkbookLayout

UNORDERED_SECTION = "Unordered Indicators"


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


def order_plans_by_layout(plans, layout, *, warnings=None):
    """Reorder ``plans`` (a list of ``IndicatorPlan``) by ``layout``.

    The :class:`WorkbookLayout` is the single source of truth for indicator order
    and section grouping. Rules:
      * Layout items are walked in ``order_index``. Heading items set the current
        section; indicator items emit the matching plan (if applicable) under it.
      * A layout indicator that is NOT in ``plans`` (not applicable to the
        selected project/org) is skipped.
      * A plan whose indicator is not in the layout is appended at the bottom
        under an "Unordered Indicators" section — AND, when ``warnings`` is
        provided, a clear notice is recorded for it so the gap is visible rather
        than silent (P2).
      * Each returned plan carries its ``section`` so the generator can render
        heading rows.

    ``layout`` may be ``None`` → returns ``plans`` unchanged (default ordering),
    with no sections set.
    """
    if layout is None:
        return list(plans)

    by_indicator = {}
    for plan in plans:
        ind_id = getattr(plan.indicator, "id", None)
        if ind_id is not None:
            by_indicator.setdefault(ind_id, plan)

    ordered = []
    used: set[int] = set()
    current_section = ""
    for item in sorted(layout.items.all(), key=lambda i: (i.order_index, i.id)):
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

    # Applicable indicators not yet placed → append under "Unordered Indicators".
    leftovers = [p for p in plans if getattr(p.indicator, "id", None) not in used]
    for plan in leftovers:
        plan.section = UNORDERED_SECTION
        ordered.append(plan)
        if warnings is not None:
            name = getattr(plan.indicator, "name", None) or getattr(plan.indicator, "code", None) or "An indicator"
            warnings.append(
                f'Indicator “{name}” is assigned but not placed in the workbook layout; it was '
                f'added under “{UNORDERED_SECTION}”. Add it to the layout to control its position.'
            )

    return ordered
