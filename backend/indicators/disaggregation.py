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

import re

from rest_framework import serializers


# ── House-standard dimension value sets ──────────────────────────────────────
# These mirror the values the overwhelming majority of already-configured
# indicators use (verified against production). They are the defaults the
# bootstrap uses when synthesising a config from a legacy ``sub_labels`` list
# that carries dimension *names* but not their values.
STANDARD_SEX_VALUES = ["Male", "Female"]
STANDARD_AGE_BAND_VALUES = [
    "10-14", "15-19", "20-24", "25-29", "30-34", "35-39",
    "40-44", "45-49", "50-54", "55-59", "60-64", "65+",
]
STANDARD_KP_VALUES = ["GENERAL POP.", "FSW", "MSM", "PWID", "PWUD", "PWD", "LGBTQI+"]

# Known spelling variants of a disaggregate category -> its canonical label.
# Keyed by a punctuation/space-insensitive fold so "General population",
# "Gen Pop", "General Poluation" (typo) etc. all collapse. This is the single
# place new aliases are added; the data write-path and config recovery both use
# it so a variant can never persist and re-create duplicate rows / workbook
# columns. NB: PWUD (people who use drugs) is a DISTINCT category, never aliased
# to PWID.
DISAGGREGATE_LABEL_ALIASES = {
    "general population": "GENERAL POP.",
    "general pop": "GENERAL POP.",
    "gen pop": "GENERAL POP.",
    "gen population": "GENERAL POP.",
    "general poluation": "GENERAL POP.",
    "pwids": "PWID",
}

# Maps a normalised legacy sub_label name -> (key, canonical label, standard values).
# Only names with a confident, house-standard value set are listed here; any
# other legacy label (e.g. "Disaggregate", a free-form primary) cannot be
# synthesised safely and is reported for manual configuration in the UI instead.
_KNOWN_DIMENSIONS = {
    "sex": ("sex", "Sex", STANDARD_SEX_VALUES),
    "age range": ("age_band", "Age Range", STANDARD_AGE_BAND_VALUES),
    "age band": ("age_band", "Age Range", STANDARD_AGE_BAND_VALUES),
    "age group": ("age_band", "Age Range", STANDARD_AGE_BAND_VALUES),
    "age": ("age_band", "Age Range", STANDARD_AGE_BAND_VALUES),
    "key population": ("key_population", "Key Population", STANDARD_KP_VALUES),
    "kp": ("key_population", "Key Population", STANDARD_KP_VALUES),
}


def _normalize_name(value) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip().lower())


def _normalize_key(label: str) -> str:
    return re.sub(r"\s+", "_", _normalize_name(label))


def _age_band_sort_key(value: str):
    text = str(value or "").strip()
    m = re.match(r"^(\d{1,3})\s*-\s*(\d{1,3})$", text)
    if m:
        return (int(m.group(1)), int(m.group(2)), text)
    m = re.match(r"^(\d{1,3})\s*\+$", text)
    if m:
        return (int(m.group(1)), 10**6, text)
    return (10**7, 10**7, text.lower())


def _is_age_label(label: str) -> bool:
    return "age" in _normalize_name(label)


def _is_sex_label(label: str) -> bool:
    return _normalize_name(label) == "sex"


def _ordered_unique(values):
    seen, out = set(), []
    for v in values:
        s = str(v).strip()
        if s and s.lower() not in seen:
            seen.add(s.lower())
            out.append(s)
    return out


def _alias_fold(label) -> str:
    """Punctuation/space-insensitive fold used only for alias lookup."""
    return re.sub(r"[^a-z0-9]+", " ", str(label or "").lower()).strip()


def canonical_disaggregate_label(label):
    """Map a disaggregate label to its canonical spelling (identity if unknown)."""
    canon = DISAGGREGATE_LABEL_ALIASES.get(_alias_fold(label))
    return canon if canon is not None else label


def _deep_add(a, b):
    """Sum two nested numeric maps leaf-wise (used to merge two labels' data)."""
    if isinstance(a, dict) and isinstance(b, dict):
        out = dict(a)
        for k, bv in b.items():
            out[k] = _deep_add(out[k], bv) if k in out else bv
        return out
    an = a if isinstance(a, (int, float)) and not isinstance(a, bool) else 0
    bn = b if isinstance(b, (int, float)) and not isinstance(b, bool) else 0
    return an + bn


