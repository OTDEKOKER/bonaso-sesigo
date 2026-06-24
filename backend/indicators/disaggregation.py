"""Validation for an indicator's ``aggregate_disaggregation_config``.

``aggregate_disaggregation_config`` is the single source of truth for an
indicator's reporting/disaggregation structure (the reporting workbook, the
aggregate capture matrix, analysis grouping and exports all derive from it).
Legacy ``sub_labels`` remain a read fallback only.

Config shape::

    {
      "enabled": true,
      "layout": "matrix",                 # optional, free-form hint
      "dimensions": [
        {"key": "sex", "label": "Sex", "values": ["Male", "Female"]},
        {"key": "age_band", "label": "Age Range", "values": ["10-14", "15-19", ...]}
      ],
      "notes": "..."                       # optional
    }
"""
from __future__ import annotations

from rest_framework import serializers


def validate_disaggregation_config(value):
    """Validate an ``aggregate_disaggregation_config`` payload.

    Returns the value unchanged when valid; raises
    ``serializers.ValidationError`` otherwise. An empty/disabled config is valid
    (it means "no disaggregation") so existing indicators are never broken.
    """
    # Empty config == no disaggregation (valid).
    if value in (None, {}, ""):
        return value or {}
    if not isinstance(value, dict):
        raise serializers.ValidationError("Disaggregation config must be a JSON object.")

    enabled = value.get("enabled", False)
    if not isinstance(enabled, bool):
        raise serializers.ValidationError("'enabled' must be true or false.")

    dimensions = value.get("dimensions", [])
    if not isinstance(dimensions, list):
        raise serializers.ValidationError("'dimensions' must be a list.")

    if enabled and len(dimensions) == 0:
        raise serializers.ValidationError(
            "At least one dimension is required when disaggregation is enabled."
        )

    seen_keys: set[str] = set()
    seen_labels: set[str] = set()
    for index, dim in enumerate(dimensions):
        where = f"Dimension {index + 1}"
        if not isinstance(dim, dict):
            raise serializers.ValidationError(f"{where} must be an object.")

        key = str(dim.get("key") or "").strip()
        label = str(dim.get("label") or "").strip()
        values = dim.get("values")

        if not key:
            raise serializers.ValidationError(f"{where} is missing a 'key'.")
        if not label:
            raise serializers.ValidationError(f"{where} is missing a 'label'.")
        if not isinstance(values, list) or len(values) == 0:
            raise serializers.ValidationError(f"{where} ('{label}') must have at least one value.")

        key_norm = key.lower()
        label_norm = label.lower()
        if key_norm in seen_keys:
            raise serializers.ValidationError(f"Duplicate dimension key '{key}'.")
        if label_norm in seen_labels:
            raise serializers.ValidationError(f"Duplicate dimension label '{label}'.")
        seen_keys.add(key_norm)
        seen_labels.add(label_norm)

        cleaned_values = [str(v).strip() for v in values]
        if any(v == "" for v in cleaned_values):
            raise serializers.ValidationError(f"{where} ('{label}') has an empty value.")
        seen_values: set[str] = set()
        for v in cleaned_values:
            v_norm = v.lower()
            if v_norm in seen_values:
                raise serializers.ValidationError(
                    f"{where} ('{label}') has a duplicate value '{v}'."
                )
            seen_values.add(v_norm)

    return value
