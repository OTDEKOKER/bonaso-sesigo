"""Server-side rollup queries over the AggregateFact table.

A rollup is a single SQL ``GROUP BY`` + ``SUM`` over the (already scoped) fact
rows, returning a compact result instead of shipping every aggregate to the
client. Permission scoping reuses the exact same primitives as
``AggregateViewSet.get_queryset`` (training mode, project-assignment gate, org
scope), applied directly to the denormalised fact columns so no joins are
needed.

``group_by`` accepts any of: ``indicator`` (canonical, alias-safe), ``sex``,
``age`` (raw band), ``kp`` (primary / key population), ``organization``,
``project``. Age folding (single-year → five-year group) is applied in Python
on the small grouped result, reusing ``analysis.services.age_bands``.
"""
from __future__ import annotations

from django.db.models import Sum

from analysis.services.age_bands import single_age_group_label
from indicators.models import Indicator
from .models import AggregateFact

# group_by token -> fact column
_GROUP_FIELDS = {
    "indicator": "canonical_indicator_id",
    "sex": "secondary",
    "age": "band",
    "kp": "primary",
    "organization": "organization_id",
    "project": "project_id",
}


def rollup_facts(fact_queryset, *, group_by: list[str], fold_ages: bool = True) -> list[dict]:
    """Return ``[{<dims>, value}]`` grouped + summed over the fact queryset."""
    fields = [_GROUP_FIELDS[g] for g in group_by if g in _GROUP_FIELDS]
    if not fields:
        fields = ["canonical_indicator_id"]

    rows = list(
        fact_queryset.values(*fields).annotate(value=Sum("value")).order_by(*fields)
    )

    # Fold single-year ages into their five-year group (analysis surface rule).
    if fold_ages and "band" in fields:
        merged: dict[tuple, dict] = {}
        for row in rows:
            band = row.get("band")
            folded = single_age_group_label(band) if band is not None else None
            if folded:
                row = {**row, "band": folded}
            key = tuple(row[f] for f in fields)
            if key in merged:
                merged[key]["value"] = (merged[key]["value"] or 0) + (row["value"] or 0)
            else:
                merged[key] = row
        rows = list(merged.values())

    _enrich_indicator_names(rows)
    return rows


def _enrich_indicator_names(rows: list[dict]) -> None:
    if not rows or "canonical_indicator_id" not in rows[0]:
        return
    ids = {r["canonical_indicator_id"] for r in rows if r.get("canonical_indicator_id")}
    meta = {
        i.id: {"indicator_name": i.name, "indicator_code": i.code}
        for i in Indicator.objects.filter(id__in=ids).only("id", "name", "code")
    }
    for r in rows:
        r.update(meta.get(r.get("canonical_indicator_id"), {}))


def scoped_fact_queryset(view, request):
    """AggregateFact queryset scoped exactly like AggregateViewSet.get_queryset.

    Reuses the same training / project-assignment / org-scope primitives, applied
    to the fact table's denormalised columns. ``view`` provides the role helpers.
    """
    from organizations.access import (
        get_user_organization_ids,
        is_organization_admin,
        training_view_mode,
        filter_queryset_by_org_ids,
    )
    from projects.scope import filter_queryset_by_assigned_projects

    qs = AggregateFact.objects.all()

    mode = training_view_mode(request)
    if mode == "training":
        qs = qs.filter(is_training=True)
    elif mode == "live":
        qs = qs.filter(is_training=False)
    # mode == "all" (admin opt-in): no training filter.

    user = request.user
    if is_organization_admin(user):
        return qs
    qs = filter_queryset_by_assigned_projects(qs, user, "project_id")
    org_ids = get_user_organization_ids(user)
    if org_ids:
        return filter_queryset_by_org_ids(qs, "organization_id", org_ids)
    return AggregateFact.objects.none()
