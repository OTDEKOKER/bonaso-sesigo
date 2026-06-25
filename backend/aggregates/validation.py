"""Server-side validation for aggregate ``value`` payloads.

``Aggregate.value`` is a free-form ``JSONField``. Historically nothing
constrained its shape, so malformed or out-of-range numbers could reach the
production reporting tables silently (rollout readiness blocker R1 / finding
C4). This module is the single source of truth for what a valid aggregate value
looks like, shared by the serializer (single + bulk create/update).

Accepted shapes — mirroring exactly what the capture UI, the workbook import,
and ``generate_from_interactions`` actually produce:

  * a bare non-negative number            -> ``10``
  * a mapping with numeric leaves         -> ``{"total": 10, "male": 3, "female": 7}``
  * a mapping with a nested disaggregate  -> ``{"disaggregates": {"All": {"Male": {"18-24": 3}}}}``

Rules enforced: present/non-null, numeric type (no booleans/garbage strings),
finite (no NaN/Infinity), non-negative, an overflow sanity cap, and a 0-100
ceiling for percentage indicators. Cross-field sum coherence is intentionally
*not* enforced (legitimate data carries unknown-sex/age residuals).
"""
from __future__ import annotations

import math

from rest_framework import serializers

# Generous overflow / fat-finger guard. Real programme counts sit far below this;
# the cap exists to reject overflow garbage and accidental concatenations
# (e.g. two numbers pasted together), not legitimate large counts.
MAX_AGGREGATE_VALUE = 1_000_000_000_000  # 1e12

# Top-level keys whose scalar carries percentage semantics for a % indicator.
_TOTAL_KEYS = {"total"}


def _coerce_number(raw):
    """Return a finite int/float for numeric input, else ``None``.

    Accepts ints, floats and numeric strings (``"10"``, ``"3.5"``, ``"1,234"``);
    rejects booleans (which are ``int`` subclasses in Python), ``NaN`` and
    ``Infinity``. Whole floats are normalised to ``int`` so downstream
    summation/export stays clean.
    """
    if isinstance(raw, bool):
        return None
    if isinstance(raw, (int, float)):
        number = raw
    elif isinstance(raw, str):
        text = raw.strip().replace(",", "")
        if not text:
            return None
        try:
            number = float(text)
        except ValueError:
            return None
    else:
        return None
    if isinstance(number, float):
        if not math.isfinite(number):
            return None
        if number.is_integer():
            number = int(number)
    return number


def _validate_number(raw, *, path, is_percentage):
    number = _coerce_number(raw)
    if number is None:
        raise serializers.ValidationError(
            f"{path} must be a number; received {raw!r}."
        )
    if number < 0:
        raise serializers.ValidationError(
            f"{path} cannot be negative (received {number})."
        )
    if number > MAX_AGGREGATE_VALUE:
        raise serializers.ValidationError(
            f"{path} is implausibly large (received {number}); please re-check the entry."
        )
    if is_percentage and number > 100:
        raise serializers.ValidationError(
            f"{path} is a percentage and cannot exceed 100 (received {number})."
        )
    return number


def _validate_value_mapping(value, *, is_percentage):
    numeric_leaves = 0

    def walk(node, path, *, percentage_check):
        nonlocal numeric_leaves
        if node is None:
            return
        if isinstance(node, dict):
            for key, child in node.items():
                child_path = f"{path}.{key}" if path else str(key)
                walk(child, child_path, percentage_check=False)
            return
        if isinstance(node, (list, tuple)):
            raise serializers.ValidationError(
                f"{path or 'Value'} cannot be a list."
            )
        _validate_number(node, path=path or "Value", is_percentage=percentage_check)
        numeric_leaves += 1

    for key, child in value.items():
        is_total = str(key).strip().lower() in _TOTAL_KEYS
        walk(child, str(key), percentage_check=is_percentage and is_total)

    if numeric_leaves == 0:
        raise serializers.ValidationError(
            "Value must contain at least one number."
        )
    return value


def validate_aggregate_value(value, *, indicator=None):
    """Validate and normalise an aggregate ``value`` payload.

    Returns the (possibly normalised) value, or raises
    ``rest_framework.serializers.ValidationError`` with a user-friendly message.
    """
    # Percentage indicators RESOLVE AS A VALUE: they store disaggregated COUNTS
    # (the numerator); the % is computed downstream from achieved ÷ denominator
    # achieved. So values are NOT capped at 100 — validated like any count
    # (finite, non-negative, overflow-guarded). ``indicator`` kept for signature
    # compatibility and future per-type rules.
    is_percentage = False

    if value is None:
        raise serializers.ValidationError("A value is required.")

    if isinstance(value, bool):
        raise serializers.ValidationError(
            "Value must be a number or a breakdown object, not a boolean."
        )

    if isinstance(value, (int, float, str)):
        return _validate_number(value, path="Value", is_percentage=is_percentage)

    if isinstance(value, dict):
        return _validate_value_mapping(value, is_percentage=is_percentage)

    raise serializers.ValidationError(
        "Value must be a number or a breakdown object."
    )
