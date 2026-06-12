"""Normalize an indicator's aggregate disaggregation:

  * collapse a spurious age/category nesting into the indicator's real band
    label (default "Value") so an activity-count indicator is not split by age,
  * merge inconsistent primary labels (e.g. "Street Interaction" vs
    "Street Interactions", misspellings) via an alias map,
  * preserve each aggregate's total exactly (refuses to run if a rewrite would
    change a total).

Backs up the affected aggregate values to a JSON file before writing.
Defaults to --dry-run; pass --commit to persist.

Example:
    python manage.py normalize_aggregate_disaggregation \
        --indicator-id 366 --org-id 101 --commit
"""
import json
from datetime import datetime
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from aggregates.models import Aggregate
from aggregates import reporting_workbook as rw

# Known partner-label variants → canonical label.
DEFAULT_ALIASES = {
    "commemmorations": "Commemorations",
    "commemorations": "Commemorations",
    "street interaction": "Street Interactions",
    "street interactions": "Street Interactions",
}


def _canon(label: str, aliases: dict) -> str:
    key = " ".join(str(label or "").split()).lower()
    return aliases.get(key, " ".join(str(label or "").split()))


def _flatten(disaggregates: dict, band_label: str, aliases: dict):
    """{activity: {cat: {band: n}}}  ->  {canon_activity: {"All": {band_label: sum}}}"""
    merged: dict[str, float] = {}
    for activity, catmap in (disaggregates or {}).items():
        total = 0.0
        for _cat, bandmap in (catmap or {}).items():
            for _band, val in (bandmap or {}).items():
                try:
                    total += float(val)
                except (TypeError, ValueError):
                    pass
        canon = _canon(activity, aliases)
        merged[canon] = merged.get(canon, 0.0) + total
    out = {}
    for canon, total in merged.items():
        num = int(total) if float(total).is_integer() else total
        out[canon] = {"All": {band_label: num}}
    return out, merged


class Command(BaseCommand):
    help = "Normalize aggregate disaggregation (drop spurious age band, merge label variants)."

    def add_arguments(self, parser):
        parser.add_argument("--indicator-id", type=int, required=True)
        parser.add_argument("--org-id", type=int, default=None)
        parser.add_argument("--commit", action="store_true")

    def handle(self, *args, **o):
        from indicators.models import Indicator
        ind = Indicator.objects.get(id=o["indicator_id"])
        band_label = rw.resolve_matrix_config(ind).band_label or rw.NO_BAND

        qs = Aggregate.objects.filter(indicator_id=o["indicator_id"])
        if o["org_id"]:
            qs = qs.filter(organization_id=o["org_id"])
        qs = list(qs)
        if not qs:
            raise CommandError("No aggregates matched.")

        backup = []
        changes = []
        for a in qs:
            value = a.value or {}
            old_d = value.get("disaggregates", {}) or {}
            new_d, merged = _flatten(old_d, band_label, DEFAULT_ALIASES)
            new_total = sum(merged.values())
            old_total = value.get("total")
            backup.append({"id": a.id, "value": value})
            changes.append({
                "id": a.id, "period": str(a.period_start),
                "old_keys": sorted(old_d.keys()), "new_keys": sorted(new_d.keys()),
                "old_total": old_total, "recomputed_total": new_total,
            })
            # Safety: never change a stored total.
            if old_total is not None and float(old_total) != float(new_total):
                raise CommandError(
                    f"Aggregate {a.id}: rewrite would change total "
                    f"{old_total} -> {new_total}. Aborting (no writes)."
                )

        for c in changes:
            self.stdout.write(
                f"agg {c['id']} {c['period']}: total {c['old_total']} (unchanged) | "
                f"{len(c['old_keys'])} -> {len(c['new_keys'])} categories"
            )
            removed = sorted(set(c['old_keys']) - set(c['new_keys']))
            if removed:
                self.stdout.write(f"    merged away: {removed}")

        if not o["commit"]:
            self.stdout.write(self.style.WARNING("DRY-RUN — pass --commit to apply."))
            return

        bpath = Path(f"/home/bonasoadmin/BONASOV1/backups/disagg_backup_ind{o['indicator_id']}_{datetime.now():%Y%m%d_%H%M%S}.json")
        bpath.write_text(json.dumps(backup, indent=2), encoding="utf-8")

        with transaction.atomic():
            for a in qs:
                value = dict(a.value or {})
                new_d, _ = _flatten(value.get("disaggregates", {}) or {}, band_label, DEFAULT_ALIASES)
                value["disaggregates"] = new_d
                a.value = value
                a.save(update_fields=["value", "updated_at"])

        self.stdout.write(self.style.SUCCESS(
            f"Committed. Backup: {bpath}. Rewrote {len(qs)} aggregate(s)."
        ))
