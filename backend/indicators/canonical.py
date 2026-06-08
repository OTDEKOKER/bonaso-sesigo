"""Indicator canonicalization helpers (DI-1 / AN-1).

The portal accumulated several rows that describe the *same* metric under
different code schemes (``AUTO_*`` import-generated codes, ``NAHPA2025-26-*``
programmatic codes, ``SC_*`` codes ...). When they are all active, dashboards
and reports split or double-count a single metric because analytics groups by
``indicator_id``.

This module clusters those duplicates by a normalized name and chooses one
canonical row per cluster. The actual linking (setting ``canonical_indicator``
and ``is_deprecated``) is performed by the ``canonicalize_indicators``
management command; analytics consumes :func:`canonical_id_map` so totals roll
up to the canonical indicator without moving any historical aggregate.
"""
from __future__ import annotations

import re
from collections import defaultdict

from django.db.models import Count

from .models import Indicator

# Code prefixes that mark an auto/import-generated duplicate. When a cluster
# contains a non-AUTO_ row we prefer it as canonical and deprecate the AUTO_ one.
_AUTO_PREFIXES = ("AUTO_",)


def normalize_name(name: str) -> str:
    """Collapse case/punctuation/whitespace so name variants match.

    "Number of people referred for PEP."  ->  "number of people referred for pep"
    """
    text = re.sub(r"[^a-z0-9]+", " ", str(name or "").lower())
    return text.strip()


def _is_auto(code: str) -> bool:
    code = (code or "").upper()
    return any(code.startswith(p) for p in _AUTO_PREFIXES)


def build_clusters(indicators=None):
    """Group indicators by normalized name; return only clusters with >1 member.

    Returns a list of lists of Indicator objects (each inner list is one
    duplicate cluster), deterministically ordered.
    """
    if indicators is None:
        indicators = (
            Indicator.objects.all()
            .annotate(_agg_count=Count("aggregates"))
            .order_by("id")
        )
    buckets = defaultdict(list)
    for ind in indicators:
        key = normalize_name(ind.name)
        if not key:
            continue
        buckets[key].append(ind)
    clusters = [members for members in buckets.values() if len(members) > 1]
    clusters.sort(key=lambda members: normalize_name(members[0].name))
    return clusters


def _aggregate_count(indicator) -> int:
    cached = getattr(indicator, "_agg_count", None)
    if cached is not None:
        return cached
    return indicator.aggregates.count()


def choose_canonical(members):
    """Pick the canonical indicator for a duplicate cluster.

    Preference order (most to least preferred):
      1. Not already deprecated.
      2. Non ``AUTO_*`` code (human/programmatic code beats import-generated).
      3. Most approved-or-any aggregates attached (keep the busiest row stable).
      4. Lowest id (stable tie-break).
    """
    def sort_key(ind):
        return (
            1 if ind.is_deprecated else 0,          # prefer not-deprecated (0)
            1 if _is_auto(ind.code) else 0,          # prefer non-AUTO (0)
            -_aggregate_count(ind),                  # prefer more data
            ind.id,                                  # stable tie-break
        )

    return sorted(members, key=sort_key)[0]


def canonical_id_map() -> dict[int, int]:
    """Map every indicator id -> the id analytics should group it under.

    Uses the persisted ``canonical_indicator`` links. Indicators with no link
    map to themselves. Cheap single query; safe to call per request.
    """
    mapping = {}
    for ind_id, canon_id in Indicator.objects.values_list("id", "canonical_indicator_id"):
        mapping[ind_id] = canon_id or ind_id
    return mapping


def plan_canonicalization(indicators=None):
    """Compute the (non-mutating) canonicalization plan.

    Returns a list of dicts describing each cluster, its chosen canonical, and
    the rows that would be deprecated. Used by both the dry-run report and the
    apply path so they cannot diverge.
    """
    plan = []
    for members in build_clusters(indicators):
        canonical = choose_canonical(members)
        duplicates = [m for m in members if m.id != canonical.id]
        plan.append({
            "normalized_name": normalize_name(canonical.name),
            "canonical": canonical,
            "duplicates": duplicates,
            "canonical_aggregates": _aggregate_count(canonical),
            "duplicate_aggregates": sum(_aggregate_count(m) for m in duplicates),
        })
    return plan