def _canonicalize_primary_map(mapping):
    """Rename variant primary keys to canonical, deep-summing any collision so
    the leaf total is preserved (two spellings of one category become one)."""
    if not isinstance(mapping, dict):
        return mapping
    out: dict = {}
    for label, node in mapping.items():
        target = canonical_disaggregate_label(label)
        out[target] = _deep_add(out[target], node) if target in out else node
    return out


def canonicalize_value_disaggregate_labels(value):
    """In-place canonicalise the ``disaggregates``/``categories`` primary labels
    of a stored aggregate ``value``. Sum-preserving; safe no-op for anything else.
    This is the single write-path guard so no variant label is ever persisted."""
    if isinstance(value, dict):
        for key in ("disaggregates", "categories"):
            node = value.get(key)
            if isinstance(node, dict):
                value[key] = _canonicalize_primary_map(node)
    return value


def _layout_for(dimensions) -> str:
    return {1: "list", 2: "matrix"}.get(len(dimensions), "nested-matrix") if dimensions else "none"


def config_from_sub_labels(sub_labels) -> tuple[dict, list[str]]:
    """Synthesise a config from a legacy ``sub_labels`` name list.

    Returns ``(config, unresolved_labels)``. ``unresolved_labels`` lists any
    legacy dimension names that have no confident standard value set (e.g. a
    free-form "Disaggregate" primary) and therefore must be configured by an
    administrator in the UI. When nothing can be resolved the config is ``{}``.
    """
    labels = [str(x) for x in (sub_labels or []) if str(x or "").strip()]
    dimensions: list[dict] = []
    unresolved: list[str] = []
    seen_keys: set[str] = set()
    for label in labels:
        known = _KNOWN_DIMENSIONS.get(_normalize_name(label))
        if not known:
            unresolved.append(label)
            continue
        key, canon_label, values = known
        if key in seen_keys:
            continue
        seen_keys.add(key)
        dimensions.append({"key": key, "label": canon_label, "values": list(values)})
    if not dimensions:
        return {}, unresolved
    return {"enabled": True, "layout": _layout_for(dimensions), "dimensions": dimensions}, unresolved


def config_from_aggregate_data(disaggregate_samples, sub_labels=None) -> dict:
    """Recover a config from real captured ``disaggregates`` payloads.

    ``disaggregate_samples`` is an iterable of the nested
    ``{primary: {secondary: {band: number}}}`` dicts stored on aggregates. This
    reflects exactly what was actually entered, so it is the most accurate
    source for a legacy indicator that has data. Returns ``{}`` when no usable
    nested structure is present (e.g. only ``{"total": n}`` rows).
    """
    primary_values: list[str] = []
    secondary_values: list[str] = []
    band_values: list[str] = []
    for disag in disaggregate_samples or []:
        if not isinstance(disag, dict) or not disag:
            continue
        for primary, secondary_map in disag.items():
            if str(primary or "").strip():
                # Canonicalise so a variant spelling in legacy data can't be
                # recovered into the config (and thence the workbook) as a
                # duplicate of its canonical category.
                primary_values.append(canonical_disaggregate_label(str(primary).strip()))
            if not isinstance(secondary_map, dict):
                continue
            for secondary, band_map in secondary_map.items():
                if str(secondary or "").strip():
                    secondary_values.append(str(secondary).strip())
                if isinstance(band_map, dict):
                    band_values.extend(str(b).strip() for b in band_map.keys() if str(b or "").strip())

    primary_values = _ordered_unique(primary_values)
    secondary_values = _ordered_unique(secondary_values)
    band_values = sorted(_ordered_unique(band_values), key=_age_band_sort_key)

    # Drop placeholder "All" axes (they mean "no breakdown on this axis").
    def _real(vals):
        return vals and not (len(vals) == 1 and vals[0].lower() == "all")

    # The non-sex/age primary label is taken from sub_labels when available.
    legacy = [str(x) for x in (sub_labels or []) if str(x or "").strip()]
    primary_label = next(
        (l for l in legacy if not _is_sex_label(l) and not _is_age_label(l)),
        "Disaggregate",
    )

    dimensions: list[dict] = []
    if _real(primary_values):
        dimensions.append({
            "key": _normalize_key(primary_label),
            "label": primary_label,
            "values": primary_values,
        })
    if _real(secondary_values):
        # Sex axis if it looks like sex, else a generic secondary.
        if all(v in STANDARD_SEX_VALUES for v in secondary_values):
            dimensions.append({"key": "sex", "label": "Sex", "values": list(STANDARD_SEX_VALUES)})
        else:
            dimensions.append({"key": "secondary", "label": "Category", "values": secondary_values})
    if band_values:
        dimensions.append({"key": "age_band", "label": "Age Range", "values": band_values})

    if not dimensions:
        return {}
    return {"enabled": True, "layout": _layout_for(dimensions), "dimensions": dimensions}


