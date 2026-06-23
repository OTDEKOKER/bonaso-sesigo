"""Historical workbook-layout snapshots (P3).

A :class:`~projects.models.WorkbookLayout` is a living template — editing it
re-orders every future workbook. To make a *past* period reproducible, the first
time a period's workbook is generated we freeze the exact resolved indicator
order + section structure into a :class:`~projects.models.WorkbookLayoutSnapshot`.
Subsequent generations of that same period reorder the (currently-applicable)
plans to match the frozen snapshot, so the structure never drifts after a later
layout edit.

Indicators that are applicable now but were not in the snapshot (e.g. assigned
after the snapshot was taken) are appended under "Unordered Indicators" and a
warning is recorded — never silently interleaved into the historical order.
"""
from __future__ import annotations

from django.db import DatabaseError, IntegrityError

from .models import WorkbookLayoutSnapshot
from .workbook_layout import UNORDERED_SECTION


def snapshot_items_from_plans(plans) -> list[dict]:
    """Serialise an ordered IndicatorPlan list into snapshot ``items``."""
    items = []
    for idx, plan in enumerate(plans):
        indicator = getattr(plan, "indicator", None)
        if indicator is None:
            continue
        items.append({
            "order_index": idx,
            "indicator_id": getattr(indicator, "id", None),
            "indicator_code": getattr(indicator, "code", "") or "",
            "indicator_name": getattr(indicator, "name", "") or "",
            "section_title": (getattr(plan, "section", "") or "").strip(),
        })
    return items


def get_or_create_snapshot(*, project, organization, kind, mode, period_start,
                           period_end, period_label, plans, layout=None,
                           user=None, refresh=False):
    """Return ``(snapshot, created)`` for one workbook period.

    On first generation (or ``refresh=True``) the current ``plans`` order is
    frozen. Otherwise the existing snapshot is returned untouched. Failures are
    swallowed (returns ``(None, False)``) so snapshotting can never break a
    download.
    """
    try:
        existing = WorkbookLayoutSnapshot.objects.filter(
            project=project, organization=organization, kind=kind, mode=mode,
            period_start=period_start, period_end=period_end,
        ).first()
    except DatabaseError:
        return None, False

    layout_version = ""
    if layout is not None and getattr(layout, "updated_at", None) is not None:
        layout_version = layout.updated_at.isoformat()

    if existing is not None and not refresh:
        return existing, False

    fields = {
        "period_label": period_label or "",
        "source_layout": layout,
        "layout_name": getattr(layout, "name", "") or "",
        "layout_version": layout_version,
        "items": snapshot_items_from_plans(plans),
        "created_by": user if getattr(user, "pk", None) else None,
    }
    try:
        if existing is not None:  # refresh
            for key, value in fields.items():
                setattr(existing, key, value)
            existing.save()
            return existing, True
        snapshot = WorkbookLayoutSnapshot.objects.create(
            project=project, organization=organization, kind=kind, mode=mode,
            period_start=period_start, period_end=period_end, **fields,
        )
        return snapshot, True
    except (DatabaseError, IntegrityError):
        # A concurrent generation may have created it first; fetch and return it.
        existing = WorkbookLayoutSnapshot.objects.filter(
            project=project, organization=organization, kind=kind, mode=mode,
            period_start=period_start, period_end=period_end,
        ).first()
        return existing, False


def order_plans_by_snapshot(plans, snapshot, *, warnings=None):
    """Reorder ``plans`` to match a frozen ``snapshot``.

    Plans whose indicator is in the snapshot are emitted in the snapshot's order,
    carrying the snapshot's section heading. Plans NOT in the snapshot (newly
    applicable since it was frozen) are appended under "Unordered Indicators" and
    a warning is recorded. Snapshot entries with no current plan are skipped.

    ``snapshot`` may be ``None`` → plans returned unchanged.
    """
    if snapshot is None:
        return list(plans)

    by_indicator = {}
    for plan in plans:
        ind_id = getattr(plan.indicator, "id", None)
        if ind_id is not None:
            by_indicator.setdefault(ind_id, plan)

    ordered = []
    used: set[int] = set()
    for item in sorted(snapshot.items or [], key=lambda i: i.get("order_index", 0)):
        ind_id = item.get("indicator_id")
        plan = by_indicator.get(ind_id)
        if plan is None or ind_id in used:
            continue
        plan.section = (item.get("section_title") or "").strip()
        ordered.append(plan)
        used.add(ind_id)

    leftovers = [p for p in plans if getattr(p.indicator, "id", None) not in used]
    for plan in leftovers:
        plan.section = UNORDERED_SECTION
        ordered.append(plan)
        if warnings is not None:
            name = getattr(plan.indicator, "name", None) or getattr(plan.indicator, "code", None) or "An indicator"
            warnings.append(
                f'Indicator “{name}” is newer than this period’s saved workbook structure; it was '
                f'added under “{UNORDERED_SECTION}”. The historical order is preserved.'
            )
    return ordered
