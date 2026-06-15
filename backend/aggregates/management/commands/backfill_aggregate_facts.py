"""Rebuild the AggregateFact table from existing Aggregate rows.

Idempotent: each aggregate's facts are deleted + recreated, so it is safe to
re-run. Use after first deploying the fact table, and any time you suspect the
derived rows have drifted.

    python manage.py backfill_aggregate_facts            # rebuild all
    python manage.py backfill_aggregate_facts --dry-run  # report only, no writes
"""
from django.core.management.base import BaseCommand
from django.db import transaction

from aggregates.facts import build_facts_for_aggregate
from aggregates.models import Aggregate, AggregateFact


class Command(BaseCommand):
    help = "Rebuild AggregateFact rows from Aggregate.value (server-side rollup substrate)."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true", help="Report counts only; no writes.")
        parser.add_argument("--batch-size", type=int, default=500)

    def handle(self, *args, **options):
        dry_run = options["dry_run"]
        batch_size = options["batch_size"]

        total_aggregates = Aggregate.objects.count()
        self.stdout.write(f"Aggregates: {total_aggregates}")

        if dry_run:
            leaves = 0
            empty = 0
            for agg in Aggregate.objects.select_related("indicator", "project").iterator(chunk_size=batch_size):
                rows = build_facts_for_aggregate(agg)
                leaves += len(rows)
                if not rows:
                    empty += 1
            self.stdout.write(self.style.WARNING(
                f"DRY RUN: would write {leaves} fact rows; {empty} aggregates produce no leaves."
            ))
            return

        with transaction.atomic():
            deleted, _ = AggregateFact.objects.all().delete()
            self.stdout.write(f"Cleared {deleted} existing fact rows.")
            buffer = []
            written = 0
            processed = 0
            for agg in Aggregate.objects.select_related("indicator", "project").iterator(chunk_size=batch_size):
                buffer.extend(build_facts_for_aggregate(agg))
                processed += 1
                if len(buffer) >= batch_size:
                    AggregateFact.objects.bulk_create(buffer, batch_size=batch_size)
                    written += len(buffer)
                    buffer = []
            if buffer:
                AggregateFact.objects.bulk_create(buffer, batch_size=batch_size)
                written += len(buffer)

        self.stdout.write(self.style.SUCCESS(
            f"Backfill complete: {processed} aggregates -> {written} fact rows."
        ))