def has_enabled_config(config) -> bool:
    """True when ``config`` is a usable (enabled, non-empty) disaggregation."""
    return bool(
        isinstance(config, dict)
        and config.get("enabled")
        and isinstance(config.get("dimensions"), list)
        and len(config["dimensions"]) > 0
    )


def bootstrap_config(indicator, disaggregate_samples=None) -> tuple[dict, list[str]]:
    """Resolve the authoritative config for a (possibly legacy) indicator.

    Order of preference (single source of truth, never invents structure):
      1. an existing enabled ``aggregate_disaggregation_config`` -> kept as-is;
      2. config recovered from the indicator's real captured data (accurate);
      3. config synthesised from legacy ``sub_labels`` names + standard values.

    Returns ``(config, unresolved_labels)``.
    """
    existing = getattr(indicator, "aggregate_disaggregation_config", None) or {}
    if has_enabled_config(existing):
        return existing, []
    from_data = config_from_aggregate_data(disaggregate_samples, getattr(indicator, "sub_labels", None))
    if has_enabled_config(from_data):
        return from_data, []
    return config_from_sub_labels(getattr(indicator, "sub_labels", None))


# The reporting workbook/capture matrix represents at most three axes
# (primary x secondary x band). A config with more dimensions would silently
# drop one from the generated grid — an inconsistency we reject on save.
MAX_MATRIX_DIMENSIONS = 3


def validate_save_consistency(value):
    """On-save consistency guard for the Indicator Configuration UI.

    Beyond structural validity, this rejects configs that would produce an
    INCONSISTENT workbook/capture grid even though every value is individually
    valid:
      * more dimensions than the matrix can represent (a dimension would be
        dropped from the generated workbook);
      * values that collapse to the same column under the matrix's own
        normalisation (case/whitespace variants such as "0-4" vs "0 - 4"),
        which would render as a single merged column.

    Returns the value unchanged when consistent; raises otherwise. Empty/disabled
    configs are always consistent.
    """
    if not has_enabled_config(value):
        return value

    dimensions = value.get("dimensions", [])
    if len(dimensions) > MAX_MATRIX_DIMENSIONS:
        raise serializers.ValidationError(
            f"A disaggregation matrix supports at most {MAX_MATRIX_DIMENSIONS} dimensions, "
            f"but this configuration has {len(dimensions)}. The reporting workbook and capture "
            f"grid cannot represent more, so a dimension would be dropped. Merge or remove dimensions."
        )

    # Mirror the workbook matrix's own label normalisation so we detect exactly
    # the values it would collapse (e.g. age bands "0-4" and "0 - 4").
    from aggregates.reporting_workbook import normalize_band_label

    for dim in dimensions:
        label = dim.get("label") or dim.get("key")
        values = dim.get("values") or []
        normalized = [
            re.sub(r"\s+", " ", normalize_band_label(str(v)).strip().lower()) for v in values
        ]
        if len(set(normalized)) != len(normalized):
            raise serializers.ValidationError(
                f"Dimension '{label}' has values that would collapse into one column "
                f"(case/whitespace variants of the same value). Make each value distinct."
            )

    return value


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
