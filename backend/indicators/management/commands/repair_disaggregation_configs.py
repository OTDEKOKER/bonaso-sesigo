"""Repair indicator configs that fail validation (defensive integrity pass).

The importer writes ``aggregate_disaggregation_config`` without running the
serializer validator, so a config can end up with case-variant duplicate values
(e.g. "Waist Circumference" and "Waist circumference") that render as two
identical columns. This command finds configs that fail validation and repairs
the *only* safe, lossless case — case/whitespace-insensitive duplicate values —
by collapsing them to a single value, preferring the variant that actually
appears in the indicator's stored data so no captured data is orphaned.

Any config that still fails validation after this conservative repair is
reported and left untouched for manual attention. Dry-run by default.

    python manage.py repair_disaggregation_configs            # report
    python manage.py repair_disaggregation_configs --apply    # persist
"""
from __future__ import annotations

from django.core.management.base import BaseCommand
from django.db import transaction
from rest_framework import serializers as drf_serializers

from aggregates.models import Aggregate
from indicators.disaggregation import validate_disaggregation_config
from indicators.models import Indicator


def _stored_value_keys(indicator_id, limit=200) -> set[str]:
    """All disaggregate keys (primary/secondary/band) seen in stored data."""
    keys: set[str] = set()
    for row in Aggregate.objects.filter(indicator_id=indicator_id).only("value")[:limit]:
        value = row.value
        if not isinstance(value, dict):
            continue
        for primary, secondary_map in (value.get("disaggregates") or {}).items():
            keys.add(str(primary))
            if isinstance(secondary_map, dict):
                for secondary, band_map in secondary_map.items():
                    keys.add(str(secondary))
                    if isinstance(band_map, dict):
                        keys.update(str(b) for b in band_map.keys())
    return keys


def _dedupe_values(values, data_keys):
    """Collapse case/whitespace-insensitive duplicate values, losslessly.

    Returns ``(deduped_values, changed)``. When two variants collide, the one
    present in stored data wins (so captured data keeps a home); otherwise the
    first occurrence wins.
    """
    data_norm = {k.strip().lower() for k in data_keys}
    chosen: dict[str, str] = {}
    order: list[str] = []
    for raw in values:
        value = str(raw)
        norm = value.strip().lower()
        if norm not in chosen:
            chosen[norm] = value
            order.append(norm)
            continue
        # Collision: prefer the variant that exists in stored data.
        if norm in data_norm and value.strip() in data_keys and chosen[norm] not in data_keys:
            chosen[norm] = value
    deduped = [chosen[n] for n in order]
    return deduped, deduped != [str(v) for v in values]


class Command(BaseCommand):
    help = "Repair indicator disaggregation configs that fail validation (lossless dedupe only)."

    def add_arguments(self, parser):
        parser.add_argument("--apply", action="store_true", help="Persist repairs (default: dry-run).")

    def handle(self, *args, **opts):
        apply = opts["apply"]
        repaired, still_invalid = [], []

        for ind in Indicator.objects.exclude(aggregate_disaggregation_config={}):
            config = ind.aggregate_disaggregation_config or {}
            try:
                validate_disaggregation_config(config)
                continue  # already valid
            except drf_serializers.ValidationError:
                pass

            data_keys = _stored_value_keys(ind.id)
            new_dims, changed_any = [], False
            for dim in config.get("dimensions", []):
                if not isinstance(dim, dict):
                    new_dims.append(dim)
                    continue
                values = dim.get("values") or []
                deduped, changed = _dedupe_values(values, data_keys)
                changed_any = changed_any or changed
                new_dims.append({**dim, "values": deduped})

            candidate = {**config, "dimensions": new_dims}
            try:
                validate_disaggregation_config(candidate)
            except drf_serializers.ValidationError as exc:
                still_invalid.append((ind.id, ind.code, str(exc)[:80]))
                continue

            if changed_any:
                repaired.append((ind, candidate))

        self.stdout.write(self.style.MIGRATE_HEADING(
            f"\nRepair invalid disaggregation configs ({'APPLY' if apply else 'DRY-RUN'})"
        ))
        self.stdout.write(f"  repairable (lossless dedupe): {len(repaired)}")
        for ind, candidate in repaired:
            self.stdout.write(f"    ~ #{ind.id} {ind.code}")
        if still_invalid:
            self.stdout.write(self.style.WARNING("\n  Still invalid after safe repair (manual attention):"))
            for iid, code, err in still_invalid:
                self.stdout.write(f"    ! #{iid} {code}: {err}")

        if not apply:
            self.stdout.write(self.style.NOTICE("\nDry-run only. Re-run with --apply to persist."))
            return

        with transaction.atomic():
            for ind, candidate in repaired:
                ind.aggregate_disaggregation_config = candidate
                ind.save(update_fields=["aggregate_disaggregation_config", "updated_at"])
        self.stdout.write(self.style.SUCCESS(f"\nApplied. Repaired {len(repaired)} config(s)."))
