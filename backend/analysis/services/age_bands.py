"""Age-band folding for cross-organization rollups / analysis.

Some indicators carry a messy ``age_band`` disaggregation that mixes single
years (``"10"``, ``"11"`` … ``"64"``) with the standard five-year groups
(``"10-14"``, ``"15-19"`` … ``"60-64"``, ``"65+"``). Single years are useful at
the per-organization reporting level, but when data is **rolled up across
organizations** (analysis, consolidated reports) we want to see only the
standard groups, with each single year folded into the group whose range
contains it (e.g. ``10, 11, 12, 13, 14 → "10-14"``; anything ``>= 65 → "65+"``).

This module is the authoritative server-side rule. The single-year → group
mapping is the standard Botswana five-year banding aligned to multiples of five.
Range labels (``"10-14"``) and the open ``"65+"`` band are kept as-is.
"""
from __future__ import annotations

import re

# A bare one/two-digit label is a single year ("12"); "10-14" / "65+" are groups.
_SINGLE_AGE_RE = re.compile(r"^\s*(\d{1,2})\s*$")
_OPEN_AGE = "65+"


def is_single_age_label(label) -> bool:
    return bool(_SINGLE_AGE_RE.match(str(label or "")))


def single_age_group_label(label) -> str | None:
    """Return the five-year group label a single-year band folds into.

    ``"12" -> "10-14"``, ``"17" -> "15-19"``, ``"64" -> "60-64"``,
    ``"65" -> "65+"``. Returns ``None`` when ``label`` is not a single year.
    """
    match = _SINGLE_AGE_RE.match(str(label or ""))
    if not match:
        return None
    age = int(match.group(1))
    if age >= 65:
        return _OPEN_AGE
    start = (age // 5) * 5
    return f"{start}-{start + 4}"


def _merge(existing, incoming):
    """Sum numbers / deep-merge dicts; mirrors the rollup leaf summation."""
    if existing is None:
        return incoming
    existing_num = isinstance(existing, (int, float)) and not isinstance(existing, bool)
    incoming_num = isinstance(incoming, (int, float)) and not isinstance(incoming, bool)
    if existing_num and incoming_num:
        return existing + incoming
    if isinstance(existing, dict) and isinstance(incoming, dict):
        merged = dict(existing)
        for key, value in incoming.items():
            merged[key] = _merge(merged.get(key), value)
        return merged
    return incoming


def fold_single_ages_into_age_groups(node):
    """Recursively fold single-year age keys into their five-year group.

    Walks a disaggregate structure (or a full aggregate ``value``) and, at every
    mapping level, replaces single-year keys with the containing group key,
    summing values that collide. Non-age keys and group/open-band keys are left
    untouched. The input is not mutated.
    """
    if isinstance(node, dict):
        result: dict = {}
        for key, child in node.items():
            folded_child = fold_single_ages_into_age_groups(child)
            new_key = single_age_group_label(key) or key
            if new_key in result:
                result[new_key] = _merge(result[new_key], folded_child)
            else:
                result[new_key] = folded_child
        return result
    if isinstance(node, list):
        return [fold_single_ages_into_age_groups(item) for item in node]
    return node
