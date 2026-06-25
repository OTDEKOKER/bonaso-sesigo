"""Bootstrap ``aggregate_disaggregation_config`` for legacy indicators.

``aggregate_disaggregation_config`` is the single source of truth for an
indicator's disaggregation (workbook, capture, analysis, dashboard, exports).
Older indicators only carry the legacy ``sub_labels`` name list, so their
config is empty and the rest of the stack (which is config-driven) treats them
as having no disaggregation — an inconsistency.

This command seeds those indicators with a real config, preferring values
recovered from their actual captured data and falling back to the legacy
``sub_labels`` names + house-standard values. It NEVER overwrites an indicator
that already has an enabled config, NEVER edits ``sub_labels``, and is a no-op
in dry-run (the default). Run with ``--apply`` to persist.

    python manage.py backfill_disaggregation_config            # dry-run report
    python manage.py backfill_disaggregation_config --apply    # persist
"""
from __future__ import annotations

import json

from django.core.management.base import BaseCommand
from django.db import transaction

from aggregates.models import Aggregate
from indicators.disaggregation import bootstrap_config, has_enabled_config
from indicators.models import Indicator


class Command(BaseCommand):
    help = "Seed aggregate_disaggregation_config for legacy indicators (config is the single source of truth)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--apply", action="store_true",
            help="Persist changes. Without this flag the command only reports (dry-run).",
        )
        parser.add_argument(
            "--ids", type=str, default="",
            help="Optional comma-separated indicator ids to limit the run.",
        )
        parser.add_argument(
            "--data-samples", type=int, default=200,
            help="Max aggregate rows to scan per indicator when recovering values from data.",
        )

    def handle(self, *args, **opts):
        apply = opts["apply"]
        sample_limit = opts["data_samples"]
        only_ids = {int(x) for x in opts["ids"].split(",") if x.strip()} if opts["ids"] else None

        qs = Indicator.objects.all().only("id", "code", "name", "sub_labels", "aggregate_disaggregation_config")
        if only_ids:
            qs = qs.filter(id__in=only_ids)

        seeded, skipped_have_config, skipped_no_source, needs_manual = [], 0, [], []

        for ind in qs:
            if has_enabled_config(ind.aggregate_disaggregation_config):
                skipped_have_config += 1
                continue
            if not ind.sub_labels:
                continue  # genuinely non-disaggregated — nothing to seed.

            samples = [
                r.value.get("disaggregates")
                for r in Aggregate.objects.filter(indicator_id=ind.id)
                .only("value")[:sample_limit]
                if isinstance(r.value, dict) and isinstance(r.value.get("disaggregates"), dict)
            ]
            config, unresolved = bootstrap_config(ind, samples)

            if not has_enabled_config(config):
                skipped_no_source.append((ind.id, ind.code, list(ind.sub_labels or [])))
                needs_manual.append((ind.id, ind.code, list(ind.sub_labels or [])))
                continue

            source = "data" if samples and any(samples) else "sub_labels"
            seeded.append((ind, config, source, unresolved))
            if unresolved:
                needs_manual.append((ind.id, ind.code, unresolved))

        # ── report ──────────────────────────────────────────────────────────
        self.stdout.write(self.style.MIGRATE_HEADING(
            f"\nBackfill aggregate_disaggregation_config ({'APPLY' if apply else 'DRY-RUN'})"
        ))
        self.stdout.write(f"  already configured (untouched): {skipped_have_config}")
        self.stdout.write(f"  to seed:                        {len(seeded)}")
        self.stdout.write(f"  legacy but unseedable:          {len(skipped_no_source)}")

        for ind, config, source, unresolved in seeded:
            dims = ", ".join(f"{d['label']}({len(d['values'])})" for d in config["dimensions"])
            note = f"  [unresolved->UI: {', '.join(unresolved)}]" if unresolved else ""
            self.stdout.write(f"    + #{ind.id} {ind.code}: from {source} -> {dims}{note}")

        if skipped_no_source:
            self.stdout.write(self.style.WARNING("\n  Need manual UI configuration (no confident source):"))
            for iid, code, labels in skipped_no_source:
                self.stdout.write(f"    ! #{iid} {code}: sub_labels={labels}")

        if not apply:
            self.stdout.write(self.style.NOTICE("\nDry-run only. Re-run with --apply to persist."))
            return

        with transaction.atomic():
            for ind, config, _source, _unresolved in seeded:
                ind.aggregate_disaggregation_config = config
                ind.save(update_fields=["aggregate_disaggregation_config", "updated_at"])
        self.stdout.write(self.style.SUCCESS(f"\nApplied. Seeded {len(seeded)} indicator(s)."))

        if needs_manual:
            self.stdout.write(self.style.WARNING(
                "Indicators still needing UI attention (unresolved dimensions): "
                + json.dumps([{"id": i, "code": c, "labels": l} for i, c, l in needs_manual])
            ))
