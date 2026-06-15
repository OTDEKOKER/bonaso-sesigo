"""Derive + maintain ``AggregateFact`` rows from ``Aggregate.value``.

The fact table is the long-term server-side aggregation substrate: every
aggregate's free-form JSON ``value`` is flattened into numeric leaves so rollups
are SQL ``GROUP BY`` instead of client-side summation over every row.

``flatten_value`` is the single source of truth for "what are the numeric leaves
of an aggregate value", and deliberately mirrors the capture/​workbook payload
shapes (``buildEntryMatrixPayload`` →
``{disaggregates:{primary:{secondary:{band:n}}}}``), the legacy
``{male,female,total}`` shape, and a bare scalar. It emits leaves that sum to
the aggregate's disaggregated total (disaggregates preferred, else male/female,
else the scalar total) — never both, so leaves never double-count.
"""
from __future__ import annotations

from decimal import Decimal, InvalidOperation

from .models import AggregateFact

ALL = AggregateFact.ALL
TOTAL_BAND = AggregateFact.TOTAL_BAND


def _num(raw):
    """Return a Decimal for finite, non-bool numeric input, else None."""
    if raw is None or isinstance(raw, bool):
        return None
    try:
        value = Decimal(str(raw).strip().replace(",", ""))
    except (InvalidOperation, ValueError, AttributeError):
        return None
    if not value.is_finite():
        return None
    return value


def flatten_value(value) -> list[tuple[str, str, str, Decimal]]:
    """Explode an aggregate ``value`` into ``(primary, secondary, band, amount)`` leaves."""
    leaves: list[tuple[str, str, str, Decimal]] = []

    number = _num(value) if isinstance(value, (int, float, str)) else None
    if number is not None:
        leaves.append((ALL, ALL, TOTAL_BAND, number))
        return leaves

    if not isinstance(value, dict):
        return leaves

    disaggregates = value.get("disaggregates")
    if isinstance(disaggregates, dict):
        for primary, secondary_map in disaggregates.items():
            if not isinstance(secondary_map, dict):
                continue
            for secondary, band_map in secondary_map.items():
                if isinstance(band_map, dict):
                    for band, amount in band_map.items():
                        n = _num(amount)
                        if n is not None:
                            leaves.append((str(primary), str(secondary), str(band), n))
                else:
                    n = _num(band_map)
                    if n is not None:
                        leaves.append((str(primary), str(secondary), TOTAL_BAND, n))
        if leaves:
            return leaves

    # Legacy sex-only shape.
    male, female = _num(value.get("male")), _num(value.get("female"))
    if male is not None or female is not None:
        if male is not None:
            leaves.append((ALL, "Male", TOTAL_BAND, male))
        if female is not None:
            leaves.append((ALL, "Female", TOTAL_BAND, female))
        return leaves

    total = _num(value.get("total"))
    if total is not None:
        leaves.append((ALL, ALL, TOTAL_BAND, total))
    return leaves


def build_facts_for_aggregate(aggregate) -> list[AggregateFact]:
    """Return (unsaved) AggregateFact rows for an aggregate (no DB writes)."""
    indicator = aggregate.indicator
    canonical_id = getattr(indicator, "canonical_indicator_id", None) or indicator.id
    is_training = bool(getattr(aggregate.project, "is_training", False))
    rows = []
    for primary, secondary, band, amount in flatten_value(aggregate.value):
        rows.append(AggregateFact(
            aggregate=aggregate,
            indicator_id=indicator.id,
            canonical_indicator_id=canonical_id,
            project_id=aggregate.project_id,
            organization_id=aggregate.organization_id,
            period_start=aggregate.period_start,
            period_end=aggregate.period_end,
            status=aggregate.status,
            is_training=is_training,
            primary=primary,
            secondary=secondary,
            band=band,
            value=amount,
        ))
    return rows


def sync_facts_for_aggregate(aggregate) -> int:
    """Rebuild the fact rows for one aggregate (delete + recreate). Idempotent.

    Returns the number of fact rows written.
    """
    AggregateFact.objects.filter(aggregate_id=aggregate.id).delete()
    rows = build_facts_for_aggregate(aggregate)
    if rows:
        AggregateFact.objects.bulk_create(rows, batch_size=500)
    return len(rows)
